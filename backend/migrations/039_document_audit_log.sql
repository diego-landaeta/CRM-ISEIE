-- ============================================================
-- 039 (audit): Audit log de documentos (factura/certificado)
-- ============================================================
CREATE TABLE IF NOT EXISTS document_audit_log (
  id           SERIAL PRIMARY KEY,
  document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  action       VARCHAR(30) NOT NULL CHECK (action IN (
    'generated', 'downloaded', 'regenerated', 'deleted', 'number_overridden', 'emailed'
  )),
  user_id      INTEGER REFERENCES users(id),
  ip           VARCHAR(64),
  user_agent   VARCHAR(500),
  metadata     JSONB,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_audit_doc ON document_audit_log(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_audit_user ON document_audit_log(user_id, created_at DESC);
