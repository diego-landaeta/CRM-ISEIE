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

// ── Los avisos que se retiran solos (igual que en el CRM 360) ────────────────
//
// Una tutora, el 26/11: «estoy al día; actualizo, pero sigue apareciendo». El
// aviso de 48 h salió con razón (la entrega llevaba 49 h sin nota) y lo corrigió
// una hora después, pero el aviso se quedó en la campana para siempre: nada lo
// retiraba. Un aviso que pide hacer algo tiene que irse cuando ya está hecho.
//
// Retirar = marcarlo leído para todos sus destinatarios y apuntar en `metadata`
// cuándo y por qué (`resuelta_at`, `resuelta`). No se borra: queda el rastro. La
// campana y la lista no enseñan los retirados (`list`). Sin migración: `metadata`
// es JSONB desde la 067.

/** Los avisos de ese tipo dirigidos a esa persona que siguen sin retirar. */
export async function avisosAbiertos(userId, type) {
  const { rows } = await query(
    `SELECT id, metadata, created_at FROM admin_notifications
      WHERE type = $2 AND $1 = ANY(target_user_ids) AND NOT (metadata ? 'resuelta_at')
      ORDER BY id`, [userId, type]);
  return rows.map((r) => ({ id: Number(r.id), metadata: r.metadata || {}, createdAt: r.created_at }));
}

/** Retira esos avisos: leídos para todos sus destinatarios y con el motivo. Devuelve cuántos. */
export async function resolverAvisos(ids, motivo, ahora = new Date()) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  const { rowCount } = await query(
    `UPDATE admin_notifications
        SET metadata = metadata || jsonb_build_object('resuelta_at', $3::timestamptz, 'resuelta', $2::text),
            read_by_user_ids = ARRAY(SELECT DISTINCT x FROM unnest(read_by_user_ids || COALESCE(target_user_ids, '{}'::int[])) x)
      WHERE id = ANY($1::int[]) AND NOT (metadata ? 'resuelta_at')`,
    [ids, motivo, ahora]);
  return rowCount;
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
  // Los retirados (ya no piden nada: `resolverAvisos`) no se enseñan.
  const conditions = [visibilityClause(userId, role, 1), `NOT (n.metadata ? 'resuelta_at')`];
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
     WHERE ${vis} AND NOT ($1 = ANY(n.read_by_user_ids)) AND NOT (n.metadata ? 'resuelta_at')`,
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
