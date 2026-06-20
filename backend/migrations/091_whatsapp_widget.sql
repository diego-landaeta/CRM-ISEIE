-- Migracion 093: Widget WhatsApp rotativo por proyecto
-- - users.whatsapp_phone: numero de WhatsApp del usuario
-- - users.whatsapp_display_name: nombre alternativo (ej: Yosbely vs Yolamar para Espana)
-- - users.whatsapp_widget_active: si entra en la rotacion del widget
-- - project_widget_config: configuracion del widget por proyecto

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS whatsapp_phone          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS whatsapp_display_name   VARCHAR(120),
  ADD COLUMN IF NOT EXISTS whatsapp_widget_active  BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_widget_active
  ON users (whatsapp_widget_active) WHERE whatsapp_widget_active = true;

CREATE TABLE IF NOT EXISTS project_widget_config (
  project_id        INTEGER     PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  enabled           BOOLEAN     NOT NULL DEFAULT true,
  welcome_text      VARCHAR(500) NOT NULL DEFAULT '¡Hablamos? 👋',
  message_template  VARCHAR(1000) NOT NULL DEFAULT 'Hola {{project}}, quiero información sobre: {{url}}',
  excluded_user_ids INTEGER[]   NOT NULL DEFAULT '{}'::INTEGER[],
  show_bubble       BOOLEAN     NOT NULL DEFAULT true,
  bubble_delay_ms   INTEGER     NOT NULL DEFAULT 3000,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN users.whatsapp_phone IS 'Numero E.164 sin +, ej: 34644321566';
COMMENT ON COLUMN users.whatsapp_display_name IS 'Nombre alternativo en el burbuja (ej: Yosbely se llama Yolamar para clientes Espana).';
COMMENT ON COLUMN users.whatsapp_widget_active IS 'Si entra en la rotacion del widget WhatsApp publico.';
COMMENT ON TABLE  project_widget_config IS 'Config del widget WhatsApp por proyecto. Editable desde /captacion/whatsapp.';

COMMIT;
