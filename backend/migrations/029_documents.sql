-- ============================================================
-- 029: Módulo de documentos — facturas y certificados
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type        VARCHAR(20) NOT NULL CHECK (type IN ('invoice','certificate')),
  number      VARCHAR(50) NOT NULL,
  client_nombre VARCHAR(255),
  client_dni    VARCHAR(50),
  client_direccion TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  file_path   VARCHAR(500),
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_number ON documents(project_id, type, number);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS document_counters (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type        VARCHAR(20) NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, type)
);
