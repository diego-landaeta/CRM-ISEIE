-- CRM-ISEIE 256 = MultiCRM 214 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- 214 · Las ventas viejas que no dicen de qué formación son (#41)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ ARREGLA
--
-- Una venta con VARIOS ARTÍCULOS nacía siempre sin curso: el diálogo de
-- conversión manda `producto_contratado_id: null` a propósito —son varias
-- líneas, no cabe una sola FK— y el texto quedaba como «1x Curso A + 2x Curso
-- B», que no cruza con nada del catálogo.
--
-- Sin curso, NINGÚN PROFESOR COBRA COMISIÓN por esa venta, y en los informes
-- sale bajo «servicio académico».
--
-- El grifo ya está cerrado (`c1ec37fd`): desde ahora el curso sale de las
-- líneas al crear la venta. Esto repara las que quedaron atrás.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA REGLA, QUE ES LA MISMA QUE LA DEL GRIFO
--
-- Las líneas SÍ guardan su `product_id`. Si TODAS las que lo tienen apuntan al
-- MISMO curso, ese es el curso de la venta. Es el caso normal: una venta de un
-- curso partida en dos líneas, o con cantidad.
--
-- Si apuntan a cursos DISTINTOS **no se toca nada**. Ahí de verdad no hay un
-- curso único, y elegir uno sería mandarle la comisión a un profesor en vez de
-- a otro. Esas se quedan en la pantalla «Sin formación» para mirarlas a mano,
-- que es donde tienen que estar.
--
-- Tampoco se tocan las que no tienen líneas, ni las que ya tienen curso.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL NÚMERO
--
-- La 214: `staging` llega a la 207 y las PR abiertas ocupan de la 208 a la 213.
-- Comprobar que sigue libre antes de aplicar. Reaplicable: solo toca ventas que
-- siguen sin curso, y al repararlas dejan de serlo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ESTO MUEVE DINERO. LEER ANTES DE APLICAR
--
-- Atar una venta a su curso hace que EL PROCESO DE COMISIONES DE TUTORES LA
-- VEA. `tutorCommissionsScheduler` corre cada 6 horas, mira los cobros de los
-- ÚLTIMOS 3 MESES y crea la comisión de cada cobro cuya venta tenga curso con
-- una colaboración vigente:
--
--     tutor_collaborations.product_id = conversions.producto_contratado_id
--     y cobro.fecha >= GREATEST(tutor_settings.aplica_desde, colaboración.vigente_desde)
--
-- O sea: al aplicar esto, en las siguientes 6 horas nacen solas las comisiones
-- de los cobros de esos 3 meses para las ventas que se reparen. Es lo correcto
-- si el tutor da ese curso —esa venta es suya y hoy no la cobra nadie—, pero es
-- DINERO QUE SE DEVENGA, y es la decisión que el #41 deja a Diego («si se crean
-- comisiones hacia atrás al atar una venta»). Las comisiones ya creadas no se
-- recalculan ni se borran solas.
--
-- Lo que queda fuera: los cobros de más de 3 meses, y los anteriores a la fecha
-- de arranque del tutor, que nunca se comisionan.
--
-- 1) VER CUÁNTAS VENTAS SE REPARAN, y a qué curso pasarían:
--
--   SELECT c.id, c.fecha_conversion, l.nombre AS alumno, c.importe_total,
--          c.producto_contratado AS dice_ahora, p.nombre AS pasaria_a_ser
--     FROM conversions c
--     JOIN leads l ON l.id = c.lead_id
--     JOIN LATERAL (
--       SELECT MIN(i.product_id) AS pid
--         FROM conversion_items i
--        WHERE i.conversion_id = c.id AND i.product_id IS NOT NULL
--       HAVING COUNT(DISTINCT i.product_id) = 1
--     ) u ON TRUE
--     JOIN products p ON p.id = u.pid
--    WHERE c.producto_contratado_id IS NULL
--    ORDER BY c.fecha_conversion DESC;
--
-- 2) VER LAS COMISIONES QUE NACERÍAN EN LAS SIGUIENTES 6 HORAS, por tutor y mes
--    (es la misma regla que `reconciliar`, solo lectura):
--
--   SELECT tu.nombre AS tutor, to_char(cp.fecha, 'YYYY-MM') AS periodo,
--          COUNT(*) AS comisiones,
--          SUM(ROUND(cp.importe * c.pct / 100, 2)) AS importe
--     FROM conversions cv
--     JOIN LATERAL (
--       SELECT MIN(i.product_id) AS pid
--         FROM conversion_items i
--        WHERE i.conversion_id = cv.id AND i.product_id IS NOT NULL
--       HAVING COUNT(DISTINCT i.product_id) = 1
--     ) u ON TRUE
--     JOIN conversion_payments cp ON cp.conversion_id = cv.id
--     JOIN tutor_collaborations c ON c.product_id = u.pid
--     JOIN users tu ON tu.id = c.tutor_id
--    CROSS JOIN tutor_settings s
--    WHERE cv.producto_contratado_id IS NULL
--      AND c.activa
--      AND cp.fecha >= GREATEST(s.aplica_desde, c.vigente_desde)
--      AND (c.vigente_hasta IS NULL OR cp.fecha <= c.vigente_hasta)
--      AND cp.fecha >= date_trunc('month', CURRENT_DATE - INTERVAL '3 months')
--      AND NOT EXISTS (SELECT 1 FROM tutor_commissions tc
--                       WHERE tc.payment_id = cp.id AND tc.tutor_id = c.tutor_id)
--    GROUP BY 1, 2
--    ORDER BY 2, 1;
--
--    Si no sale ninguna fila, aplicarla no genera comisión alguna.
--
-- 3) SI SE QUIERE REPARAR SIN QUE NAZCAN COMISIONES TODAVÍA: poner
--    `TUTOR_COMMISSIONS_DISABLED=1` en el servidor y reiniciar la API ANTES de
--    aplicar (se lee al arrancar), aplicar, revisar con la consulta 2, y quitarlo
--    cuando se decida. Ojo: el botón «Calcular» de Comisiones también ejecuta
--    esa misma regla a mano.

BEGIN;

-- El antes y el después, para poder deshacerlo sin adivinar. La tabla se
-- queda: ocupa poco y es el único rastro de que esto pasó.
CREATE TABLE IF NOT EXISTS conversions_curso_reparado (
  conversion_id  INTEGER PRIMARY KEY REFERENCES conversions(id) ON DELETE CASCADE,
  decia          VARCHAR(255),
  curso_puesto   INTEGER REFERENCES products(id),
  reparado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Las candidatas: sin curso, con líneas, y todas sus líneas del mismo curso.
CREATE TEMP TABLE reparables ON COMMIT DROP AS
SELECT c.id AS conversion_id,
       c.producto_contratado AS decia,
       u.pid AS curso
  FROM conversions c
  JOIN LATERAL (
    SELECT MIN(i.product_id) AS pid
      FROM conversion_items i
     WHERE i.conversion_id = c.id AND i.product_id IS NOT NULL
    HAVING COUNT(DISTINCT i.product_id) = 1
  ) u ON TRUE
 WHERE c.producto_contratado_id IS NULL;

INSERT INTO conversions_curso_reparado (conversion_id, decia, curso_puesto)
SELECT conversion_id, decia, curso FROM reparables
ON CONFLICT (conversion_id) DO NOTHING;

-- El curso, y de paso el TEXTO: «1x Curso A + 1x Curso A» no le dice nada a
-- nadie, y el nombre del catálogo sí. El texto viejo queda guardado arriba.
UPDATE conversions c
   SET producto_contratado_id = r.curso,
       producto_contratado    = p.nombre,
       updated_at             = NOW()
  FROM reparables r
  JOIN products p ON p.id = r.curso
 WHERE c.id = r.conversion_id;

COMMIT;

-- Para deshacerlo, si hiciera falta:
--
--   UPDATE conversions c
--      SET producto_contratado_id = NULL,
--          producto_contratado    = r.decia
--     FROM conversions_curso_reparado r
--    WHERE r.conversion_id = c.id;

-- Que el CRM pueda leerla aunque la migración la pase postgres (como la 230, la 231 y la 232).
-- Faltaba: lo vio la auditoría de la 2.6.0 (02/11).
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON conversions_curso_reparado TO %I', r);
    END IF;
  END LOOP;
END $$;
