import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * El registro de quien toca las credenciales. Tarea #80.
 *
 * Va en `user_activity_log`, que YA existe y ya usan `auth` y `whatsapp`. No
 * hacia falta una tabla nueva: tiene `user_id`, `action`, `details` (jsonb),
 * `ip_address` y `created_at`, que es exactamente lo que pide el ticket.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA REGLA DE ESTE FICHERO, Y NO ADMITE EXCEPCION:
 *
 *   **Aqui no entra nunca un valor de credencial.** Ni el nuevo, ni el viejo,
 *   ni un trozo, ni enmascarado. Se anota QUE credencial se toco —servicio,
 *   proyecto, entorno— y quien lo hizo. Nada mas.
 *
 * El ticket lo dice para el registro de cambios («sin el valor viejo») y vale
 * igual para el de accesos: un registro que guarda secretos es un segundo sitio
 * del que roban los secretos, y ademas nadie lo vigila porque «solo es un log».
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Lo que puede pasarle a una credencial. */
export const ACCIONES = {
  VER: 'credencial.ver',
  CREAR: 'credencial.crear',
  CAMBIAR: 'credencial.cambiar',
  BORRAR: 'credencial.borrar',
  PROBAR: 'credencial.probar',
};

/**
 * Anota lo que se acaba de hacer.
 *
 * Nunca lanza: que falle el registro no puede impedir la operacion. Pero SI se
 * avisa fuerte, porque un acceso a una credencial sin anotar es justo lo que
 * esto viene a evitar — y si empieza a fallar hay que enterarse.
 */
export async function anotar(req, accion, { servicio, projectId = null, entorno = null, id = null }) {
  try {
    await query(
      `INSERT INTO user_activity_log (user_id, action, details, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [
        req.user?.userId || null,
        accion,
        // Solo el QUE, nunca el valor. Ver la cabecera.
        JSON.stringify({ id, servicio, project_id: projectId, entorno }),
        req.ip || req.headers['x-forwarded-for'] || null,
      ]
    );
  } catch (err) {
    logger.error(
      { err: err.message, accion, servicio, userId: req.user?.userId },
      'Credenciales: NO se pudo anotar el acceso'
    );
  }
}

/**
 * Quien ha tocado que, para la pantalla de registro.
 *
 * Se filtra por el prefijo `credencial.` para no mezclar con los inicios de
 * sesion y lo de WhatsApp, que viven en la misma tabla.
 */
export async function historial({ limite = 100, servicio = null, userId = null } = {}) {
  const { rows } = await query(
    `SELECT l.id, l.action, l.details, l.created_at,
            u.nombre AS usuario, u.email AS usuario_email
       FROM user_activity_log l
       LEFT JOIN users u ON u.id = l.user_id
      WHERE l.action LIKE 'credencial.%'
        AND ($1::text IS NULL OR l.details->>'servicio' = $1)
        AND ($2::int  IS NULL OR l.user_id = $2)
      ORDER BY l.created_at DESC
      LIMIT $3`,
    [servicio, userId, Math.min(Number(limite) || 100, 500)]
  );
  return rows;
}
