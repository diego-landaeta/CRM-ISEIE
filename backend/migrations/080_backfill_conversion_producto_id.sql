-- Backfill: rellenar conversions.producto_contratado_id matching por nombre.
--
-- Por qué: las conversiones se han venido creando guardando solo el TEXTO del
-- producto (`producto_contratado`) y dejando el FK `producto_contratado_id`
-- en NULL. Esto rompe los JOINs con `products` en dashboards/reportes.
--
-- Estrategia: matching exacto sobre nombre normalizado (lowercase + sin
-- acentos), por proyecto. Si el match no es único, no actualizamos (deja NULL).
-- Si no hay match, deja NULL (productos huérfanos que ya no existen en WP).
--
-- SAFE:
--   - Solo UPDATE en conversions
--   - NO toca products (el WC sync sigue trabajando intacto)
--   - Idempotente: ejecutar 2 veces da el mismo resultado
--   - Solo afecta filas con producto_contratado_id IS NULL (ya rellenadas no se tocan)

BEGIN;

WITH conv_norm AS (
  SELECT id, project_id, producto_contratado,
         LOWER(TRANSLATE(producto_contratado, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN')) AS norm
  FROM conversions
  WHERE producto_contratado_id IS NULL
    AND producto_contratado IS NOT NULL
),
prod_norm AS (
  SELECT id AS product_id, project_id,
         LOWER(TRANSLATE(nombre, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN')) AS norm
  FROM products
  WHERE active = TRUE
),
prod_unicos AS (
  -- Solo aceptamos el match si el nombre normalizado es ÚNICO en ese proyecto
  SELECT project_id, norm, MIN(product_id) AS product_id
  FROM prod_norm
  GROUP BY project_id, norm
  HAVING COUNT(*) = 1
),
matches AS (
  SELECT c.id AS conversion_id, p.product_id
  FROM conv_norm c
  JOIN prod_unicos p ON p.project_id = c.project_id AND p.norm = c.norm
)
UPDATE conversions c
SET producto_contratado_id = m.product_id,
    updated_at = NOW()
FROM matches m
WHERE c.id = m.conversion_id;

COMMIT;
