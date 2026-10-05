import crypto from 'crypto';
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { sendMcpBloqueoEmail } from '../../shared/services/brevo.service.js';

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

const entero = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : def;
};

/** Se lee en cada llamada: cambiar el .env y reiniciar basta, y las pruebas pueden tocarlo. */
export function config() {
  return {
    // Apagado por defecto: encenderlo sin avisar dejaría sin servicio a quien ya
    // lo usa. Se enciende cuando el panel ya explica cómo pedir el código.
    obligatorio: ['1', 'true', 'si', 'sí'].includes(String(process.env.MCP_CODIGO_OBLIGATORIO || '').toLowerCase()),
    minutosCodigo: entero(process.env.MCP_CODIGO_MINUTOS, 10),
    inactividadMin: entero(process.env.MCP_DESBLOQUEO_INACTIVIDAD_MIN, 120),
    maximoMin: entero(process.env.MCP_DESBLOQUEO_MAX_MIN, 540),
    maxFallos: entero(process.env.MCP_CODIGO_MAX_FALLOS, 5),
    bloqueoMin: entero(process.env.MCP_CODIGO_BLOQUEO_MIN, 15),
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

export const MENSAJE_SIN_DESBLOQUEAR =
  'Esta conexión con el CRM necesita un código para dar datos. Pide a la persona que entre en el CRM '
  + '→ Conexión → MCP → «Código para Claude» y te lo diga; después llama a la herramienta «desbloquear» con ese código.';

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
    let vigilan = String(process.env.MCP_AVISO_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!vigilan.length) {
      const { rows } = await query(`SELECT email FROM users WHERE role = 'superadmin' AND active = true`);
      vigilan = rows.map((r) => r.email);
    }
    const para = [...new Set([persona.email, ...vigilan])].map((email) => ({ email }));
    await sendMcpBloqueoEmail({ para, persona, hasta, maxFallos: config().maxFallos });
  } catch (err) {
    logger.warn({ err: err.message, userId, tokenId }, 'MCP: no se pudo enviar el aviso de bloqueo');
  }
}
