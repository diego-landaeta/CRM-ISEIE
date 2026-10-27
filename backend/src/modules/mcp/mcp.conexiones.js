import crypto from 'crypto';
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import { huella } from './mcp.acceso.js';
import { siNoEnv } from './mcp.config.js';

/**
 * Cada Claude conectado a una URL del MCP, con su permiso (#326).
 *
 * POR QUÉ. Hasta ahora el desbloqueo era de la URL: si la URL de alguien estaba
 * desbloqueada, cualquiera que la tuviera consultaba sin código. Diego (13/10):
 * si la URL se cuela, que la otra persona no pueda consultar. Por IP no se puede
 * (con el conector, las consultas llegan desde los servidores de Anthropic; ver
 * mcp.alertas.js). Lo acordado con Diego (WhatsApp, 13/10):
 *
 *   · Cada Claude que se conecta a una URL es una CONEXIÓN propia. Nace en el
 *     paso de inicio de sesión de Claude (OAuth, `/token` en mcp.oauth.js) y
 *     tiene su propia llave: Claude la manda en cada consulta.
 *   · Queda PENDIENTE hasta que el dueño de la URL la autoriza en Conexión →
 *     MCP, debajo de su URL. Le llega un aviso a la campana.
 *   · El código desbloquea ESA conexión, no la URL, y sin caducidad por horas
 *     (Carlos, 13/10). Otra conexión con la misma URL no consulta aunque la URL
 *     esté desbloqueada y aunque tenga un código.
 *   · Rechazar o quitar una conexión no toca las demás. Al morir la URL mueren
 *     sus conexiones (se mira en cada consulta).
 *
 * Quién decide: el dueño autoriza o rechaza las suyas; el super admin puede
 * rechazar cualquiera (Diana, 13/10).
 */

const PREFIJO_LLAVE = 'crm_mcc_';

/** Lo que Claude manda en la cabecera después de conectarse. */
export function pareceLlaveDeConexion(llave) {
  return typeof llave === 'string' && llave.startsWith(PREFIJO_LLAVE)
    && llave.length >= PREFIJO_LLAVE.length + 40 && llave.length <= 128;
}

/**
 * La llave de una conexión sale de su semilla (guardada) y del secreto del
 * servidor, como el enlace de las facturas de colaboradores (#202). Así el
 * refresco de Claude devuelve la MISMA llave: si diera una nueva y anulara la
 * anterior, una consulta que Claude tuviera en marcha con la vieja recibiría un
 * 401, Claude se volvería a conectar y aparecería como un Claude nuevo pendiente.
 */
function llaveDe(semilla) {
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error('JWT_SECRET no está configurado');
  const llave = PREFIJO_LLAVE + crypto.createHmac('sha256', base).update(`mcp-conexion:${semilla}`).digest('base64url');
  return { llave, hash: huella(llave) };
}

/**
 * Las URLs que ya existían al desplegar: si Diego lo enciende, su primera
 * conexión entra autorizada para que nadie tenga que ir al CRM a autorizarla.
 */
export const existentesAprobadas = () => siNoEnv('MCP_CONEXIONES_EXISTENTES_APROBADAS', false);

/** claude.ai y Claude Desktop vuelven a claude.ai; Claude Code, a la máquina local. */
export function clienteDeLaVuelta(vuelta) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(String(vuelta || '')) ? 'claude_code' : 'claude';
}

/**
 * Una conexión nueva para la URL de `secreto`, en el paso `/token`. Devuelve
 * { id, llave, estado } o null si la URL ya no vale. La llave se enseña solo aquí.
 */
export async function crear({ secreto, vuelta }) {
  const { rows: [t] } = await query(
    `SELECT t.id, t.user_id, t.anterior_a_conexiones, t.nombre, c.label AS conexion,
            NOT EXISTS (SELECT 1 FROM mcp_conexiones x WHERE x.token_id = t.id) AS primera
       FROM mcp_tokens t
       LEFT JOIN project_connectors c ON c.id = t.connector_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > NOW())`,
    [huella(secreto)]
  );
  if (!t) return null;
  const autorizada = existentesAprobadas() && t.anterior_a_conexiones && t.primera;
  const semilla = crypto.randomBytes(32).toString('base64url');
  const { llave, hash } = llaveDe(semilla);
  const cliente = clienteDeLaVuelta(vuelta);
  const { rows: [c] } = await query(
    `INSERT INTO mcp_conexiones (token_id, user_id, llave_hash, llave_semilla, cliente, estado, decidida_at)
     VALUES ($1, $2, $3, $4, $5, $6::varchar, CASE WHEN $6::varchar = 'autorizada' THEN NOW() END)
     RETURNING id, estado`,
    [t.id, t.user_id, hash, semilla, cliente, autorizada ? 'autorizada' : 'pendiente']
  );
  logger.info({ userId: t.user_id, tokenId: t.id, conexionId: c.id, estado: c.estado }, 'MCP: conexión de Claude nueva');
  // Con el código apagado no hay barrera (la conexión consulta igual): no se
  // avisa de algo que no hace falta autorizar. Se lee aquí y no de
  // mcp.desbloqueo.js, que importa este módulo.
  if (c.estado === 'pendiente' && siNoEnv('MCP_CODIGO_OBLIGATORIO', false)) {
    await notifyUsers({
      targetUserIds: [t.user_id],
      type: 'mcp_conexion_nueva',
      title: 'Un Claude pide conectarse con tu URL',
      message: `Se ha conectado un ${cliente === 'claude_code' ? 'Claude Code' : 'Claude'} con tu URL «${t.conexion || t.nombre}». `
        + 'Si eres tú, autorízalo en Conexión → MCP; si no, recházalo.',
      link_path: '/conexion/mcp',
      metadata: { tokenId: t.id, conexionId: c.id },
    });
  }
  return { id: c.id, llave, estado: c.estado };
}

// ─── Un Claude conectado a la manera de antes (Diego, 22/10) ─────────────
//
// POR QUÉ. Diego (22/10): «volvió la validación de 2 horas, y solo debe
// validarse una vez». No volvió ninguna caducidad: lo que pasaba es que, desde
// que la #326 llegó a producción (16/10), el CRM contesta 401 a todo Claude que
// consulta con la URL sola, sin haber iniciado sesión (mcp.auth.js), y los
// conectores de claude.ai que se añadieron ANTES no inician sesión por su
// cuenta: del 19 al 22/10 hubo 67 rechazos así en MultiCRM y 57 en ISEIE, y ni
// una petición de su inicio de sesión. Cada conversación nueva le volvía a
// decir a la persona que conectara el CRM, y nadie le decía cómo. Solo Tony lo
// rehízo (20/10) y desde entonces no se le ha vuelto a pedir nada.
//
// Así que aquí se le AVISA al dueño de la URL, a la campana, con lo que tiene
// que hacer una sola vez. Se espera un poco antes de avisar porque un Claude
// que se está conectando AHORA también entra la primera vez sin sesión: si en
// la espera termina de conectarse (nace su conexión), no era uno de antes y no
// se avisa. Como mucho un aviso al día por URL.

const ESPERA_AVISO_MS = 2 * 60 * 1000;
const VOLVER_A_MIRAR_MS = 60 * 60 * 1000;
/** tokenId → { pendiente, mirado }: para no programar un aviso por cada 401 de la misma conversación. */
const avisos = new Map();

/**
 * Lo llama mcp.auth.js cuando rechaza un Claude que trae la URL (o su llave)
 * pero no la llave de una conexión. No espera a nada ni hace fallar la consulta.
 * Devuelve true si ha programado la comprobación.
 */
export function avisarConectorAntiguo({ token_id: tokenId }, { esperaMs = ESPERA_AVISO_MS } = {}) {
  const ahora = Date.now();
  const previo = avisos.get(tokenId);
  if (previo && (previo.pendiente || ahora - previo.mirado < VOLVER_A_MIRAR_MS)) return false;
  const desde = new Date(ahora);
  avisos.set(tokenId, { pendiente: true, mirado: ahora });
  const reloj = setTimeout(() => {
    comprobarConectorAntiguo(tokenId, desde)
      .catch((err) => logger.warn({ err: err.message, tokenId }, 'MCP: no se pudo avisar del Claude conectado a la manera de antes'))
      .finally(() => avisos.set(tokenId, { pendiente: false, mirado: Date.now() }));
  }, esperaMs);
  reloj.unref?.();
  return true;
}

/** Para las pruebas: si hay un aviso programado para esta URL. */
export const avisoPendiente = (tokenId) => avisos.get(tokenId)?.pendiente === true;

/** Para las pruebas: olvida los avisos programados. */
export function _olvidarAvisos() { avisos.clear(); }

/**
 * Pasada la espera: avisa al dueño si la URL sigue viva, si ese Claude no ha
 * terminado de conectarse desde `desde` y si no se le avisó en las últimas 20 h.
 * Devuelve true si ha avisado.
 */
export async function comprobarConectorAntiguo(tokenId, desde = new Date()) {
  const { rows: [t] } = await query(
    `SELECT t.id, t.user_id, t.nombre, c.label AS conexion
       FROM mcp_tokens t
       LEFT JOIN project_connectors c ON c.id = t.connector_id
      WHERE t.id = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > NOW())
        AND NOT EXISTS (SELECT 1 FROM mcp_conexiones x WHERE x.token_id = t.id AND x.created_at >= $2)
        AND NOT EXISTS (SELECT 1 FROM admin_notifications n
                         WHERE n.type = 'mcp_conector_antiguo' AND n.metadata->>'tokenId' = t.id::text
                           AND n.created_at > NOW() - INTERVAL '20 hours')`,
    [tokenId, desde]
  );
  if (!t) return false;
  await notifyUsers({
    targetUserIds: [t.user_id],
    type: 'mcp_conector_antiguo',
    title: 'Tu Claude tiene que conectarse una vez',
    message: `Un Claude intenta consultar el CRM con tu URL «${t.conexion || t.nombre}» sin haber iniciado sesión (se conectó a la manera de antes) y el CRM no le da datos. `
      + 'Hay que conectarlo UNA vez: en claude.ai o Claude Desktop, Configuración → Conectores → en el del CRM pulsa «Conectar» '
      + '(si no sale, quítalo y vuelve a añadirlo con la misma URL); en Claude Code, claude mcp add --transport http crm <tu URL>. '
      + 'Después autoriza ese Claude en Conexión → MCP y dale el código cuando te lo pida: no lo vuelve a pedir. '
      + 'Si no has sido tú, alguien tiene tu URL: revócala.',
    link_path: '/conexion/mcp',
    metadata: { tokenId: t.id },
  });
  logger.info({ userId: t.user_id, tokenId: t.id }, 'MCP: aviso de Claude conectado a la manera de antes');
  return true;
}

/**
 * La llave de una conexión que sigue viva, para el refresco de Claude: la misma
 * de siempre (ver `llaveDe`). null si la conexión ya no existe o la URL murió.
 */
export async function renovarLlave(conexionId) {
  const { rows: [c] } = await query(
    `SELECT x.id, x.llave_semilla
       FROM mcp_conexiones x
       JOIN mcp_tokens t ON t.id = x.token_id
      WHERE x.id = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > NOW())`,
    [conexionId]
  );
  return c ? { id: c.id, llave: llaveDe(c.llave_semilla).llave } : null;
}

/**
 * La conexión de una llave, con su URL viva. null si no existe o la URL murió:
 * revocar, caducar o dejar sin uso la URL corta todas sus conexiones.
 */
export async function buscarPorLlave(llave) {
  if (!pareceLlaveDeConexion(llave)) return null;
  const { rows: [c] } = await query(
    `SELECT x.id, x.token_id, x.user_id, x.estado, x.desbloqueada_at, t.connector_id, t.token_hash
       FROM mcp_conexiones x
       JOIN mcp_tokens t ON t.id = x.token_id
      WHERE x.llave_hash = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > NOW())`,
    [huella(llave)]
  );
  return c || null;
}

/** Una vez por minuto basta, como `marcarUso` de las URLs. */
export async function marcarUso(conexionId) {
  await query(
    `UPDATE mcp_conexiones SET last_used_at = NOW()
      WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '1 minute')`,
    [conexionId]
  );
}

/** El código bueno desbloquea ESTA conexión. Sin caducidad por horas (Carlos, 13/10). */
export async function desbloquear(conexionId, codigoId = null) {
  await query(
    `UPDATE mcp_conexiones SET desbloqueada_at = NOW(), codigo_id = $2 WHERE id = $1`,
    [conexionId, codigoId]
  );
}

/**
 * «Desbloquear desde aquí»: las conexiones AUTORIZADAS de una URL del dueño. Las
 * pendientes no: primero hay que autorizarlas. Devuelve cuántas.
 */
export async function desbloquearAutorizadasDeLaUrl(tokenId) {
  const { rowCount } = await query(
    `UPDATE mcp_conexiones SET desbloqueada_at = NOW(), codigo_id = NULL
      WHERE token_id = $1 AND estado = 'autorizada'`,
    [tokenId]
  );
  return rowCount;
}

/**
 * Autorizar o rechazar. El dueño, las suyas; el super admin solo puede
 * rechazar las de otros. Devuelve la conexión o un motivo:
 *   { conexion }            hecho
 *   { error: 'no_encontrada' | 'no_es_tuya' }
 */
export async function decidir({ id, quien, decision }) {
  const { rows: [x] } = await query('SELECT id, user_id, estado FROM mcp_conexiones WHERE id = $1', [id]);
  if (!x) return { error: 'no_encontrada' };
  const esDueno = Number(x.user_id) === Number(quien.id);
  // Rechazar la de otra persona: «Apagar el MCP» (#423; de serie, el superadmin).
  const puede = esDueno || (quien.puedeSupervisar === true && decision === 'rechazar');
  if (!puede) return { error: 'no_es_tuya' };
  const estado = decision === 'autorizar' ? 'autorizada' : 'rechazada';
  const { rows: [c] } = await query(
    `UPDATE mcp_conexiones
        SET estado = $2::varchar, decidida_at = NOW(), decidida_por = $3,
            -- Rechazada, también deja de estar desbloqueada.
            desbloqueada_at = CASE WHEN $2::varchar = 'rechazada' THEN NULL ELSE desbloqueada_at END
      WHERE id = $1
      RETURNING id, token_id, user_id, estado`,
    [id, estado, quien.id]
  );
  logger.info({ por: quien.id, conexionId: id, estado }, 'MCP: conexión de Claude decidida');
  return { conexion: c };
}

const CAMPOS_PANEL = `x.id, x.token_id, x.cliente, x.estado, x.created_at, x.last_used_at, x.decidida_at,
                      (x.desbloqueada_at IS NOT NULL) AS desbloqueada`;

/** Las conexiones de unas URLs, para el panel. Map tokenId → [conexiones], sin las rechazadas. */
export async function deLasUrls(tokenIds) {
  const ids = (tokenIds || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return new Map();
  const { rows } = await query(
    `SELECT ${CAMPOS_PANEL} FROM mcp_conexiones x
      WHERE x.token_id = ANY($1::int[]) AND x.estado <> 'rechazada'
      ORDER BY x.created_at`,
    [ids]
  );
  const porUrl = new Map();
  for (const r of rows) {
    if (!porUrl.has(r.token_id)) porUrl.set(r.token_id, []);
    porUrl.get(r.token_id).push(r);
  }
  return porUrl;
}

/**
 * Para el super admin: las conexiones vivas de OTRAS personas, para poder
 * rechazar cualquiera (Diana, 13/10).
 */
export async function delEquipo(quienId) {
  const { rows } = await query(
    `SELECT ${CAMPOS_PANEL}, u.nombre AS persona, COALESCE(c.label, t.nombre) AS url
       FROM mcp_conexiones x
       JOIN mcp_tokens t ON t.id = x.token_id
       JOIN users u ON u.id = x.user_id
       LEFT JOIN project_connectors c ON c.id = t.connector_id
      WHERE x.user_id <> $1 AND x.estado <> 'rechazada'
        AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > NOW())
      ORDER BY (x.estado = 'pendiente') DESC, x.created_at DESC
      LIMIT 200`,
    [quienId]
  );
  return rows;
}
