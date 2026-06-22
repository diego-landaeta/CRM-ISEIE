-- Migracion 095: Descuentos por cuadros en conversiones y facturas
-- Flujo de calculo:
--   subtotal_bruto (suma items o importe ingresado)
--     -> descuento (% o monto fijo)
--     -> base_imponible = subtotal_bruto - descuento_importe
--     -> iva_importe = base_imponible * iva_pct / 100
--     -> total = base_imponible + iva_importe

BEGIN;

ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS subtotal_bruto    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS descuento_tipo    VARCHAR(10) NOT NULL DEFAULT 'none'
    CHECK (descuento_tipo IN ('none', 'pct', 'monto')),
  ADD COLUMN IF NOT EXISTS descuento_valor   NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuento_importe NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS subtotal_bruto    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS descuento_tipo    VARCHAR(10) NOT NULL DEFAULT 'none'
    CHECK (descuento_tipo IN ('none', 'pct', 'monto')),
  ADD COLUMN IF NOT EXISTS descuento_valor   NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuento_importe NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN conversions.descuento_tipo IS 'none | pct (porcentaje) | monto (fijo en EUR)';
COMMENT ON COLUMN conversions.descuento_valor IS 'El valor ingresado: 10 (si pct=10%) o 50 (si monto=50EUR)';
COMMENT ON COLUMN conversions.descuento_importe IS 'Monto en EUR del descuento ya calculado';
COMMENT ON COLUMN conversions.subtotal_bruto IS 'Subtotal antes de descuento';

COMMIT;
