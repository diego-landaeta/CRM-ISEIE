-- Concepto editable por cuota (mensualidades/fraccionados): predefinidos + otros.
-- La moneda de factura (invoices.moneda / tipo_cambio) ya existía en el esquema.
ALTER TABLE conversion_installments ADD COLUMN IF NOT EXISTS concepto varchar(160);
