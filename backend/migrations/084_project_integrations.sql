-- ============================================================
-- 084 — project_integrations: credenciales por proyecto para Stripe / Brevo.
-- Replica de ISEIH migration 086. Secretos cifrados AES-256-GCM.
-- Idempotente.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS project_integrations (
  id                  SERIAL PRIMARY KEY,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider            VARCHAR(40) NOT NULL,
  active              BOOLEAN NOT NULL DEFAULT false,
  encrypted_value     TEXT,
  iv                  TEXT,
  auth_tag            TEXT,
  config_public       JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_test_status    VARCHAR(20),
  last_test_message   TEXT,
  last_test_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_proj_integrations_project ON project_integrations(project_id);

COMMENT ON TABLE project_integrations IS
  'Credenciales de integraciones externas (Stripe/Brevo) por proyecto. Secretos cifrados AES-256-GCM.';

GRANT ALL PRIVILEGES ON project_integrations TO crm_iseie_user;
GRANT USAGE, SELECT ON SEQUENCE project_integrations_id_seq TO crm_iseie_user;

COMMIT;
