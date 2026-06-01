-- Índice para acelerar el listado de productos del catálogo.
-- findByProject usa: WHERE project_id = X AND active = true ORDER BY created_at DESC.
-- Con 669+ productos sin índice compuesto, hace seq scan + sort en memoria.

CREATE INDEX IF NOT EXISTS idx_products_list
  ON products (project_id, active, created_at DESC)
  WHERE active = true;

-- Para findById en hot-path después del listado, ya existe products_pkey.

ANALYZE products;
