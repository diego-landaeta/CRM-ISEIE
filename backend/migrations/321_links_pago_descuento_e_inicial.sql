-- 321 · Links de pago: otro importe, descuento y una inicial más las cuotas
--       (CRM-ISEIE#657, gemela de CRM#982 / migración 310 de MultiCRM)
--
-- Diego, 21/11/2026: «los enlaces de pago poder dar descuentos y poner montos
-- diferentes, y las cuotas, porque un enlace de pago es la inicial y lo otro son
-- las cuotas, no únicamente con el monto del programa. Son dos recorridos».
--
-- Hasta hoy el link sencillo cobraba el precio del curso, o ese precio dividido
-- entre N. Desde ahora:
--
--   · Pago único con otro importe: el precio sale del catálogo pero se puede
--     cambiar, y se le puede hacer un descuento en € o en %. El link cobra el
--     total y la venta se crea por ese total.
--   · Inicial más cuotas: el link cobra la inicial (un importe libre) y lo que
--     queda se reparte en N cuotas iguales, una al mes, que cobra Stripe solo
--     (cobro automático, 320).
--
-- Lo que se guarda en el link, para saber qué se cobró y por qué:
--   · `precio_original`: el precio antes del descuento (el del catálogo o el que
--     escribió la gestora). `importe` sigue siendo el total que paga el alumno.
--   · `descuento_tipo` ('monto' o 'pct', como en `conversions`), `descuento_valor`
--     (lo que se escribió: 100 € o 10 %) y `descuento_importe` (en la moneda del
--     link). `descuento_pct` sigue midiendo el total contra el catálogo para el
--     tope del campus.
--   · `importe_inicial`: lo que cobra el link en «inicial más cuotas». Con ella,
--     `num_cuotas` cuenta TODOS los pagos de la venta (la inicial y las N cuotas)
--     e `importe_cuota` es la inicial, lo que cobra Stripe con el link. Sin ella
--     (los links en cuotas de antes del 21/11), el total entre `num_cuotas`.
--
-- La venta no necesita columnas nuevas: ya tiene `subtotal_bruto`,
-- `descuento_tipo`, `descuento_valor` y `descuento_importe` (093).
--
-- Se puede pasar dos veces.

BEGIN;

ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS precio_original   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS descuento_tipo    VARCHAR(10),
  ADD COLUMN IF NOT EXISTS descuento_valor   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS descuento_importe NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS importe_inicial   NUMERIC(10,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_links_precio_original_positivo') THEN
    ALTER TABLE payment_links ADD CONSTRAINT payment_links_precio_original_positivo
      CHECK (precio_original IS NULL OR precio_original > 0);
  END IF;
  -- Con descuento, su tipo, su valor y el precio del que sale, y nunca más que ese
  -- precio. Sin descuento, nada. Los IS NOT NULL hacen falta: un CHECK con un NULL
  -- dentro da «desconocido» y Postgres lo deja pasar.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_links_descuento_coherente') THEN
    ALTER TABLE payment_links ADD CONSTRAINT payment_links_descuento_coherente CHECK (
      (descuento_tipo IS NULL AND descuento_valor IS NULL AND descuento_importe = 0)
      OR (descuento_tipo IN ('monto', 'pct') AND descuento_valor IS NOT NULL AND descuento_valor >= 0
          AND precio_original IS NOT NULL AND descuento_importe >= 0 AND descuento_importe < precio_original
          AND (descuento_tipo <> 'pct' OR descuento_valor <= 100)));
  END IF;
  -- La inicial solo en cuotas, mayor que 0 y menor que el total.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_links_inicial_coherente') THEN
    ALTER TABLE payment_links ADD CONSTRAINT payment_links_inicial_coherente CHECK (
      importe_inicial IS NULL
      OR (modalidad = 'cuotas' AND importe_inicial > 0 AND importe_inicial < importe));
  END IF;
END $$;

COMMENT ON COLUMN payment_links.precio_original IS
  'Precio antes del descuento (catálogo o el que escribió quien creó el link). importe es el total (CRM-ISEIE#657, 321).';
COMMENT ON COLUMN payment_links.descuento_tipo IS 'monto (en la moneda del link) o pct; NULL sin descuento (CRM-ISEIE#657).';
COMMENT ON COLUMN payment_links.descuento_valor IS 'Lo que se escribió: 100 (monto) o 10 (pct) (CRM-ISEIE#657).';
COMMENT ON COLUMN payment_links.descuento_importe IS 'El descuento ya calculado, en la moneda del link (CRM-ISEIE#657).';
COMMENT ON COLUMN payment_links.importe_inicial IS
  'Inicial más cuotas (CRM-ISEIE#657): lo que cobra el link. num_cuotas cuenta la inicial y las cuotas; el resto va en cuotas iguales.';

COMMIT;
