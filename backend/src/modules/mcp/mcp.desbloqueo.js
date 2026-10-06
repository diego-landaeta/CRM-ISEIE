import crypto from 'crypto';
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { sendMcpBloqueoEmail } from '../../shared/services/brevo.service.js';
import { destinatariosVigilancia } from './mcp.alertas.js';
import { enteroEnv, siNoEnv } from './mcp.config.js';

/**
 * Código de desbloqueo del MCP (#192): un segundo factor además de la URL.
 *
 * La persona pide un código en Conexión → MCP y se lo dice a Claude; Claude
 * llama a `desbloquear(codigo)` y, hasta entonces, ninguna herramienta da
 * datos.
 *
 * A QUÉ SE ATA. Investigado el 03/10 (comentario en la #192): en Claude Desktop
 * y claude.ai el conector comparte UNA sesión MCP entre todos los chats, así
 * que el CRM no ve cuándo empieza una conversación. El desbloqueo se ata a la
 * CONEXIÓN (el token) y caduca por inactividad, con un máximo absoluto. Una
 * sola regla para todos los clientes: 2 h sin uso y máximo 9 h.
 *
 * Las horas se comparan siempre con NOW() de Postgres, no con el reloj de Node:
 * así no hay dos relojes que puedan no coincidir.
 */

/** Se lee en cada llamada: cambiar el .env y reiniciar basta, y las pruebas pueden tocarlo. */
export function config() {
  return {
    // Apagado por defecto: encenderlo sin avisar dejaría sin servicio a quien ya
    // lo usa. Se enciende cuando el panel ya explica cómo pedir el código.
    obligatorio: siNoEnv('MCP_CODIGO_OBLIGATORIO', false),
    minutosCodigo: enteroEnv('MCP_CODIGO_MINUTOS', 10),
    inactividadMin: enteroEnv('MCP_DESBLOQUEO_INACTIVIDAD_MIN', 120),
    maximoMin: enteroEnv('MCP_DESBLOQUEO_MAX_MIN', 540),
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
export const MENSAJE_SIN_DESBLOQUEAR =
  'Esta conexión con el CRM necesita desbloquearse para dar datos. '
  + 'Si no tienes la herramienta «desbloquear», no pidas el código (no podrías usarlo): pide a la persona que pulse '
  + '«Desbloquear desde aquí» en el CRM → Conexión → MCP, junto a su URL, y después vuelve a consultar. '
  + 'Si la tienes, pide a la persona el código de CRM → Conexión → MCP → «Código para Claude» y llama a «desbloquear» con él.';

const ZONA = () => process.env.APP_TIMEZONE || 'Europe/Madrid';

/** «16:55», con la hora de Madrid. */
export const horaLocal = (fecha) => new Date(fecha).toLocaleTimeString('es-ES', {
  hour: '2-digit', minute: '2-digit', timeZone: ZONA(),
});

/** «las 16:55», o «mañana a las 00:40» si cae en otro día (el máximo son 9 h). */
function cuando(fecha) {
  const dia = (d) => new Date(d).toLocaleDateString('es-ES', { timeZone: ZONA() });
  return `${dia(fecha) === dia(Date.now()) ? '' : 'mañana '}a las ${horaLocal(fecha)}`;
}

// ─── Base de datos ────────────────────────────────────────────────────────

/** Un código nuevo para la persona. Anula los que tuviera sin usar: solo vale el último. */
export async function crearCodigo(userId) {
  const { minutosCodigo } = config();
  const codigo = generarCodigo();
  await query(
    `UPDATE mcp_codigos SET anulado_at = NOW()
      WHERE user_id = $1 AND usado_at IS NULL AND anulado_at IS NULL`,
    [userId]
  );
  const { rows } = await query(
    `INSERT INTO mcp_codigos (user_id, codigo_hash, caduca_at)
     VALUES ($1, $2, NOW() + make_interval(mins => $3::int))
     RETURNING id, caduca_at`,
    [userId, huellaCodigo(codigo), minutosCodigo]
  );
  return { codigo, caducaAt: rows[0].caduca_at, minutos: minutosCodigo };
}

/** Si la conexión está bloqueada o desbloqueada AHORA. */
export async function estadoDeLaConexion(tokenId) {
  const { inactividadMin } = config();
  const { rows } = await query(
    `SELECT t.bloqueado_hasta,
            (t.bloqueado_hasta IS NOT NULL AND t.bloqueado_hasta > NOW()) AS bloqueado,
            EXISTS (SELECT 1 FROM mcp_desbloqueos d
                     WHERE d.token_id = t.id
                       AND d.caduca_max_at > NOW()
                       AND d.ultimo_uso_at > NOW() - make_interval(mins => $2::int)) AS desbloqueado
       FROM mcp_tokens t WHERE t.id = $1`,
    [tokenId, inactividadMin]
  );
  return rows[0] || { bloqueado: false, desbloqueado: false, bloqueado_hasta: null };
}

/**
 * Cuándo volverá a pedir el código cada URL, para el panel (#192, Diego 05/10).
 *
 * Devuelve un Map tokenId → { estado, hasta, texto } con uno de:
 *   'bloqueada'        por códigos falsos; `hasta` = bloqueado_hasta
 *   'desbloqueada'     `hasta` = la menor de último uso + inactividad y el máximo
 *   'sin_desbloquear'  sin desbloqueo, o ya pasó: lo pide en la próxima consulta
 * Con el código apagado, el Map va vacío: no se enseña nada.
 *
 * La cuenta es la misma que la de `estadoDeLaConexion` (desbloqueada si esa
 * menor hora aún no ha llegado), y se hace aquí para no repetirla en el frontal.
 */
export async function estadoParaElPanel(tokenIds) {
  const { obligatorio, inactividadMin } = config();
  const ids = (tokenIds || []).map(Number).filter(Number.isInteger);
  if (!obligatorio || !ids.length) return new Map();
  const { rows } = await query(
    `SELECT t.id, t.bloqueado_hasta,
            (t.bloqueado_hasta IS NOT NULL AND t.bloqueado_hasta > NOW()) AS bloqueado,
            d.caduca_max_at,
            LEAST(d.ultimo_uso_at + make_interval(mins => $2::int), d.caduca_max_at) AS pide_a,
            (d.token_id IS NOT NULL
              AND LEAST(d.ultimo_uso_at + make_interval(mins => $2::int), d.caduca_max_at) > NOW()) AS desbloqueado
       FROM mcp_tokens t
       LEFT JOIN mcp_desbloqueos d ON d.token_id = t.id
      WHERE t.id = ANY($1::int[])`,
    [ids, inactividadMin]
  );
  const horas = inactividadMin % 60 === 0 ? `${inactividadMin / 60} h` : `${inactividadMin} min`;
  return new Map(rows.map((r) => {
    if (r.bloqueado) {
      return [r.id, { estado: 'bloqueada', hasta: r.bloqueado_hasta, texto: `Bloqueada hasta ${cuando(r.bloqueado_hasta).replace(/^a /, '')}` }];
    }
    if (r.desbloqueado) {
      // Si la hora sale del máximo, usarla no la alarga; si sale de la
      // inactividad, cada consulta la empuja, como mucho hasta el máximo.
      const porMaximo = new Date(r.pide_a).getTime() >= new Date(r.caduca_max_at).getTime();
      return [r.id, {
        estado: 'desbloqueada',
        hasta: r.pide_a,
        texto: porMaximo
          ? `Pedirá el código ${cuando(r.pide_a)}`
          : `Pedirá el código ${cuando(r.pide_a)} si pasan ${horas} sin usarla (como muy tarde, ${cuando(r.caduca_max_at)})`,
      }];
    }
    return [r.id, { estado: 'sin_desbloquear', hasta: null, texto: 'Pedirá el código en la próxima consulta' }];
  }));
}

/**
 * «El estado actual en una línea» para «Código para Claude» (#192, Diego 05/10).
 *
 * El estado es de cada URL, y un admin puede tener varias (una por conexión).
 * Con una sola, la línea es la suya (`una`, con su botón). Con varias, un
 * resumen de todas, sin elegir ninguna por la persona: «Tus 3 URLs: 1
 * desbloqueada (pedirá el código a las 16:15), 2 cerradas». El detalle de cada
 * una está en la tabla. null con el código apagado o sin URLs.
 */
export function resumenParaElPanel(urls, estados) {
  const conEstado = (urls || []).filter((u) => estados.get(u.id)).map((u) => ({ ...u, ...estados.get(u.id) }));
  if (!conEstado.length) return null;
  if (conEstado.length === 1) return { total: 1, una: conEstado[0], texto: conEstado[0].texto };
  const de = (estado) => conEstado.filter((u) => u.estado === estado);
  const primera = (lista) => lista.map((u) => u.hasta).sort((a, b) => new Date(a) - new Date(b))[0];
  const partes = [];
  const desbloqueadas = de('desbloqueada');
  if (desbloqueadas.length) {
    partes.push(desbloqueadas.length === 1
      ? `1 desbloqueada (pedirá el código ${cuando(desbloqueadas[0].hasta)})`
      : `${desbloqueadas.length} desbloqueadas (la primera pedirá el código ${cuando(primera(desbloqueadas))})`);
  }
  const bloqueadas = de('bloqueada');
  if (bloqueadas.length) {
    partes.push(bloqueadas.length === 1
      ? `1 bloqueada (hasta ${cuando(bloqueadas[0].hasta).replace(/^a /, '')})`
      : `${bloqueadas.length} bloqueadas`);
  }
  const cerradas = de('sin_desbloquear');
  if (cerradas.length) partes.push(`${cerradas.length} cerrada${cerradas.length === 1 ? '' : 's'} (pedirá${cerradas.length === 1 ? '' : 'n'} el código en la próxima consulta)`);
  return { total: conEstado.length, una: null, texto: `Tus ${conEstado.length} URLs: ${partes.join(', ')}` };
}

/**
 * «Desbloquear desde aquí» (#192, Diego 05/10, opción 3): la persona, que ya ha
 * entrado al CRM, desbloquea SU URL desde el panel. Sirve aunque su Claude no
 * vea `desbloquear` (claude.ai guarda la lista de herramientas al conectar).
 * Las mismas reglas que con el código: 2 h sin uso y 9 h como máximo.
 *
 * Devuelve { resultado } con uno de:
 *   'ok'            trae `caducaMaxAt`
 *   'no_encontrada' no existe, es de otra persona, está revocada o caducada
 *   'ya_bloqueada'  bloqueada por códigos falsos: se espera a `hasta`
 */
export async function desbloquearDesdePanel({ userId, tokenId }) {
  const { maximoMin } = config();
  const { rows: [t] } = await query(
    `SELECT id, (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > NOW()) AS bloqueado, bloqueado_hasta
       FROM mcp_tokens
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`,
    [tokenId, userId]
  );
  if (!t) return { resultado: 'no_encontrada' };
  if (t.bloqueado) return { resultado: 'ya_bloqueada', hasta: t.bloqueado_hasta };
  const { rows } = await query(
    `INSERT INTO mcp_desbloqueos (token_id, user_id, codigo_id, desbloqueado_at, ultimo_uso_at, caduca_max_at)
     VALUES ($1, $2, NULL, NOW(), NOW(), NOW() + make_interval(mins => $3::int))
     ON CONFLICT (token_id) DO UPDATE
       SET codigo_id = NULL, desbloqueado_at = NOW(), ultimo_uso_at = NOW(),
           caduca_max_at = EXCLUDED.caduca_max_at, user_id = EXCLUDED.user_id
     RETURNING caduca_max_at`,
    [tokenId, userId, maximoMin]
  );
  await query(`UPDATE mcp_tokens SET fallos_codigo = 0 WHERE id = $1`, [tokenId]);
  return { resultado: 'ok', caducaMaxAt: rows[0].caduca_max_at };
}

/** Cada consulta con la conexión desbloqueada alarga la inactividad (no el máximo). */
export async function marcarUsoDesbloqueo(tokenId) {
  await query(`UPDATE mcp_desbloqueos SET ultimo_uso_at = NOW() WHERE token_id = $1`, [tokenId]);
}

/**
 * Comprueba un código para una conexión.
 *
 * Devuelve { resultado } con uno de:
 *   'ok'            desbloqueada; trae `caducaMaxAt`
 *   'incorrecto'    no vale (mal escrito, caducado, usado o de otra persona); trae `quedan`
 *   'bloqueada'     acaba de llegar al tope de fallos; trae `hasta`
 *   'ya_bloqueada'  estaba bloqueada de antes; trae `hasta`
 *
 * El código se marca usado con un UPDATE ... RETURNING: dos peticiones a la vez
 * con el mismo código no pueden usarlo las dos.
 */
export async function intentarDesbloqueo({ userId, tokenId, codigo }) {
  const { maxFallos, bloqueoMin, maximoMin } = config();

  const estado = await estadoDeLaConexion(tokenId);
  if (estado.bloqueado) return { resultado: 'ya_bloqueada', hasta: estado.bloqueado_hasta };

  const { rows: usado } = await query(
    `UPDATE mcp_codigos SET usado_at = NOW(), token_id = $3
      WHERE user_id = $1 AND codigo_hash = $2
        AND usado_at IS NULL AND anulado_at IS NULL AND caduca_at > NOW()
      RETURNING id`,
    [userId, huellaCodigo(codigo), tokenId]
  );

  if (usado[0]) {
    const { rows } = await query(
      `INSERT INTO mcp_desbloqueos (token_id, user_id, codigo_id, desbloqueado_at, ultimo_uso_at, caduca_max_at)
       VALUES ($1, $2, $3, NOW(), NOW(), NOW() + make_interval(mins => $4::int))
       ON CONFLICT (token_id) DO UPDATE
         SET codigo_id = EXCLUDED.codigo_id, desbloqueado_at = NOW(), ultimo_uso_at = NOW(),
             caduca_max_at = EXCLUDED.caduca_max_at, user_id = EXCLUDED.user_id
       RETURNING caduca_max_at`,
      [tokenId, userId, usado[0].id, maximoMin]
    );
    await query(`UPDATE mcp_tokens SET fallos_codigo = 0 WHERE id = $1`, [tokenId]);
    return { resultado: 'ok', caducaMaxAt: rows[0].caduca_max_at };
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
  return { resultado: 'incorrecto', quedan: maxFallos - (f[0]?.fallos_codigo || 0) };
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
