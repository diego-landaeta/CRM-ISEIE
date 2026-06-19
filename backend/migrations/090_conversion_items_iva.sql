-- Migracion 092: multi-item en conversiones + IVA configurable
-- - Tabla conversion_items (1 conversion -> N items)
-- - Campos IVA en conversions: iva_pct, iva_incluido, iva_exento, base, iva_importe
-- - Backwards compat: conversiones viejas (sin items) siguen funcionando con producto_contratado

BEGIN;

CREATE TABLE IF NOT EXISTS conversion_items (
  id              SERIAL          PRIMARY KEY,
  conversion_id   INTEGER         NOT NULL,
  product_id      INTEGER,
  descripcion     VARCHAR(500)    NOT NULL,
  cantidad        INTEGER         NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario NUMERIC(10,2)   NOT NULL,
  subtotal        NUMERIC(10,2)   NOT NULL,
  orden           INTEGER         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_ci_conversion FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ci_product    FOREIGN KEY (product_id)    REFERENCES products(id)    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ci_conversion ON conversion_items (conversion_id, orden);

ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS iva_pct        NUMERIC(5,2) NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS iva_incluido   BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS iva_exento     BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS base_imponible NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS iva_importe    NUMERIC(10,2);

COMMENT ON TABLE conversion_items IS 'Items por conversion. Un cliente puede comprar 2x curso A + 1x curso B en una sola venta.';
COMMENT ON COLUMN conversions.iva_pct IS 'IVA % aplicado (default 21). Si iva_exento=true, se ignora.';
COMMENT ON COLUMN conversions.iva_incluido IS 'true = precios ya incluyen IVA (desglosar). false = sumar IVA al subtotal.';
COMMENT ON COLUMN conversions.iva_exento IS 'true = sin IVA. Operacion exenta art. 20 LIVA.';
COMMENT ON COLUMN conversions.base_imponible IS 'Base sin IVA. Cuando hay items: SUM(items.subtotal) ajustado por incluido. Cuando NO hay items: importe_total ajustado.';
COMMENT ON COLUMN conversions.iva_importe IS 'Importe del IVA. 0 si exento.';

COMMIT;
