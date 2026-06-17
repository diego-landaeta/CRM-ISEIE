-- ============================================================
-- Migracion 090: Facturacion (modelo aprobado 2026-06-17)
-- - Columnas fiscales en leads (NIF ya existe, faltan ciudad/cp/pais)
-- - Tabla invoices (factura espanola con numeracion correlativa)
-- - Tabla invoice_sequences (numeracion atomica por proyecto/ano/serie)
-- Ver docs/10-facturacion.md
-- ============================================================

BEGIN;

-- 1) Columnas fiscales adicionales en leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ciudad_fiscal        VARCHAR(120),
  ADD COLUMN IF NOT EXISTS codigo_postal_fiscal VARCHAR(20),
  ADD COLUMN IF NOT EXISTS pais_fiscal          VARCHAR(80) DEFAULT 'España';

-- 2) Tabla invoices
CREATE TABLE IF NOT EXISTS invoices (
  id              SERIAL PRIMARY KEY,
  project_id      INTEGER NOT NULL,
  conversion_id   INTEGER,
  lead_id         INTEGER,
  serie           VARCHAR(10) NOT NULL DEFAULT 'A',
  ano             INTEGER NOT NULL,
  numero          INTEGER NOT NULL,
  codigo          VARCHAR(30) NOT NULL,
  fecha_emision   DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_pago      DATE,
  cliente_nombre  VARCHAR(200) NOT NULL,
  cliente_nif     VARCHAR(50) NOT NULL,
  cliente_direccion TEXT NOT NULL,
  cliente_ciudad  VARCHAR(120) NOT NULL,
  cliente_cp      VARCHAR(20) NOT NULL,
  cliente_pais    VARCHAR(80) NOT NULL,
  cliente_email   VARCHAR(255),
  cliente_telefono VARCHAR(50),
  items           JSONB NOT NULL,
  base_imponible  NUMERIC(10,2) NOT NULL,
  iva_pct         NUMERIC(5,2)  NOT NULL DEFAULT 21,
  iva_importe     NUMERIC(10,2) NOT NULL DEFAULT 0,
  iva_incluido    BOOLEAN       NOT NULL DEFAULT false,
  total           NUMERIC(10,2) NOT NULL,
  estado          VARCHAR(20)   NOT NULL DEFAULT 'emitida' CHECK (estado IN ('emitida','enviada','pagada','cancelada')),
  notas           TEXT,
  leyenda_iva     TEXT,
  pdf_path        VARCHAR(500),
  sent_at         TIMESTAMPTZ,
  sent_to_email   VARCHAR(255),
  created_by      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_inv_project   FOREIGN KEY (project_id)    REFERENCES projects(id)    ON DELETE CASCADE,
  CONSTRAINT fk_inv_conv      FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE SET NULL,
  CONSTRAINT fk_inv_lead      FOREIGN KEY (lead_id)       REFERENCES leads(id)       ON DELETE SET NULL,
  CONSTRAINT fk_inv_created   FOREIGN KEY (created_by)    REFERENCES users(id)       ON DELETE SET NULL,
  CONSTRAINT uq_invoice_codigo UNIQUE (project_id, codigo),
  CONSTRAINT uq_invoice_year_serie_numero UNIQUE (project_id, ano, serie, numero)
);

CREATE INDEX IF NOT EXISTS idx_invoice_project_estado ON invoices (project_id, estado);
CREATE INDEX IF NOT EXISTS idx_invoice_conversion     ON invoices (conversion_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lead           ON invoices (lead_id);
CREATE INDEX IF NOT EXISTS idx_invoice_fecha          ON invoices (project_id, fecha_emision DESC);

-- 3) Secuencias correlativas por proyecto/ano/serie
CREATE TABLE IF NOT EXISTS invoice_sequences (
  project_id    INTEGER     NOT NULL,
  ano           INTEGER     NOT NULL,
  serie         VARCHAR(10) NOT NULL DEFAULT 'A',
  ultimo_numero INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, ano, serie),
  CONSTRAINT fk_iseq_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

COMMENT ON TABLE invoices IS 'Facturas espanolas. Snapshot cliente. Numeracion correlativa por proyecto/ano/serie.';
COMMENT ON TABLE invoice_sequences IS 'Numeracion atomica. UPSERT con +1 garantiza correlativa sin gaps.';

COMMIT;
