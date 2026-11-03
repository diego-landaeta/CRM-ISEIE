-- CRM-ISEIE 268 = MultiCRM 231 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- 231 · (antes 212, que chocó con la de matrículas de staging) Las ventas que guardaron el nombre del cliente como producto (#160)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ PASÓ
--
-- `createSale` mandaba el NOMBRE DEL CLIENTE como `producto_contratado`
-- —«override por service si tiene lookup», decía su comentario— contando con
-- que el servicio lo corrigiera. Pero aquel lookup solo iba de texto a id, y
-- cuando el id ya venía puesto no se ejecutaba: el texto se quedaba tal cual.
--
-- Resultado: toda venta registrada desde el formulario guardó al cliente como
-- programa, y la lista de Ventas enseñaba «Pedro Sanchez» en esa columna.
--
-- El alta ya está arreglada (conversion.service.js): con id del catálogo, el
-- nombre sale del catálogo. Esto repara las que quedaron mal.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A QUÉ VENTAS TOCA, Y A CUÁLES NO
--
-- Solo a las que cumplen las TRES cosas a la vez:
--
--   1. tienen `producto_contratado_id`: es lo que se eligió en el desplegable,
--      y es la fuente buena. Sin id, el texto es lo único que hay y no se toca,
--      aunque sea el nombre de una persona: borrarlo dejaría la venta sin
--      ninguna pista de qué se vendió. Peor el remedio.
--   2. el texto no coincide con el nombre del catálogo.
--   3. y ese texto es justo lo que el fallo escribía: el nombre del cliente de
--      la venta, o el literal «Cliente» cuando no había nombre.
--
-- La tercera es la que acota. Sin ella, esta migración reescribiría también
-- una venta cuyo texto difiere del catálogo por otra razón legítima —un curso
-- que se renombró después, una tilde—, y eso no es de este fallo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ANTES DE APLICARLA: MIRAR A CUÁNTAS AFECTA Y QUÉ SE QUEDA FUERA
--
--   -- las que se reparan
--   SELECT c.id, c.producto_contratado AS dice_ahora, p.nombre AS deberia_decir
--     FROM conversions c
--     JOIN products p ON p.id = c.producto_contratado_id
--     JOIN leads l ON l.id = c.lead_id
--    WHERE TRIM(c.producto_contratado) IS DISTINCT FROM TRIM(p.nombre)
--      AND LOWER(TRIM(c.producto_contratado)) IN (LOWER(TRIM(l.nombre)), 'cliente')
--    ORDER BY c.fecha_conversion DESC;
--
--   -- las que difieren del catálogo y NO se tocan (para que alguien las mire)
--   SELECT c.id, c.producto_contratado AS dice_ahora, p.nombre AS catalogo
--     FROM conversions c
--     JOIN products p ON p.id = c.producto_contratado_id
--     JOIN leads l ON l.id = c.lead_id
--    WHERE TRIM(c.producto_contratado) IS DISTINCT FROM TRIM(p.nombre)
--      AND LOWER(TRIM(c.producto_contratado)) NOT IN (LOWER(TRIM(l.nombre)), 'cliente')
--    ORDER BY c.fecha_conversion DESC;

BEGIN;

-- El antes y el después quedan apuntados, que es dinero y conviene poder
-- deshacerlo sin adivinar. La tabla se queda: ocupa poco y es el único rastro.
CREATE TABLE IF NOT EXISTS conversions_producto_reparado (
  conversion_id  INTEGER PRIMARY KEY REFERENCES conversions(id) ON DELETE CASCADE,
  decia          VARCHAR(255),
  pasa_a_decir   VARCHAR(255),
  reparado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO conversions_producto_reparado (conversion_id, decia, pasa_a_decir)
SELECT c.id, c.producto_contratado, p.nombre
  FROM conversions c
  JOIN products p ON p.id = c.producto_contratado_id
  JOIN leads l ON l.id = c.lead_id
 WHERE TRIM(c.producto_contratado) IS DISTINCT FROM TRIM(p.nombre)
   AND LOWER(TRIM(c.producto_contratado)) IN (LOWER(TRIM(l.nombre)), 'cliente')
ON CONFLICT (conversion_id) DO NOTHING;

-- Se repara desde la tabla de arriba y no repitiendo el filtro: lo que se
-- cambia es exactamente lo que quedó apuntado, ni una fila más. Y como solo
-- toca las que siguen diciendo lo que decían, volver a aplicarla no hace nada.
UPDATE conversions c
   SET producto_contratado = r.pasa_a_decir,
       updated_at = NOW()
  FROM conversions_producto_reparado r
 WHERE r.conversion_id = c.id
   AND c.producto_contratado IS NOT DISTINCT FROM r.decia;

COMMIT;

-- Para deshacerlo, si hiciera falta:
--
--   UPDATE conversions c SET producto_contratado = r.decia
--     FROM conversions_producto_reparado r
--    WHERE r.conversion_id = c.id AND c.producto_contratado = r.pasa_a_decir;

-- Que el CRM pueda leer y escribir aunque la migración la pase postgres (como la 230 y la 232).
-- Faltaba: en /testeo, Soporte daba «permission denied for table tickets» (02/11).
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON conversions_producto_reparado TO %I', r);
    END IF;
  END LOOP;
END $$;
