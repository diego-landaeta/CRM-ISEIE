-- Plantillas visuales de factura (editor tipo Canva). Cada plantilla guarda un
-- layout libre de bloques (posición/tamaño) que luego se rellena con datos reales.
CREATE TABLE IF NOT EXISTS invoice_templates (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  issuer_id   INTEGER REFERENCES invoice_issuers(id) ON DELETE CASCADE,
  nombre      VARCHAR(150) NOT NULL DEFAULT 'Plantilla',
  page_size   VARCHAR(10) NOT NULL DEFAULT 'A4',
  layout      JSONB NOT NULL DEFAULT '[]'::jsonb,
  es_default  BOOLEAN NOT NULL DEFAULT false,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_templates_project ON invoice_templates(project_id);
CREATE INDEX IF NOT EXISTS idx_invoice_templates_issuer ON invoice_templates(issuer_id);

-- Vincular una factura a la plantilla con la que se generó (para reimprimir igual).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES invoice_templates(id);
