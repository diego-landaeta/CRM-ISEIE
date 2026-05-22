-- ============================================================
-- Migración 050: historial de eventos recibidos por webhook/mailhook/form
-- Para que el admin vea TODOS los payloads que llegaron + cómo se procesaron
-- Nota: el rol DB en CRM-ISEIE es crm_iseie_user (no crm_user del hermano).
-- ============================================================

CREATE TABLE IF NOT EXISTS form_template_events (
  id            SERIAL PRIMARY KEY,
  form_template_id INTEGER NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  source        VARCHAR(20) NOT NULL,    -- 'webhook' | 'mailhook' | 'form'
  payload       JSONB NOT NULL,           -- payload original recibido
  status        VARCHAR(20) NOT NULL,     -- 'success' | 'error' | 'duplicate' | 'sample_captured'
  result_type   VARCHAR(20),              -- 'lead' | 'matricula'
  result_id     INTEGER,                  -- id del lead/matricula creado
  error_message TEXT,
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_events_template
  ON form_template_events(form_template_id, created_at DESC);

ALTER TABLE form_template_events OWNER TO crm_iseie_user;
ALTER SEQUENCE form_template_events_id_seq OWNER TO crm_iseie_user;
