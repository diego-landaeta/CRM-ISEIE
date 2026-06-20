-- Migracion 094: Facturas rectificativas (de abono)
-- Una rectificativa referencia a la factura original y lleva importes negativos.
-- Serie propia 'R' para numeracion separada (requisito AEAT).

BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS tipo              VARCHAR(20) NOT NULL DEFAULT 'normal'
    CHECK (tipo IN ('normal', 'rectificativa')),
  ADD COLUMN IF NOT EXISTS rectifica_id      INTEGER,    -- FK a la factura original
  ADD COLUMN IF NOT EXISTS rectifica_codigo  VARCHAR(30),-- snapshot del codigo original
  ADD COLUMN IF NOT EXISTS motivo_rectificacion TEXT;

ALTER TABLE invoices
  ADD CONSTRAINT fk_inv_rectifica
    FOREIGN KEY (rectifica_id) REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_rectifica ON invoices (rectifica_id);
CREATE INDEX IF NOT EXISTS idx_invoice_tipo ON invoices (project_id, tipo);

COMMENT ON COLUMN invoices.tipo IS 'normal | rectificativa (de abono)';
COMMENT ON COLUMN invoices.rectifica_id IS 'Factura original que esta rectificativa anula/corrige';
COMMENT ON COLUMN invoices.motivo_rectificacion IS 'Razon: anulacion, devolucion, error importe, descuento posterior';

COMMIT;
