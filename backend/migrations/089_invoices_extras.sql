-- Migracion 091: metodo_pago, pie_pago, y reset de secuencia por admin
BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(40) NOT NULL DEFAULT 'transferencia',
  ADD COLUMN IF NOT EXISTS pie_pago    TEXT;

-- Default por proyecto (UI: Configuración de facturación)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS factura_pie_default   TEXT,
  ADD COLUMN IF NOT EXISTS factura_serie_default VARCHAR(10) NOT NULL DEFAULT 'A',
  ADD COLUMN IF NOT EXISTS factura_metodo_default VARCHAR(40);

COMMIT;
