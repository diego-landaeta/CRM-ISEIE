-- Ventas repetidas del mismo alumno y programa (CRM#898, gemela CRM-ISEIE#574).
--
-- Al crear una venta que repite otra del mismo alumno y programa en el mismo
-- campus, el servidor responde 409 VENTA_YA_EXISTE. Se puede crear igualmente
-- (`forzar: true`), y entonces queda dicho en la venta nueva:
--
--   repetida_de           la venta que ya existía y se enseñó en el aviso;
--   repetida_forzada_por  quién decidió crearla igualmente;
--   repetida_forzada_at   cuándo. Es la marca: con ella, la venta deja de salir
--                         en «Posibles repetidas» como repetida de las de antes.
--
-- Solo añade columnas vacías: no toca ninguna venta que ya exista.

BEGIN;

ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS repetida_de INTEGER REFERENCES conversions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repetida_forzada_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repetida_forzada_at TIMESTAMPTZ;

COMMENT ON COLUMN conversions.repetida_de IS
  'La venta del mismo alumno y programa que ya existía cuando esta se creó forzando el aviso VENTA_YA_EXISTE.';
COMMENT ON COLUMN conversions.repetida_forzada_por IS
  'Quién creó esta venta igualmente, sabiendo que repetía otra (VENTA_YA_EXISTE).';
COMMENT ON COLUMN conversions.repetida_forzada_at IS
  'Cuándo se creó forzando el aviso de venta repetida. Con valor, la venta no sale en «Posibles repetidas».';

COMMIT;
