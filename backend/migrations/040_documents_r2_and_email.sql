-- 040 (documents R2 + email): r2_key en documents + auto_email_documents en projects

ALTER TABLE documents ADD COLUMN IF NOT EXISTS r2_key VARCHAR(500);
CREATE INDEX IF NOT EXISTS idx_documents_r2_key ON documents(r2_key) WHERE r2_key IS NOT NULL;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS auto_email_documents BOOLEAN NOT NULL DEFAULT false;
