-- Migración 063: Make.com webhooks por proyecto

CREATE TABLE IF NOT EXISTS make_webhooks (
  id                   SERIAL PRIMARY KEY,
  project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug                 VARCHAR(80) NOT NULL UNIQUE,
  label                VARCHAR(120) NOT NULL,
  secret               VARCHAR(120) NOT NULL,
  mode                 VARCHAR(10) NOT NULL DEFAULT 'test' CHECK (mode IN ('test','active')),
  field_mapping        JSONB NOT NULL DEFAULT '{}'::jsonb,
  sample_payload       JSONB,
  sample_received_at   TIMESTAMP WITH TIME ZONE,
  total_received       INTEGER NOT NULL DEFAULT 0,
  total_created        INTEGER NOT NULL DEFAULT 0,
  total_errors         INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  last_received_at     TIMESTAMP WITH TIME ZONE,
  active               BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_make_webhooks_project ON make_webhooks(project_id);

CREATE TABLE IF NOT EXISTS make_webhook_deliveries (
  id                BIGSERIAL PRIMARY KEY,
  webhook_id        INTEGER NOT NULL REFERENCES make_webhooks(id) ON DELETE CASCADE,
  received_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  result            VARCHAR(20) NOT NULL,
  lead_id           INTEGER,
  error_message     TEXT,
  payload           JSONB,
  mapped            JSONB
);

CREATE INDEX IF NOT EXISTS idx_make_deliveries_webhook ON make_webhook_deliveries(webhook_id, received_at DESC);
