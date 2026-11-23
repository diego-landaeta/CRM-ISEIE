-- 326 · Links de pago: las cuotas con su importe y su fecha (Diego, 23/11/2026; gemela de la 315 de MultiCRM, CRM#1021)
--
-- «El link de pago debe dejar CREAR CUOTAS Y ELEGIR LAS FECHAS SÍ O SÍ.»
--
-- Hasta hoy, un link en «inicial + cuotas» guardaba solo la inicial y en cuántas
-- cuotas iba lo que quedaba: al pagarse, la venta nacía con cuotas iguales, una
-- al mes desde el día del pago. Y solo se podía con el cobro automático, que en
-- producción ninguna clave de Stripe tenía permitido.
--
-- Desde ahora la gestora elige en el asistente el importe (repartido a partes
-- iguales y editable) y la FECHA de cada cuota, y se guarda en el link:
--
--   · `plan_cuotas`: las cuotas de DESPUÉS de la inicial, en orden, como
--     `[{ "importe": 300, "vence": "2026-12-23" }, …]`. NULL en los links de
--     antes y en los de pago único: esos siguen como hasta ahora.
--
-- Al pagarse la inicial, la venta nace con esas cuotas y esas fechas. Con cobro
-- automático, Stripe las cobra en su fecha; sin él, se crea un link por cuota,
-- con su vencimiento (el «plan de pago» de la v2.8.0).
--
-- Solo añade una columna que puede ir vacía. Se puede pasar dos veces.

BEGIN;

ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS plan_cuotas JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_links_plan_cuotas') THEN
    ALTER TABLE payment_links
      ADD CONSTRAINT chk_payment_links_plan_cuotas
      CHECK (plan_cuotas IS NULL OR jsonb_typeof(plan_cuotas) = 'array');
  END IF;
END $$;

COMMENT ON COLUMN payment_links.plan_cuotas IS
  'Cuotas de después de la inicial con el importe y la fecha que eligió la gestora: [{importe, vence}]. NULL = reparto igual, una al mes desde el pago (links de antes del 23/11).';

COMMIT;
