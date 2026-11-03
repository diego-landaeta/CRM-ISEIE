-- CRM-ISEIE 259 = MultiCRM 237 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- 237 · Cobros apuntados a mano que repiten un cargo de Stripe (#135, #42)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ PASA
--
-- La 236 quita las copias exactas (misma venta, importe, fecha, método y
-- referencia). Quedan otras que la 215 dejó en «revisar» o en «cuotas
-- legitimas» y que también son el mismo dinero dos veces: la gestora apuntó el
-- cobro a mano y después entró el cargo de Stripe, a veces con otra fecha (el
-- «Pago inicial» se apuntaba el día del alta, no el del cargo).
--
-- Lo que prueba que el dinero entró es el cargo de Stripe. Esta migración
-- quita SOLO el cobro apuntado a mano y deja el de Stripe, si se cumple todo:
--
--   · el cobro a mano no tiene cargo de Stripe, ni factura, ni comisión de
--     tutor, ni cuota, ni devolución, ni aviso, y no dice que fue por
--     transferencia, efectivo u otra vía (método vacío o tarjeta);
--   · en la misma venta hay un cobro de Stripe cobrado con el mismo importe
--     (±0,01 €) que no repite ya otro cobro a mano. Cada cargo cubre una sola
--     copia;
--   · regla 1, «misma fecha»: el cargo es del mismo día;
--   · regla 2, «otra fecha»: si las fechas no coinciden, solo se quita cuando,
--     sin esas copias, TODO lo que queda en la venta es dinero de Stripe, y
--     con ellas la venta pasaba de su total y sin ellas ya no.
--
-- Después, `importe_pagado` de la venta:
--
--   · si ya cuadraba sin las copias (±1 € de redondeo), no se toca;
--   · si las había sumado, se le restan, para que cuadre con lo que queda;
--   · si no cuadra ni así, no se toca y sale en el aviso: es un error del
--     total de la venta, no un duplicado, y lo decide una persona.
--
-- Cada cobro quitado va a `cobros_duplicados_quitados` (la de la 236) con su
-- justificación y el cargo de Stripe que lo prueba. Cada `importe_pagado`
-- cambiado va a `ventas_pagado_corregido`, con el antes y el después.
--
-- Producción del 360, 02/11/2026 (solo lectura): ventas 175, 176, 187, 189,
-- 194, 196, 199, 200, 206 y 270. No toca la 374 ni la 435 (cuotas de verdad:
-- dos cargos distintos, o dos transferencias) ni la 326 (tres cargos distintos).
--
-- Reaplicable: lo ya quitado no vuelve a salir.

BEGIN;

CREATE TABLE IF NOT EXISTS cobros_duplicados_quitados (
  payment_id         INTEGER PRIMARY KEY,
  original_id        INTEGER NOT NULL,
  conversion_id      INTEGER NOT NULL,
  importe            DECIMAL(10,2) NOT NULL,
  fecha              DATE NOT NULL,
  fila               JSONB NOT NULL,
  stripe_payment_ids INTEGER[] NOT NULL DEFAULT '{}',
  justificacion      TEXT NOT NULL,
  quitado_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ventas_pagado_corregido (
  id            SERIAL PRIMARY KEY,
  conversion_id INTEGER NOT NULL,
  antes         DECIMAL(10,2) NOT NULL,
  despues       DECIMAL(10,2) NOT NULL,
  motivo        TEXT NOT NULL,
  corregido_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cobros a mano que podrían ser copia: sin nada colgando, en ventas con Stripe.
CREATE TEMP TABLE _m ON COMMIT DROP AS
SELECT cp.id, cp.conversion_id, cp.importe, cp.fecha
  FROM conversion_payments cp
 WHERE COALESCE(cp.metodo, 'tarjeta') = 'tarjeta'
   AND NOT EXISTS (SELECT 1 FROM stripe_payments x WHERE x.conversion_payment_id = cp.id)
   AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.payment_id = cp.id)
   AND NOT EXISTS (SELECT 1 FROM tutor_commissions x WHERE x.payment_id = cp.id)
   AND NOT EXISTS (SELECT 1 FROM conversion_installments x WHERE x.payment_id = cp.id)
   AND NOT EXISTS (SELECT 1 FROM conversion_refunds x WHERE x.payment_id = cp.id)
   AND NOT EXISTS (SELECT 1 FROM webhooks_salientes_envios x WHERE x.payment_id = cp.id);

-- Cobros de Stripe cobrados: la prueba de que el dinero entró.
CREATE TEMP TABLE _s ON COMMIT DROP AS
SELECT cp.id, cp.conversion_id, cp.importe, cp.fecha,
       (SELECT min(x.stripe_id) FROM stripe_payments x WHERE x.conversion_payment_id = cp.id) AS cargo
  FROM conversion_payments cp
 WHERE EXISTS (SELECT 1 FROM stripe_payments x
                WHERE x.conversion_payment_id = cp.id AND x.status = 'succeeded');

CREATE TEMP TABLE _par (
  manual_id INTEGER PRIMARY KEY, stripe_cp_id INTEGER UNIQUE NOT NULL,
  conversion_id INTEGER NOT NULL, importe DECIMAL(10,2) NOT NULL, regla TEXT NOT NULL
) ON COMMIT DROP;

-- Regla 1: mismo día y mismo importe.
WITH m AS (SELECT *, row_number() OVER (PARTITION BY conversion_id, fecha, round(importe) ORDER BY id) AS rn
             FROM _m WHERE conversion_id IN (SELECT conversion_id FROM _s)),
     s AS (SELECT *, row_number() OVER (PARTITION BY conversion_id, fecha, round(importe) ORDER BY id) AS rn FROM _s)
INSERT INTO _par
SELECT m.id, s.id, m.conversion_id, m.importe, 'misma fecha'
  FROM m JOIN s ON s.conversion_id = m.conversion_id AND s.fecha = m.fecha
               AND round(s.importe) = round(m.importe) AND s.rn = m.rn
 WHERE abs(s.importe - m.importe) <= 0.01;

-- Regla 2: mismo importe en otra fecha, entre lo que quedó sin pareja.
WITH m AS (SELECT *, row_number() OVER (PARTITION BY conversion_id, round(importe) ORDER BY fecha, id) AS rn
             FROM _m WHERE id NOT IN (SELECT manual_id FROM _par)),
     s AS (SELECT *, row_number() OVER (PARTITION BY conversion_id, round(importe) ORDER BY fecha, id) AS rn
             FROM _s WHERE id NOT IN (SELECT stripe_cp_id FROM _par))
INSERT INTO _par
SELECT m.id, s.id, m.conversion_id, m.importe, 'otra fecha'
  FROM m JOIN s ON s.conversion_id = m.conversion_id AND round(s.importe) = round(m.importe) AND s.rn = m.rn
 WHERE abs(s.importe - m.importe) <= 0.01;

-- La regla 2 solo vale si, sin las copias, todo lo que queda en la venta es de
-- Stripe, y además con ellas la venta pasaba de su total y sin ellas ya no.
-- Así una cuota pagada de verdad por otra vía no se confunde con una copia.
DELETE FROM _par p
 WHERE p.regla = 'otra fecha'
   AND (EXISTS (SELECT 1 FROM conversion_payments cp
                 WHERE cp.conversion_id = p.conversion_id
                   AND cp.id NOT IN (SELECT manual_id FROM _par)
                   AND cp.id NOT IN (SELECT id FROM _s))
        OR NOT EXISTS (
          SELECT 1 FROM conversions c
           WHERE c.id = p.conversion_id
             AND (SELECT sum(cp.importe) FROM conversion_payments cp
                   WHERE cp.conversion_id = c.id
                     AND cp.id NOT IN (SELECT x.manual_id FROM _par x WHERE x.regla = 'misma fecha'))
                 > c.importe_total + 1.00
             AND (SELECT sum(cp.importe) FROM conversion_payments cp
                   WHERE cp.conversion_id = c.id AND cp.id NOT IN (SELECT manual_id FROM _par))
                 <= c.importe_total + 1.00));

-- Lo que había antes, por venta, para decidir qué hacer con importe_pagado.
CREATE TEMP TABLE _venta ON COMMIT DROP AS
SELECT c.id AS conversion_id, c.importe_pagado AS pagado, c.importe_total AS total,
       (SELECT sum(cp.importe) FROM conversion_payments cp WHERE cp.conversion_id = c.id) AS libro,
       (SELECT sum(p.importe) FROM _par p WHERE p.conversion_id = c.id) AS quitado
  FROM conversions c
 WHERE c.id IN (SELECT conversion_id FROM _par);

INSERT INTO cobros_duplicados_quitados
  (payment_id, original_id, conversion_id, importe, fecha, fila, stripe_payment_ids, justificacion)
SELECT p.manual_id, p.stripe_cp_id, p.conversion_id, m.importe, m.fecha, to_jsonb(m),
       '{}',
       format('Cobro apuntado a mano (%s del %s%s) que repite el cobro %s de Stripe (cargo %s, %s del %s), %s. '
              'Del apuntado a mano no cuelga factura, comisión, cuota, devolución ni aviso. Se queda el de Stripe.',
              m.importe, to_char(m.fecha, 'DD/MM/YYYY'),
              CASE WHEN m.notas IS NOT NULL AND m.notas <> '' THEN ', «' || left(m.notas, 60) || '»' ELSE '' END,
              s.id, sv.cargo, s.importe, to_char(s.fecha, 'DD/MM/YYYY'),
              CASE p.regla WHEN 'misma fecha' THEN 'mismo día'
                   ELSE 'en otra fecha; sin las copias, todo lo cobrado de la venta es de Stripe' END)
  FROM _par p
  JOIN conversion_payments m ON m.id = p.manual_id
  JOIN conversion_payments s ON s.id = p.stripe_cp_id
  JOIN _s sv ON sv.id = s.id
ON CONFLICT (payment_id) DO NOTHING;

DELETE FROM conversion_payments d USING _par p WHERE d.id = p.manual_id;

-- En la lista de la 215, el cobro de Stripe que se queda es dinero de verdad.
UPDATE cobros_repetidos_revision r
   SET decision = 'es cobro real', decidido_at = NOW()
  FROM _par p
 WHERE r.payment_id = p.stripe_cp_id AND r.decision IS NULL;

-- importe_pagado: solo si había sumado las copias.
INSERT INTO ventas_pagado_corregido (conversion_id, antes, despues, motivo)
SELECT v.conversion_id, v.pagado, v.pagado - v.quitado,
       format('Había sumado %s de cobros apuntados a mano que repetían cargos de Stripe (migración 237).', v.quitado)
  FROM _venta v
 WHERE abs((v.libro - v.quitado) - v.pagado) > 1.00
   AND abs((v.libro - v.quitado) - (v.pagado - v.quitado)) <= 0.05;

UPDATE conversions c
   SET importe_pagado = k.despues, updated_at = NOW()
  FROM ventas_pagado_corregido k
 WHERE k.conversion_id = c.id
   AND k.corregido_at = NOW()
   AND c.id IN (SELECT conversion_id FROM _venta);

DO $$
DECLARE n INTEGER; euros NUMERIC; r RECORD;
BEGIN
  SELECT count(*), COALESCE(sum(importe), 0) INTO n, euros FROM _par;
  RAISE NOTICE 'Cobros a mano que repetían Stripe, quitados: % (% EUR).', n, euros;

  FOR r IN SELECT k.conversion_id, k.antes, k.despues FROM ventas_pagado_corregido k
            WHERE k.corregido_at = NOW() ORDER BY 1 LOOP
    RAISE NOTICE 'Venta %: importe_pagado % -> %', r.conversion_id, r.antes, r.despues;
  END LOOP;

  -- Lo que sigue sin cuadrar no es un duplicado: lo decide una persona.
  FOR r IN SELECT v.conversion_id, v.total, c.importe_pagado AS pagado,
                  (SELECT sum(cp.importe) FROM conversion_payments cp WHERE cp.conversion_id = v.conversion_id) AS libro
             FROM _venta v JOIN conversions c ON c.id = v.conversion_id
            ORDER BY 1 LOOP
    IF abs(r.libro - r.pagado) > 1.00 OR r.libro > r.total + 1.00 THEN
      RAISE NOTICE 'Venta % por decidir: total %, pagado %, cobrado %', r.conversion_id, r.total, r.pagado, r.libro;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON cobros_duplicados_quitados, ventas_pagado_corregido TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Para devolver un cobro, la receta de la 236 (aquí no se movió ningún cargo).
-- Para devolver un importe_pagado:
--   UPDATE conversions c SET importe_pagado = k.antes FROM ventas_pagado_corregido k
--    WHERE k.conversion_id = c.id AND k.id = <id>;
