-- Migración 046: Conectores configurables por proyecto.
-- Owner ajustado a crm_iseie_user.

CREATE TABLE IF NOT EXISTS project_connectors (
  id            SERIAL PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type          VARCHAR(40) NOT NULL,
  label         VARCHAR(150) NOT NULL,
  destination   VARCHAR(40) NOT NULL DEFAULT 'product',
  config        JSONB NOT NULL DEFAULT '{}',
  field_mapping JSONB NOT NULL DEFAULT '{}',
  sample_payload JSONB,
  sample_received_at TIMESTAMPTZ,
  active        BOOLEAN NOT NULL DEFAULT true,
  last_sync_at  TIMESTAMPTZ,
  last_sync_status VARCHAR(20),
  last_sync_count INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connectors_project_active
  ON project_connectors(project_id, active);

ALTER TABLE project_connectors OWNER TO crm_iseie_user;
ALTER SEQUENCE project_connectors_id_seq OWNER TO crm_iseie_user;
