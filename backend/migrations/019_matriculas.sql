-- ============================================================
-- 019: Matriculas (post-conversion)
-- DNI + Titulo + Firma → estados pendiente/validada/rechazada
-- ============================================================

CREATE TABLE IF NOT EXISTS matriculas (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversion_id INTEGER NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  dni VARCHAR(40),
  dni_doc_url TEXT,
  dni_doc_key TEXT,
  titulo TEXT,
  titulo_doc_url TEXT,
  titulo_doc_key TEXT,
  firma_url TEXT,
  firma_key TEXT,
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'validada', 'rechazada')),
  motivo_rechazo TEXT,
  notas TEXT,
  validated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matriculas_project ON matriculas(project_id);
CREATE INDEX IF NOT EXISTS idx_matriculas_conversion ON matriculas(conversion_id);
CREATE INDEX IF NOT EXISTS idx_matriculas_estado ON matriculas(estado);

-- Una matricula por conversion (puede revalidarse pero no duplicarse)
CREATE UNIQUE INDEX IF NOT EXISTS uq_matricula_conversion ON matriculas(conversion_id);
