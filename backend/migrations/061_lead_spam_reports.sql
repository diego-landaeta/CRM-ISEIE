-- Migración 061: reportes de spam

CREATE TABLE IF NOT EXISTS lead_spam_reports (
  id              SERIAL PRIMARY KEY,
  lead_id         INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reported_by     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  motivo          TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'dismissed')),
  reviewed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_spam_reports_unique_pending
  ON lead_spam_reports(lead_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_lead_spam_reports_pending
  ON lead_spam_reports(status, created_at DESC) WHERE status = 'pending';
