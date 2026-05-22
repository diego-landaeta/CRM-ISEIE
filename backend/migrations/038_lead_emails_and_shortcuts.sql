-- ============================================================
-- Migración 038: lead_emails (CRM-231) + projects.shortcuts (CRM-235)
-- Nota: rol DB en CRM-ISEIE es crm_iseie_user.
-- ============================================================

-- CRM-231: historial de emails enviados manualmente desde la ficha del lead
CREATE TABLE IF NOT EXISTS lead_emails (
  id           SERIAL PRIMARY KEY,
  lead_id      INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  subject      VARCHAR(500) NOT NULL,
  body_html    TEXT NOT NULL,
  brevo_msg_id VARCHAR(200),
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_emails_lead ON lead_emails(lead_id, sent_at DESC);

ALTER TABLE lead_emails OWNER TO crm_iseie_user;
ALTER SEQUENCE lead_emails_id_seq OWNER TO crm_iseie_user;

-- CRM-235: configuración de atajos por proyecto (FAB del frontend)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS shortcuts JSONB NOT NULL DEFAULT '[]'::jsonb;
