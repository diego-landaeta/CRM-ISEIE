import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * Crear notif para admins/superadmins. Llamar desde otros services (lead.softDelete, etc).
 * No falla nunca: en error solo loggea (la notif es accesoria).
 */
export async function notifyAdmins({ type, title, message = null, link_path = null, metadata = {}, triggered_by_user_id = null }) {
  try {
    const { rows } = await query(
      `INSERT INTO admin_notifications (type, title, message, link_path, metadata, triggered_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, type, title, created_at`,
      [type, title, message, link_path, metadata, triggered_by_user_id]
    );
    return rows[0];
  } catch (err) {
    logger.warn({ err: err.message, type }, 'notifyAdmins falló (no crítico)');
    return null;
  }
}

/**
 * Crear notif para uno o varios usuarios concretos (no a todos los admins).
 * Útil para recordatorios de leads (al gestor responsable), avisos personales, etc.
 * Si targetUserIds está vacío o es null, equivale a notifyAdmins (broadcast).
 * No falla nunca: solo loggea.
 */
export async function notifyUsers({ targetUserIds, type, title, message = null, link_path = null, metadata = {}, triggered_by_user_id = null }) {
  const targets = Array.isArray(targetUserIds) && targetUserIds.length > 0 ? targetUserIds : null;
  try {
    const { rows } = await query(
      `INSERT INTO admin_notifications (type, title, message, link_path, metadata, triggered_by_user_id, target_user_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, type, title, created_at`,
      [type, title, message, link_path, metadata, triggered_by_user_id, targets]
    );
    return rows[0];
  } catch (err) {
    logger.warn({ err: err.message, type, targets }, 'notifyUsers falló (no crítico)');
    return null;
  }
}

/**
 * Lista notifs visibles para un usuario. Reglas:
 *   - Si la notif tiene target_user_ids populado → solo la ven esos users
 *   - Si target_user_ids es NULL → la ven admins/superadmins (broadcast clásico)
 * Los gestores solo ven las notifs dirigidas a ellos personalmente.
 * unreadOnly=true → solo no leídas.
 */
function visibilityClause(userId, role, paramIdx) {
  // Param posicional: $${paramIdx} debe ser userId
  const isAdminLike = role === 'admin' || role === 'superadmin' || role === 'soporte';
  if (isAdminLike) {
    return `(n.target_user_ids IS NULL OR $${paramIdx} = ANY(n.target_user_ids))`;
  }
  return `(n.target_user_ids IS NOT NULL AND $${paramIdx} = ANY(n.target_user_ids))`;
}

export async function list({ userId, role = 'gestor', unreadOnly = false, limit = 50 } = {}) {
  const params = [userId, limit];
  const conditions = [visibilityClause(userId, role, 1)];
  if (unreadOnly) conditions.push(`NOT ($1 = ANY(n.read_by_user_ids))`);
  const where = `WHERE ${conditions.join(' AND ')}`;
  const { rows } = await query(
    `SELECT n.id, n.type, n.title, n.message, n.link_path, n.metadata,
            n.triggered_by_user_id, u.nombre AS triggered_by_nombre,
            n.read_by_user_ids @> ARRAY[$1::int] AS is_read,
            n.created_at
     FROM admin_notifications n
     LEFT JOIN users u ON u.id = n.triggered_by_user_id
     ${where}
     ORDER BY n.created_at DESC
     LIMIT $2`,
    params
  );
  return rows;
}

/**
 * Cuenta de no leídas para un usuario (respeta el filtro de visibilidad).
 */
export async function unreadCount(userId, role = 'gestor') {
  const vis = visibilityClause(userId, role, 1);
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM admin_notifications n
     WHERE ${vis} AND NOT ($1 = ANY(n.read_by_user_ids))`,
    [userId]
  );
  return rows[0]?.count || 0;
}

export async function markRead(notifId, userId) {
  const { rowCount } = await query(
    `UPDATE admin_notifications
     SET read_by_user_ids = array_append(read_by_user_ids, $2)
     WHERE id = $1 AND NOT ($2 = ANY(read_by_user_ids))`,
    [notifId, userId]
  );
  if (rowCount === 0) {
    // Ya estaba marcada o no existe; idempotente.
    const { rows } = await query(`SELECT id FROM admin_notifications WHERE id = $1`, [notifId]);
    if (!rows[0]) throw new AppError('Notificación no encontrada', 404, 'NOT_FOUND');
  }
  return { id: notifId, read: true };
}

export async function markAllRead(userId) {
  const { rowCount } = await query(
    `UPDATE admin_notifications
     SET read_by_user_ids = array_append(read_by_user_ids, $1)
     WHERE NOT ($1 = ANY(read_by_user_ids))`,
    [userId]
  );
  return { marked: rowCount };
}
