-- Migración 039 (categories): árbol N niveles para product_categories

ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS external_url TEXT;
ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual';
ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_product_categories_external
  ON product_categories(project_id, source, external_id);
