-- Migración 032: canales embebidos por proyecto (CRM-208 / CRM-211)
-- Owner ajustado a crm_iseie_user.

CREATE TABLE IF NOT EXISTS project_channels (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label       VARCHAR(100) NOT NULL,
  url         TEXT NOT NULL,
  icon        VARCHAR(50) NOT NULL DEFAULT 'Globe',
  position    INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_channels_project ON project_channels(project_id, position);

ALTER TABLE project_channels OWNER TO crm_iseie_user;
ALTER SEQUENCE project_channels_id_seq OWNER TO crm_iseie_user;
