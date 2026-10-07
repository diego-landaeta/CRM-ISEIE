import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * Interruptor de emergencia del MCP (#196).
 *
 * Apagado, NINGUNA URL del MCP da datos. El inicio de sesión OAuth no responde
 * (503). La URL personal y la de cabecera sí contestan, pero cada herramienta
 * devuelve solo MENSAJE_APAGADO: con un 503, Claude Desktop no le pasaba el
 * texto a Claude, que decía «error de servidor, reintenta o pásame un código».
 * Diego lo autorizó el 03/10. El panel del CRM responde siempre: es desde
 * donde se vuelve a encender.
 *
 *   · MCP_DISABLED=1 en el .env: apagado desde el servidor. El botón no lo
 *     enciende; hay que quitarlo del .env y reiniciar.
 *   · El botón del super admin: apaga o enciende al momento. Se guarda en
 *     `mcp_interruptor`, así vale para todos los procesos y sobrevive a un
 *     reinicio.
 *
 * Se mira en cada petición: una consulta de una fila por clave primaria. Es lo
 * que hace que el botón corte «al momento» y no al cabo de un rato.
 */

export const MENSAJE_APAGADO = 'El MCP del CRM está apagado, active para poder acceder a los datos';

export const apagadoPorEnv =() => ['1', 'true', 'si', 'sí'].includes(String(process.env.MCP_DISABLED || '').toLowerCase());

export async function estado() {
  const { rows: [f] } = await query(
    `SELECT i.apagado, i.cambiado_at, i.motivo, u.nombre AS cambiado_por
       FROM mcp_interruptor i LEFT JOIN users u ON u.id = i.cambiado_por
      WHERE i.id = 1`
  );
  const porEnv = apagadoPorEnv();
  return {
    apagado: porEnv || Boolean(f?.apagado),
    porEnv,
    porBoton: Boolean(f?.apagado),
    cambiadoPor: f?.cambiado_por || null,
    cambiadoAt: f?.cambiado_at || null,
    motivo: f?.motivo || null,
  };
}

export async function cambiar({ userId, apagado, motivo = null }) {
  await query(
    `INSERT INTO mcp_interruptor (id, apagado, cambiado_por, cambiado_at, motivo)
     VALUES (1, $1, $2, NOW(), $3)
     ON CONFLICT (id) DO UPDATE SET apagado = $1, cambiado_por = $2, cambiado_at = NOW(), motivo = $3`,
    [apagado, userId, motivo]
  );
  logger.warn({ userId, apagado, motivo }, apagado ? 'MCP: APAGADO con el interruptor' : 'MCP: encendido con el interruptor');
  return estado();
}

/** POST al MCP (la URL de cabecera o la personal), no OAuth. */
const esPeticionMcp = (req) => req.method === 'POST' && (req.path === '/' || req.path.startsWith('/u/'));

/**
 * Middleware para todo lo del MCP salvo el panel. Apagado, a las peticiones
 * del MCP las marca (`req.mcpApagado`) y las deja seguir: el token se sigue
 * comprobando y las herramientas contestan MENSAJE_APAGADO. El resto (OAuth),
 * 503.
 *
 * Si la base no responde, se deja pasar: el MCP ya fallaría igual sin base, y
 * un fallo aquí no debe convertirse en «apagado» cuando nadie lo ha apagado.
 */
export async function comprobarInterruptor(req, res, next) {
  try {
    const e = apagadoPorEnv() ? { apagado: true } : await estado();
    if (!e.apagado) return next();
    if (esPeticionMcp(req)) {
      req.mcpApagado = true;
      return next();
    }
    res.set('Retry-After', '3600');
    return res.status(503).json({
      jsonrpc: '2.0',
      error: { code: -32003, message: MENSAJE_APAGADO },
      id: null,
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'MCP: no se pudo leer el interruptor; se deja pasar');
    return next();
  }
}
