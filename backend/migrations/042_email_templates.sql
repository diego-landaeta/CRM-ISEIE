-- 042_email_templates.sql
-- CRM-185 fase 2: plantillas de email configurables por proyecto.
-- Cada plantilla soporta variables tipo {{lead.nombre}} que se substituyen
-- al renderizar (ver email-templates.service.js renderTemplate).
-- Nota: rol DB en CRM-ISEIE es crm_iseie_user.

CREATE TABLE IF NOT EXISTS email_templates (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         VARCHAR(120) NOT NULL,
  subject      VARCHAR(500) NOT NULL,
  body_html    TEXT NOT NULL,
  description  TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_project ON email_templates(project_id, active);

ALTER TABLE email_templates OWNER TO crm_iseie_user;
ALTER SEQUENCE email_templates_id_seq OWNER TO crm_iseie_user;
