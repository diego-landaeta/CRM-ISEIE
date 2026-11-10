-- CRM-ISEIE 258 = MultiCRM 236 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- 236 · Quitar SOLO los cobros duplicados justificados (#135, #42)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ HACE
--
-- La 215 lista en `cobros_repetidos_revision` los cobros apuntados dos veces.
-- Diego, 02/11/2026: «no puede borrar cosas que afecten, solo duplicadas y que
-- estén justificadas». Esta migración quita una copia SOLO si se cumple todo:
--
--   1. La 215 la marcó «duplicado seguro» y nadie ha dicho «es cobro real».
--   2. Sigue siendo idéntica a su original: venta, importe, fecha, método,
--      moneda y referencia.
--   3. De la copia no cuelga nada salvo el cargo de Stripe: ni factura, ni
--      comisión de tutor (se borraría en cascada), ni cuota, ni devolución, ni
--      aviso enviado.
--   4. El original no tiene cargo de Stripe propio, y a ese original solo le
--      sobra una copia.
--   5. Sin las copias, lo cobrado de la venta cuadra con su `importe_pagado`,
--      que es la cifra buena. Si una venta no cuadra, no se toca NINGUNA fila
--      de esa venta.
--
-- El cargo de Stripe de la copia pasa al original. Así no se pierde nada (la
-- comisión de Stripe, el origen del cobro) y la sincronización no lo vuelve a
-- crear, porque solo crea cobro para un cargo sin enlace
-- (stripe-payments.service.js, `if (dbRow.conversion_payment_id ...) return`).
--
-- Cada fila quitada se guarda entera en `cobros_duplicados_quitados`, con su
-- justificación escrita y los cargos movidos, para poder devolverla.
--
-- No toca ventas, facturas, comisiones ni nada de lo que la 215 dejó en
-- «cuotas legitimas» o «revisar».
--
-- Producción del 360, 02/11/2026 (solo lectura): 57 copias, 18.798,95 €. En
-- todas, la copia es la fila de la carga de Stripe del 18/06 o del 24/07.
--
-- Reaplicable: lo ya quitado sale de la lista de la 215 y no se repite.

BEGIN;

CREATE TABLE IF NOT EXISTS cobros_duplicados_quitados (
  payment_id         INTEGER PRIMARY KEY,
  original_id        INTEGER NOT NULL,
  conversion_id      INTEGER NOT NULL,
  importe            DECIMAL(10,2) NOT NULL,
  fecha              DATE NOT NULL,
  -- La fila entera de conversion_payments, para devolverla tal cual.
  fila               JSONB NOT NULL,
  -- Los cargos de stripe_payments que pasaron de la copia al original.
  stripe_payment_ids INTEGER[] NOT NULL DEFAULT '{}',
  justificacion      TEXT NOT NULL,
  quitado_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TEMP TABLE _quitar ON COMMIT DROP AS
SELECT r.payment_id, r.original_id, r.conversion_id, r.importe, r.fecha
  FROM cobros_repetidos_revision r
  JOIN conversion_payments d ON d.id = r.payment_id
  JOIN conversion_payments o ON o.id = r.original_id
 WHERE r.diagnostico = 'duplicado seguro'
   AND r.decision IS DISTINCT FROM 'es cobro real'
   AND o.conversion_id = d.conversion_id
   AND o.importe = d.importe
   AND o.fecha = d.fecha
   AND COALESCE(o.metodo, '') = COALESCE(d.metodo, '')
   AND COALESCE(o.moneda, '') = COALESCE(d.moneda, '')
   AND COALESCE(o.referencia, '') = COALESCE(d.referencia, '')
   AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.payment_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM tutor_commissions x WHERE x.payment_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM conversion_installments x WHERE x.payment_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM conversion_refunds x WHERE x.payment_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM webhooks_salientes_envios x WHERE x.payment_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM stripe_payments s WHERE s.conversion_payment_id = o.id)
   AND (SELECT count(*) FROM stripe_payments s WHERE s.conversion_payment_id = d.id) <= 1
   AND (SELECT count(*) FROM cobros_repetidos_revision r2 WHERE r2.original_id = r.original_id) = 1;

-- Una venta entra entera o no entra: sin sus copias tiene que cuadrar.
DELETE FROM _quitar q
 WHERE q.conversion_id IN (
   SELECT t.conversion_id
     FROM (SELECT DISTINCT conversion_id FROM _quitar) t
     JOIN conversions c ON c.id = t.conversion_id
    WHERE abs((SELECT sum(cp.importe) FROM conversion_payments cp WHERE cp.conversion_id = t.conversion_id)
            - (SELECT sum(x.importe) FROM _quitar x WHERE x.conversion_id = t.conversion_id)
            - c.importe_pagado) > 0.05);

INSERT INTO cobros_duplicados_quitados
  (payment_id, original_id, conversion_id, importe, fecha, fila, stripe_payment_ids, justificacion)
SELECT q.payment_id, q.original_id, q.conversion_id, q.importe, q.fecha, to_jsonb(d),
       COALESCE((SELECT array_agg(s.id ORDER BY s.id) FROM stripe_payments s WHERE s.conversion_payment_id = d.id), '{}'),
       format('Copia del cobro %s de la venta %s: %s del %s, mismo importe, fecha, método y referencia. '
              'La copia se creó el %s%s; el original, el %s. '
              'De la copia no cuelga factura, comisión, cuota, devolución ni aviso. '
              'Sin ella, lo cobrado de la venta cuadra con lo pagado (%s).%s',
              q.original_id, q.conversion_id, q.importe, to_char(q.fecha, 'DD/MM/YYYY'),
              to_char(d.created_at, 'DD/MM/YYYY'),
              CASE WHEN EXISTS (SELECT 1 FROM stripe_payments s WHERE s.conversion_payment_id = d.id)
                   THEN ' con la sincronización de Stripe' ELSE '' END,
              to_char(o.created_at, 'DD/MM/YYYY'),
              c.importe_pagado,
              CASE WHEN EXISTS (SELECT 1 FROM stripe_payments s WHERE s.conversion_payment_id = d.id)
                   THEN ' El cargo de Stripe pasa al cobro original.' ELSE '' END)
  FROM _quitar q
  JOIN conversion_payments d ON d.id = q.payment_id
  JOIN conversion_payments o ON o.id = q.original_id
  JOIN conversions c ON c.id = q.conversion_id
ON CONFLICT (payment_id) DO NOTHING;

UPDATE stripe_payments s
   SET conversion_payment_id = q.original_id
  FROM _quitar q
 WHERE s.conversion_payment_id = q.payment_id;

DELETE FROM conversion_payments d USING _quitar q WHERE d.id = q.payment_id;

-- Comprobar antes de confirmar: si algo no cuadra, se deshace todo.
DO $$
DECLARE n INTEGER; euros NUMERIC; mal INTEGER;
BEGIN
  SELECT count(*), COALESCE(sum(importe), 0) INTO n, euros FROM _quitar;

  SELECT count(*) INTO mal
    FROM (SELECT DISTINCT conversion_id FROM _quitar) t
    JOIN conversions c ON c.id = t.conversion_id
   WHERE abs(COALESCE((SELECT sum(cp.importe) FROM conversion_payments cp WHERE cp.conversion_id = t.conversion_id), 0)
             - c.importe_pagado) > 0.05;
  IF mal > 0 THEN
    RAISE EXCEPTION '236: % ventas no cuadran después de quitar las copias. No se ha quitado nada.', mal;
  END IF;

  SELECT count(*) INTO mal
    FROM cobros_duplicados_quitados b, unnest(b.stripe_payment_ids) AS sid
    JOIN stripe_payments s ON s.id = sid
   WHERE b.payment_id IN (SELECT payment_id FROM _quitar)
     AND s.conversion_payment_id IS DISTINCT FROM b.original_id;
  IF mal > 0 THEN
    RAISE EXCEPTION '236: % cargos de Stripe no han pasado a su original. No se ha quitado nada.', mal;
  END IF;

  RAISE NOTICE 'Cobros duplicados quitados: % (% EUR). Detalle en cobros_duplicados_quitados.', n, euros;
END $$;

DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON cobros_duplicados_quitados TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Para verlos:
--   SELECT conversion_id AS venta, payment_id AS copia, original_id AS original, importe, fecha, justificacion
--     FROM cobros_duplicados_quitados ORDER BY conversion_id;
--
-- Para devolver una (o todas, sin el WHERE):
--   BEGIN;
--   INSERT INTO conversion_payments
--   SELECT (jsonb_populate_record(NULL::conversion_payments, fila)).* FROM cobros_duplicados_quitados WHERE payment_id = <id>;
--   UPDATE stripe_payments s SET conversion_payment_id = b.payment_id
--     FROM cobros_duplicados_quitados b WHERE b.payment_id = <id> AND s.id = ANY (b.stripe_payment_ids);
--   DELETE FROM cobros_duplicados_quitados WHERE payment_id = <id>;
--   COMMIT;
