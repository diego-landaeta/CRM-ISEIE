-- Notificaciones para admin/superadmin (eventos que necesitan visibilidad operativa).
-- Tipos previstos: lead_deleted, sale_registered, dup_pending_review, etc.

CREATE TABLE IF NOT EXISTS admin_notifications (
  id                    SERIAL PRIMARY KEY,
  type                  VARCHAR(50) NOT NULL,
  title                 VARCHAR(255) NOT NULL,
  message               TEXT,
  link_path             VARCHAR(500),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  triggered_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Lista de user_ids que ya marcaron leída esta notif (uno por admin).
  read_by_user_ids      INTEGER[] NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_created ON admin_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_type ON admin_notifications(type);
