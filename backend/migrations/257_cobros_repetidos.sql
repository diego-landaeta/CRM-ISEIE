-- CRM-ISEIE 257 = MultiCRM 215 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- 215 · Los cobros repetidos del libro (#135, #42): SE LISTAN, NO SE BORRAN
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ PASA
--
-- En `conversion_payments` hay filas repetidas: la misma venta, el mismo
-- importe y la misma fecha de cobro. En producción, el 02/11/2026, eran 78
-- filas y 22.341,10 €. Casi todas son el mismo dinero apuntado dos veces:
--
--   · primero, a mano: la gestora registró el cobro;
--   · después, la sincronización de Stripe. Las cargas del 18/06 y del 24/07
--     metieron otra vez los cargos que ya estaban. Entonces la sincronización no
--     comprobaba si ese cobro ya existía. Hoy sí lo hace (`findPagoDuplicado`),
--     y por eso no han vuelto a salir.
--
-- Por eso Ventas, la gráfica de ingresos y el «dinero que entró» dicen más que
-- Reportes, que usa `importe_pagado` de la venta. Ese campo está bien.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ YA NO SE BORRA NADA
--
-- La versión anterior borraba los repetidos que no tenían nada colgando.
-- Diego, 02/11/2026: «no puede hacerse». Además no habría servido:
--
--   · 73 de los 78 son la fila que enlaza el cargo de Stripe. Borrarla deja el
--     cargo sin cobro (`ON DELETE SET NULL`), y la siguiente sincronización lo
--     volvería a crear;
--   · algunos «repetidos» son cuotas iguales cobradas el mismo día, que son
--     dinero de verdad: las ventas 187, 189, 270, 374 y 435.
--
-- Ahora la migración solo los LISTA en `cobros_repetidos_revision`, cada uno con
-- un diagnóstico, para revisarlos a mano. No toca `conversion_payments`, ni las
-- ventas, ni las facturas, ni Stripe.
--
--   · «duplicado seguro»: al quitarlo, el libro de esa venta cuadra con su
--     `importe_pagado`;
--   · «cuotas legitimas»: el libro ya cuadra contando la fila, así que es dinero
--     de verdad;
--   · «revisar»: no cuadra ni de una forma ni de otra. Hay otro descuadre en
--     esa venta.
--
-- La decisión de cada fila (`decision`) la apunta una persona. Que las sumas
-- dejen de contar los duplicados confirmados es otro cambio, que toca las
-- consultas que suman el libro.
--
-- Reaplicable: actualiza el diagnóstico y no pisa una decisión ya tomada.

BEGIN;

-- Si en algún entorno se aplicó la 180 de la rama de Ángel, su índice único
-- (venta, importe, fecha) rechazaría un segundo cobro igual el mismo día, que
-- Stripe y la casilla «duplicado permitido» hacen a propósito. Si no existe, no
-- hace nada.
DROP INDEX IF EXISTS uq_cobro_venta_importe_fecha;

CREATE TABLE IF NOT EXISTS cobros_repetidos_revision (
  payment_id      INTEGER PRIMARY KEY REFERENCES conversion_payments(id) ON DELETE CASCADE,
  original_id     INTEGER REFERENCES conversion_payments(id) ON DELETE SET NULL,
  conversion_id   INTEGER NOT NULL,
  importe         DECIMAL(10,2) NOT NULL,
  fecha           DATE NOT NULL,
  metodo          VARCHAR(30),
  creado          DATE,
  original_creado DATE,
  de_stripe       BOOLEAN NOT NULL DEFAULT false,
  con_factura     BOOLEAN NOT NULL DEFAULT false,
  diagnostico     VARCHAR(20) NOT NULL
                  CHECK (diagnostico IN ('duplicado seguro', 'cuotas legitimas', 'revisar')),
  detectado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Lo que decida una persona: 'es duplicado' o 'es cobro real'.
  decision        VARCHAR(20) CHECK (decision IN ('es duplicado', 'es cobro real')),
  decidido_por    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decidido_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cobros_repetidos_revision_venta ON cobros_repetidos_revision (conversion_id);

-- Repetidos: misma (venta, importe, fecha, método, moneda, referencia). Se lista
-- todo menos la primera fila que se creó, que es la que se queda como original.
WITH g AS (
  SELECT cp.*,
         ROW_NUMBER() OVER w AS puesto,
         FIRST_VALUE(cp.id) OVER w AS original_id,
         FIRST_VALUE(cp.created_at) OVER w AS original_alta
    FROM conversion_payments cp
  WINDOW w AS (PARTITION BY cp.conversion_id, cp.importe, cp.fecha,
               COALESCE(cp.metodo, ''), COALESCE(cp.moneda, ''), COALESCE(cp.referencia, '')
               ORDER BY cp.created_at, cp.id)
), rep AS (
  SELECT * FROM g WHERE puesto > 1
), venta AS (
  SELECT r.conversion_id,
         sum(r.importe) AS repetido,
         (SELECT sum(x.importe) FROM conversion_payments x WHERE x.conversion_id = r.conversion_id) AS libro,
         c.importe_pagado AS pagado
    FROM rep r JOIN conversions c ON c.id = r.conversion_id
   GROUP BY r.conversion_id, c.importe_pagado
)
INSERT INTO cobros_repetidos_revision
  (payment_id, original_id, conversion_id, importe, fecha, metodo, creado, original_creado,
   de_stripe, con_factura, diagnostico)
SELECT r.id, r.original_id, r.conversion_id, r.importe, r.fecha, r.metodo,
       r.created_at::date, r.original_alta::date,
       EXISTS (SELECT 1 FROM stripe_payments s WHERE s.conversion_payment_id = r.id),
       EXISTS (SELECT 1 FROM invoices i WHERE i.payment_id = r.id),
       CASE
         WHEN abs(v.libro - v.repetido - v.pagado) <= 0.05 THEN 'duplicado seguro'
         WHEN abs(v.libro - v.pagado) <= 0.05 THEN 'cuotas legitimas'
         ELSE 'revisar'
       END
  FROM rep r JOIN venta v ON v.conversion_id = r.conversion_id
ON CONFLICT (payment_id) DO UPDATE
   SET diagnostico = EXCLUDED.diagnostico,
       de_stripe   = EXCLUDED.de_stripe,
       con_factura = EXCLUDED.con_factura;

-- Decir qué ha salido. Una migración que trata dinero y no cuenta lo que ha
-- tocado obliga a fiarse de ella.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT diagnostico, count(*) AS n, sum(importe) AS euros
             FROM cobros_repetidos_revision WHERE decision IS NULL
            GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'Cobros repetidos por revisar · %: % (% EUR)', r.diagnostico, r.n, r.euros;
  END LOOP;
END $$;

-- Que el CRM pueda leerla, y apuntar la decisión, aunque la migración la pase postgres.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, UPDATE ON cobros_repetidos_revision TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Para verlos:
--
--   SELECT r.diagnostico, r.conversion_id AS venta, l.nombre AS cliente, r.importe,
--          r.fecha, r.metodo, r.payment_id AS cobro, r.original_id AS original,
--          r.creado, r.original_creado, r.de_stripe, r.con_factura, r.decision
--     FROM cobros_repetidos_revision r
--     JOIN conversions c ON c.id = r.conversion_id
--     JOIN leads l ON l.id = c.lead_id
--    ORDER BY r.diagnostico, r.conversion_id;
--
-- Para deshacerla: DROP TABLE cobros_repetidos_revision; (no ha cambiado nada más)
