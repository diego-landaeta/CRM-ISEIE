import crypto from 'crypto';
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { sendMcpBloqueoEmail } from '../../shared/services/brevo.service.js';
import { destinatariosVigilancia } from './mcp.alertas.js';
import { enteroEnv, siNoEnv } from './mcp.config.js';
import * as conexiones from './mcp.conexiones.js';

/**
 * Código de desbloqueo del MCP (#192): un segundo factor además de la URL.
 *
 * La persona pide un código en Conexión → MCP y se lo dice a Claude; Claude
 * llama a `desbloquear(codigo)` y, hasta entonces, ninguna herramienta da
 * datos.
 *
 * A QUÉ SE ATA (#326, 13/10). A cada Claude conectado (mcp.conexiones.js), no
 * a la URL: otro Claude con la misma URL no queda desbloqueado. Y SIN
 * caducidad por horas (Carlos: tenía que meter el código varias veces al día):
 * vale mientras la conexión siga autorizada y la URL viva. Antes eran 2 h sin
 * uso y 9 h como máximo, por URL (`mcp_desbloqueos`, que ya no se usa).
 *
 * Los fallos y el bloqueo de 15 minutos siguen siendo de la URL: quien prueba
 * códigos a ciegas la bloquea para todas sus conexiones.
 *
 * EL CÓDIGO ES DE UNA URL (#260, Diego 07/10). Se saca desde la fila de cada URL
 * (`POST /panel/tokens/:id/codigo`), nace con su `token_id` y SOLO desbloquea
 * esa URL: usado con otra, no vale. Antes era de la persona y el panel sacaba
 * uno aunque no hubiera ninguna URL viva en el ámbito que se estaba mirando.
 * Sin URL no hay código.
 */

/** Se lee en cada llamada: cambiar el .env y reiniciar basta, y las pruebas pueden tocarlo. */
export function config() {
  return {
    // Apagado por defecto: encenderlo sin avisar dejaría sin servicio a quien ya
    // lo usa. Se enciende cuando el panel ya explica cómo pedir el código.
    obligatorio: siNoEnv('MCP_CODIGO_OBLIGATORIO', false),
    minutosCodigo: enteroEnv('MCP_CODIGO_MINUTOS', 10),
    maxFallos: enteroEnv('MCP_CODIGO_MAX_FALLOS', 5),
    bloqueoMin: enteroEnv('MCP_CODIGO_BLOQUEO_MIN', 15),
  };
}

// Sin 0/O ni 1/I/L: se dicta o se copia a mano y no tiene que haber dudas.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LARGO = 8;

/** «K7QM-2XPA»: 8 caracteres, con guion para leerlo mejor. */
export function generarCodigo() {
  const bytes = crypto.randomBytes(LARGO);
  let c = '';
  for (let i = 0; i < LARGO; i++) c += ALFABETO[bytes[i] % ALFABETO.length];
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** Lo que escriba Claude («k7qm 2xpa», «K7QM-2XPA»…) a la forma guardada. */
export function normalizar(codigo) {
  return String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function huellaCodigo(codigo) {
  return crypto.createHash('sha256').update(normalizar(codigo)).digest('hex');
}

// claude.ai guarda la lista de herramientas del momento en que se conectó y no
// la vuelve a pedir (#192, 05/10): quien conectó con el código apagado no tiene
// «desbloquear». Para eso está el botón del panel, y el mensaje lo pone PRIMERO:
// probado con claude.ai (06/10), con el botón al final Claude pedía antes el
// código, que sin la herramienta no puede usar.
//
// #260: el código es de una URL, así que el mensaje remite a la fila de ESA URL.
// `url`: el nombre con el que la persona la reconoce. Empieza igual que siempre
// (`BARRERA_DEL_CODIGO` de mcp.alertas.js lo reconoce por el principio).
export function mensajeSinDesbloquear(url = null) {
  const cual = url ? `de la URL «${url}»` : 'de la URL con la que está conectado este Claude';
  return 'Esta conexión con el CRM necesita desbloquearse para dar datos. '
    + 'Si no tienes la herramienta «desbloquear», no pidas el código (no podrías usarlo): pide a la persona que pulse '
    + `«Desbloquear desde aquí» en el CRM → Conexión → MCP, en la fila ${cual}, y después vuelve a consultar. `
    + `Si la tienes, pide a la persona el código ${cual}: se saca en esa misma fila, con «Sacar código». `
    + 'Un código solo vale para la URL en cuya fila se sacó. Cuando lo tengas, llama a «desbloquear» con él.';
}
export const MENSAJE_SIN_DESBLOQUEAR = mensajeSinDesbloquear();

// #326: cada Claude conectado a una URL espera a que el dueño lo autorice.
export const MENSAJE_PENDIENTE =
  'Esta conexión de Claude está pendiente de autorizar: es la primera vez que este Claude se conecta con esta URL. '
  + 'Pide a la persona que la autorice en el CRM → Conexión → MCP, debajo de su URL, y después vuelve a consultar. '
  + 'Si no es la persona dueña de la URL, no podrá autorizarla.';
export const MENSAJE_RECHAZADA =
  'El dueño de esta URL ha rechazado esta conexión de Claude: no puede consultar el CRM. '
  + 'Cada persona tiene que conectar Claude con SU propia URL (CRM → Conexión → MCP).';

const ZONA = () => process.env.APP_TIMEZONE || 'Europe/Madrid';

/** «16:55», con la hora de Madrid. */
export const horaLocal = (fecha) => new Date(fecha).toLocaleTimeString('es-ES', {
  hour: '2-digit', minute: '2-digit', timeZone: ZONA(),
});

/** «las 16:55», o «mañana a las 00:40» si cae en otro día. */
function cuando(fecha) {
  const dia = (d) => new Date(d).toLocaleDateString('es-ES', { timeZone: ZONA() });
  return `${dia(fecha) === dia(Date.now()) ? '' : 'mañana '}a las ${horaLocal(fecha)}`;
}

// ─── Base de datos ────────────────────────────────────────────────────────

/** El nombre con el que la persona reconoce una URL (el de su conexión, o el que le puso). */
export async function nombreDeLaUrl(tokenId) {
  const { rows: [r] } = await query(
    `SELECT COALESCE(c.label, t.nombre) AS nombre
       FROM mcp_tokens t LEFT JOIN project_connectors c ON c.id = t.connector_id
      WHERE t.id = $1`,
    [tokenId]
  );
  return r?.nombre || null;
}

/**
 * Un código nuevo PARA ESTA URL (#260). Anula los que tuviera sin usar para la
 * misma URL: solo vale el último. Los de sus otras URLs no se tocan.
 *
 * Devuelve { resultado } con uno de:
 *   'ok'            trae `codigo`, `caducaAt` y `minutos`
 *   'no_encontrada' no existe, es de otra persona, está revocada o caducada
 *   'ya_bloqueada'  bloqueada por códigos falsos: se espera a `hasta`
 */
export async function crearCodigo({ userId, tokenId }) {
  const { rows: [t] } = await query(
    `SELECT id, (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > NOW()) AS bloqueado, bloqueado_hasta
       FROM mcp_tokens
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`,
    [tokenId, userId]
  );
  if (!t) return { resultado: 'no_encontrada' };
  if (t.bloqueado) return { resultado: 'ya_bloqueada', hasta: t.bloqueado_hasta };

  const { minutosCodigo } = config();
  const codigo = generarCodigo();
  await query(
    `UPDATE mcp_codigos SET anulado_at = NOW()
      WHERE user_id = $1 AND token_id = $2 AND usado_at IS NULL AND anulado_at IS NULL`,
    [userId, tokenId]
  );
  const { rows } = await query(
    `INSERT INTO mcp_codigos (user_id, token_id, codigo_hash, caduca_at)
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4::int))
     RETURNING id, caduca_at`,
    [userId, tokenId, huellaCodigo(codigo), minutosCodigo]
  );
  return { resultado: 'ok', codigo, caducaAt: rows[0].caduca_at, minutos: minutosCodigo };
}

/** Si la URL está bloqueada por códigos falsos AHORA. El desbloqueo es de cada conexión (#326). */
export async function estadoDeLaConexion(tokenId) {
  const { rows } = await query(
    `SELECT t.bloqueado_hasta,
            (t.bloqueado_hasta IS NOT NULL AND t.bloqueado_hasta > NOW()) AS bloqueado
       FROM mcp_tokens t WHERE t.id = $1`,
    [tokenId]
  );
  return rows[0] || { bloqueado: false, bloqueado_hasta: null };
}

/** «1 Claude», «2 Claude»… para los textos del panel. */
const claudes = (n) => `${n} Claude`;

/** Para una URL que su Claude usaba sin iniciar sesión (antes de la #326). Diego, 22/10. */
export const TEXTO_RECONECTAR = 'Tu Claude se conectó con esta URL a la manera de antes y ya no puede consultar: '
  + 'conéctalo una vez (en Claude, Configuración → Conectores → «Conectar» en el del CRM, o quítalo y vuelve a añadirlo con esta URL), '
  + 'autorízalo aquí y dale el código. No se vuelve a pedir.';

/**
 * El estado de cada URL para el panel (#192, Diego 05/10; #326, 13/10).
 *
 * Devuelve un Map tokenId → { estado, hasta, texto, conexiones } con uno de:
 *   'bloqueada'        por códigos falsos; `hasta` = bloqueado_hasta
 *   'pendiente'        algún Claude conectado espera a que lo autorices
 *   'desbloqueada'     algún Claude autorizado ya metió el código
 *   'sin_desbloquear'  ningún Claude conectado, o los autorizados aún sin código
 * `conexiones`: cada Claude conectado con esta URL (sin los rechazados), para
 * autorizarlo o rechazarlo debajo de la URL. Ya no hay horas: el desbloqueo no
 * caduca (Carlos, 13/10). Con el código apagado, el Map va vacío.
 */
export async function estadoParaElPanel(tokenIds) {
  const { obligatorio } = config();
  const ids = (tokenIds || []).map(Number).filter(Number.isInteger);
  if (!obligatorio || !ids.length) return new Map();
  const { rows } = await query(
    `SELECT t.id, t.bloqueado_hasta,
            (t.bloqueado_hasta IS NOT NULL AND t.bloqueado_hasta > NOW()) AS bloqueado,
            (t.anterior_a_conexiones AND t.last_used_at IS NOT NULL) AS usada_a_la_manera_de_antes
       FROM mcp_tokens t
      WHERE t.id = ANY($1::int[])`,
    [ids]
  );
  const porUrl = await conexiones.deLasUrls(ids);
  return new Map(rows.map((r) => {
    const lista = porUrl.get(r.id) || [];
    const pendientes = lista.filter((c) => c.estado === 'pendiente').length;
    const abiertas = lista.filter((c) => c.estado === 'autorizada' && c.desbloqueada).length;
    const cerradas = lista.filter((c) => c.estado === 'autorizada' && !c.desbloqueada).length;
    const base = { conexiones: lista };
    if (r.bloqueado) {
      return [r.id, { ...base, estado: 'bloqueada', hasta: r.bloqueado_hasta, texto: `Bloqueada hasta ${cuando(r.bloqueado_hasta).replace(/^a /, '')}` }];
    }
    if (!lista.length) {
      // Diego, 22/10: una URL de antes de la #326 que su Claude usaba sin iniciar
      // sesión. Ese Claude ya no consulta y no se reconecta solo: se dice aquí,
      // debajo de la URL, qué hay que hacer (y una vez al día, a la campana).
      if (r.usada_a_la_manera_de_antes) {
        return [r.id, { ...base, estado: 'sin_desbloquear', hasta: null, texto: TEXTO_RECONECTAR }];
      }
      return [r.id, { ...base, estado: 'sin_desbloquear', hasta: null, texto: 'Ningún Claude conectado todavía con esta URL' }];
    }
    const partes = [];
    if (abiertas) partes.push(`${claudes(abiertas)} autorizado y desbloqueado${abiertas === 1 ? '' : 's'}`);
    if (cerradas) partes.push(`${claudes(cerradas)} autorizado${cerradas === 1 ? '' : 's'} (pedirá el código en la próxima consulta)`);
    if (pendientes) partes.push(`${claudes(pendientes)} pendiente${pendientes === 1 ? '' : 's'} de autorizar`);
    const estado = pendientes ? 'pendiente' : abiertas ? 'desbloqueada' : 'sin_desbloquear';
    return [r.id, { ...base, estado, hasta: null, texto: partes.join(' · ') }];
  }));
}

/**
 * «Desbloquear desde aquí» (#192, Diego 05/10, opción 3): la persona, que ya ha
 * entrado al CRM, desbloquea SU URL desde el panel, sin código. Desde la #326
 * desbloquea los Claude AUTORIZADOS de esa URL; los pendientes, no: primero hay
 * que autorizarlos. Sin caducidad por horas.
 *
 * Devuelve { resultado } con uno de:
 *   'ok'              trae `cuantas`
 *   'sin_autorizadas' no hay ningún Claude autorizado en esa URL
 *   'no_encontrada'   no existe, es de otra persona, está revocada o caducada
 *   'ya_bloqueada'    bloqueada por códigos falsos: se espera a `hasta`
 */
export async function desbloquearDesdePanel({ userId, tokenId }) {
  const { rows: [t] } = await query(
    `SELECT id, (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > NOW()) AS bloqueado, bloqueado_hasta
       FROM mcp_tokens
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`,
    [tokenId, userId]
  );
  if (!t) return { resultado: 'no_encontrada' };
  if (t.bloqueado) return { resultado: 'ya_bloqueada', hasta: t.bloqueado_hasta };
  const cuantas = await conexiones.desbloquearAutorizadasDeLaUrl(tokenId);
  if (!cuantas) return { resultado: 'sin_autorizadas' };
  // NO se pone `fallos_codigo` a 0 (#262): el contador está para parar a quien prueba
  // códigos, y un botón que lo borrara sería otra forma de saltárselo. Solo lo vacía
  // un código bueno.
  return { resultado: 'ok', cuantas };
}

/**
 * Comprueba un código para un Claude conectado (`conexionId`, #326): el código
 * bueno desbloquea ESA conexión, sin caducidad por horas.
 *
 * Devuelve { resultado } con uno de:
 *   'ok'               desbloqueada
 *   'de_otra_persona'  es un código vigente, pero de OTRA persona: la URL se está
 *                      usando por quien no es su dueño; trae `urlDe` y `codigoDe`
 *                      ({ id, nombre }). No suma fallo
 *   'de_otra_url'      es un código vigente de esta persona, pero de OTRA de sus
 *                      URLs (#260): aquí no vale. Suma fallo; trae `quedan` y `urlDe`
 *   'incorrecto'       no vale (mal escrito, caducado o usado); trae `quedan`
 *   'bloqueada'        acaba de llegar al tope de fallos; trae `hasta`
 *   'ya_bloqueada'     estaba bloqueada de antes; trae `hasta`
 *
 * El código se marca usado con un UPDATE ... RETURNING: dos peticiones a la vez
 * con el mismo código no pueden usarlo las dos.
 */
export async function intentarDesbloqueo({ userId, tokenId, conexionId, codigo }) {
  const { maxFallos, bloqueoMin } = config();

  const estado = await estadoDeLaConexion(tokenId);
  if (estado.bloqueado) return { resultado: 'ya_bloqueada', hasta: estado.bloqueado_hasta };

  const { rows: usado } = await query(
    `UPDATE mcp_codigos SET usado_at = NOW()
      WHERE user_id = $1 AND codigo_hash = $2 AND token_id = $3
        AND usado_at IS NULL AND anulado_at IS NULL AND caduca_at > NOW()
      RETURNING id`,
    [userId, huellaCodigo(codigo), tokenId]
  );

  if (usado[0]) {
    await conexiones.desbloquear(conexionId, usado[0].id);
    await query(`UPDATE mcp_tokens SET fallos_codigo = 0 WHERE id = $1`, [tokenId]);
    return { resultado: 'ok' };
  }

  // ¿Es un código bueno, pero de OTRA persona? (Diego, 13/10.) La alerta «de
  // madrugada» de Tony del 13/10 era Yolanda con la URL de Tony en su Claude:
  // sacó sus propios códigos en el panel y los probó con esa URL, y solo veía
  // «el código no vale», sin saber por qué. Los códigos son por persona y la URL
  // también: aquí se le dice de quién es la URL y que use la suya, y se avisa de
  // que esa URL está compartida.
  //
  // NO suma a `fallos_codigo`, y es a propósito. Ese contador está para parar a
  // quien prueba códigos a ciegas, y esto no lo es: el código existe, está
  // vigente y lo sacó una persona con acceso al CRM. Sumarlo bloquearía al DUEÑO
  // de la URL (Tony) 15 minutos por el error de otra persona, que es peor que el
  // propio error. Tampoco abre la puerta a probar sin límite: un código inventado
  // no es de nadie y sigue sumando como siempre. Y el código no se gasta: sigue
  // valiendo para la URL de quien lo sacó, que es justo lo que se le pide hacer.
  const { rows: [ajeno] } = await query(
    `SELECT c.user_id AS codigo_de, uc.nombre AS codigo_de_nombre, ut.nombre AS url_de_nombre
       FROM mcp_codigos c
       JOIN users uc ON uc.id = c.user_id
       JOIN users ut ON ut.id = $1
      WHERE c.codigo_hash = $2 AND c.user_id <> $1
        AND c.usado_at IS NULL AND c.anulado_at IS NULL AND c.caduca_at > NOW()
      LIMIT 1`,
    [userId, huellaCodigo(codigo)]
  );
  if (ajeno) {
    return {
      resultado: 'de_otra_persona',
      urlDe: { id: userId, nombre: ajeno.url_de_nombre },
      codigoDe: { id: ajeno.codigo_de, nombre: ajeno.codigo_de_nombre },
    };
  }

  // Fallo: se suma y, al llegar al tope, se bloquea y se pone el contador a cero.
  const { rows: f } = await query(
    `UPDATE mcp_tokens
        SET fallos_codigo = CASE WHEN fallos_codigo + 1 >= $2 THEN 0 ELSE fallos_codigo + 1 END,
            bloqueado_hasta = CASE WHEN fallos_codigo + 1 >= $2
                                   THEN NOW() + make_interval(mins => $3::int) ELSE bloqueado_hasta END
      WHERE id = $1
      RETURNING fallos_codigo, bloqueado_hasta, (bloqueado_hasta > NOW()) AS bloqueado`,
    [tokenId, maxFallos, bloqueoMin]
  );
  if (f[0]?.bloqueado) return { resultado: 'bloqueada', hasta: f[0].bloqueado_hasta };
  const quedan = maxFallos - (f[0]?.fallos_codigo || 0);

  // ¿Es un código bueno de esta persona, pero de OTRA de sus URLs? (#260.) Se le
  // dice, para que no dé vueltas. SÍ suma fallo (arriba): decir «este código
  // existe» sin contar sería probar códigos gratis para quien tuviera una URL de
  // la persona. El código no se gasta: sigue valiendo en la fila donde se sacó.
  const { rows: [deOtra] } = await query(
    `SELECT COALESCE(pc.label, t.nombre) AS nombre
       FROM mcp_codigos c
       JOIN mcp_tokens t ON t.id = c.token_id
       LEFT JOIN project_connectors pc ON pc.id = t.connector_id
      WHERE c.user_id = $1 AND c.codigo_hash = $2 AND c.token_id <> $3
        AND c.usado_at IS NULL AND c.anulado_at IS NULL AND c.caduca_at > NOW()
      LIMIT 1`,
    [userId, huellaCodigo(codigo), tokenId]
  );
  if (deOtra) return { resultado: 'de_otra_url', quedan, urlDe: deOtra.nombre };
  return { resultado: 'incorrecto', quedan };
}

/**
 * Aviso por correo al dueño de la conexión y a quien vigila (Diego):
 * MCP_AVISO_EMAIL en el .env (separados por comas) o, si no está, los super
 * admin activos. Nunca hace fallar la consulta: si el correo no sale, se anota.
 */
export async function avisarBloqueo({ userId, tokenId, hasta }) {
  try {
    const { rows: [persona] } = await query(
      `SELECT u.nombre, u.email, t.nombre AS conexion, t.prefijo
         FROM users u JOIN mcp_tokens t ON t.user_id = u.id
        WHERE u.id = $1 AND t.id = $2`,
      [userId, tokenId]
    );
    if (!persona) return;
    const vigilan = await destinatariosVigilancia();
    const para = [...new Set([persona.email, ...vigilan])].map((email) => ({ email }));
    await sendMcpBloqueoEmail({ para, persona, hasta, maxFallos: config().maxFallos });
  } catch (err) {
    logger.warn({ err: err.message, userId, tokenId }, 'MCP: no se pudo enviar el aviso de bloqueo');
  }
}
