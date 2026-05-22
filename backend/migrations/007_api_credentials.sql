-- ============================================================
-- Migracion 007: Tabla api_credentials
-- Credenciales de APIs externas (Meta, Google Ads, GSC, Stripe, Claude, Brevo)
-- Valor encriptado con AES-256-GCM
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS api_credentials (
  id          SERIAL        PRIMARY KEY,
  project_id  INTEGER,
  service     api_service   NOT NULL,
  encrypted_value TEXT      NOT NULL,
  iv          VARCHAR(32)   NOT NULL,
  auth_tag    VARCHAR(32)   NOT NULL,
  metadata    JSONB,
  active      BOOLEAN       NOT NULL DEFAULT true,
  last_tested_at TIMESTAMPTZ,
  last_test_result VARCHAR(20),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_ac_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT uq_ac_project_service UNIQUE (project_id, service)
);

CREATE INDEX idx_ac_project_service ON api_credentials (project_id, service);
CREATE INDEX idx_ac_active ON api_credentials (active) WHERE active = true;

COMMENT ON TABLE api_credentials IS 'Credenciales API externas por proyecto. Brevo, Meta, Google Ads, GSC, Stripe, Claude. Brevo puede ser global (project_id = NULL)';
COMMENT ON COLUMN api_credentials.encrypted_value IS 'Valor encriptado con AES-256-GCM';
COMMENT ON COLUMN api_credentials.iv IS 'Initialization Vector hex (16 bytes / 32 chars)';
COMMENT ON COLUMN api_credentials.auth_tag IS 'Authentication tag AES-GCM hex';
COMMENT ON COLUMN api_credentials.metadata IS 'Extra data: refresh_token, account_id, etc.';

COMMIT;
