-- Notificaciones dirigidas a usuarios concretos (no solo broadcast a admins).
--
-- Hasta ahora: admin_notifications era broadcast a TODOS los admins/superadmins.
-- Cada admin la veía hasta marcarla como leída (read_by_user_ids).
--
-- Necesidad: los recordatorios de leads tienen que llegar al GESTOR responsable,
-- no a todos los admins. Añadimos target_user_ids:
--   NULL o array vacío  → broadcast a admins/superadmins (comportamiento previo)
--   [user_id, ...]      → solo esos users la ven en la campanita
--
-- El filtro vive en notifications.service.list().

ALTER TABLE admin_notifications
  ADD COLUMN IF NOT EXISTS target_user_ids INTEGER[] NULL;

CREATE INDEX IF NOT EXISTS idx_admin_notifs_target_users
  ON admin_notifications USING gin (target_user_ids)
  WHERE target_user_ids IS NOT NULL;
