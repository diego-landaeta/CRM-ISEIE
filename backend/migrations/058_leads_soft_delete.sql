-- Migración 058: soft delete de leads + auditoría
-- deleted_at ya existe en nuestro 001; aplico solo las cols faltantes (idempotente).

ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_reason VARCHAR(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_motivo TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_active
  ON leads(project_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_deleted_email
  ON leads(project_id, email) WHERE deleted_at IS NOT NULL AND deleted_reason = 'spam';
