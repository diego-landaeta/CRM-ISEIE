-- Migracion 096: Multi-emisor de facturas
-- Repositorio de empresas que pueden emitir facturas. Solo admin las gestiona.
-- Cada factura (normal o rectificativa) referencia al emisor usado.

BEGIN;

CREATE TABLE IF NOT EXISTS invoice_issuers (
  id            SERIAL       PRIMARY KEY,
  project_id    INTEGER,     -- NULL = disponible para todos los proyectos
  razon_social  VARCHAR(200) NOT NULL,
  nif           VARCHAR(50)  NOT NULL,
  direccion     TEXT,
  ciudad        VARCHAR(120),
  cp            VARCHAR(20),
  pais          VARCHAR(80)  DEFAULT 'España',
  email         VARCHAR(255),
  telefono      VARCHAR(50),
  iban          VARCHAR(40),
  logo_url      VARCHAR(500),
  pie_default   TEXT,
  activo        BOOLEAN      NOT NULL DEFAULT true,
  es_default    BOOLEAN      NOT NULL DEFAULT false,
  created_by    INTEGER,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_issuer_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_issuer_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_issuer_project ON invoice_issuers (project_id, activo);

-- Factura referencia al emisor + snapshot de sus datos (congelados al emitir)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS issuer_id          INTEGER,
  ADD COLUMN IF NOT EXISTS issuer_razon_social VARCHAR(200),
  ADD COLUMN IF NOT EXISTS issuer_nif         VARCHAR(50),
  ADD COLUMN IF NOT EXISTS issuer_direccion   TEXT,
  ADD COLUMN IF NOT EXISTS issuer_ciudad      VARCHAR(120),
  ADD COLUMN IF NOT EXISTS issuer_cp          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS issuer_pais        VARCHAR(80),
  ADD COLUMN IF NOT EXISTS issuer_email       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS issuer_telefono    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS issuer_iban        VARCHAR(40),
  ADD COLUMN IF NOT EXISTS issuer_logo_url    VARCHAR(500);

ALTER TABLE invoices
  ADD CONSTRAINT fk_inv_issuer FOREIGN KEY (issuer_id) REFERENCES invoice_issuers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_issuer ON invoices (issuer_id);

COMMENT ON TABLE invoice_issuers IS 'Empresas emisoras de facturas. Solo admin las gestiona. Multi-emisor.';
COMMENT ON COLUMN invoices.issuer_id IS 'Empresa que emitio esta factura';

COMMIT;
