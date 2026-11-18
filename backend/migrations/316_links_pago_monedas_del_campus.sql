-- 316 · Links de pago: cada campus admite también las monedas en que ya cobra
--       (#407, gemela de CRM#680, donde es la 303)
--
-- Diego, 18/11: arrancar con los valores de la CRM#862 (caducidad 7 días y 30 como
-- máximo, descuento máximo 0 %, EUR por defecto; los pone la 314 y la 315) y,
-- «si un campus cobra en otra moneda, deja esa moneda admitida en ese campus».
--
-- Se mira lo que el campus ya cobra, en dos sitios:
--   · su catálogo: cursos activos con precio en otra moneda (`products.moneda`);
--   · su cuenta de Stripe: los cargos que entraron en otra moneda. El sondeo
--     guarda el importe en euros y la moneda del cargo en
--     `stripe_payments.metadata->>'original_currency'`.
--
-- Solo AÑADE monedas a `links_pago_monedas`, detrás de las que ya tenga y en
-- orden alfabético. No toca la de por defecto (sigue EUR) ni quita ninguna que un
-- admin haya puesto. Un link en una moneda distinta a la del precio del catálogo
-- lo sigue creando solo el admin (`SIN_PRECIO_COMPARABLE`).
--
-- Se puede pasar dos veces: la segunda no encuentra nada que añadir.

BEGIN;

WITH cobradas AS (
  SELECT project_id, upper(btrim(moneda)) AS moneda
    FROM products
   WHERE precio > 0 AND COALESCE(active, TRUE)
  UNION
  SELECT project_id, upper(btrim(metadata->>'original_currency'))
    FROM stripe_payments
   WHERE metadata ? 'original_currency'
),
nuevas AS (
  SELECT c.project_id, array_agg(DISTINCT c.moneda ORDER BY c.moneda)::VARCHAR(3)[] AS monedas
    FROM cobradas c
    JOIN projects p ON p.id = c.project_id
   WHERE c.moneda ~ '^[A-Z]{3}$'
     AND NOT (c.moneda = ANY (p.links_pago_monedas))
   GROUP BY c.project_id
)
UPDATE projects p
   SET links_pago_monedas = p.links_pago_monedas || n.monedas
  FROM nuevas n
 WHERE n.project_id = p.id;

COMMIT;
