-- Marcar una venta como "esto en realidad es una mensualidad".
--
-- Por que hace falta: hay fichas de venta que no son una venta nueva sino el
-- cobro de una cuota de algo comprado antes. Contarlas infla las ventas y la
-- tasa de conversion, y ademas cuenta como cliente nuevo a quien solo pago una
-- mensualidad.
--
-- Se venia deduciendo del texto del producto y de la descripcion de la factura,
-- pero eso no basta: una venta buena con plan de pago tiene facturas que dicen
-- "pago mensualidad 3" y sigue siendo una venta. Con esta columna la persona
-- que conoce el caso lo deja dicho, y la heuristica pasa a ser solo la ayuda
-- para lo que nadie ha revisado todavia.
--
-- Efecto en las metricas: la venta no cuenta como venta nueva ni como cliente
-- nuevo, y TODOS sus cobros cuentan como mensualidad (no solo del segundo en
-- adelante, como en una venta normal).

BEGIN;

ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS es_mensualidad BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN conversions.es_mensualidad IS
  'La ficha no es una venta nueva: es el cobro de una cuota de una compra anterior. No cuenta en ventas ni en clientes nuevos, y sus cobros cuentan como mensualidad.';

-- Se consulta al filtrar ventas en casi todos los informes.
CREATE INDEX IF NOT EXISTS idx_conversions_es_mensualidad
  ON conversions (project_id, es_mensualidad)
  WHERE es_mensualidad IS TRUE;

COMMIT;
