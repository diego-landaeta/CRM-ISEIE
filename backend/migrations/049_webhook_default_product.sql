-- Migración 049: producto por defecto + matching por URL en webhooks

ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS default_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS url_match_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_products_url_info_lookup
  ON products (project_id, url_info) WHERE url_info IS NOT NULL;
