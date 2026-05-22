-- ============================================================
-- 023: WooCommerce import + mapeo (CRM-177)
-- ============================================================

CREATE TABLE IF NOT EXISTS wc_credentials (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  store_url TEXT NOT NULL,
  consumer_key TEXT NOT NULL,
  consumer_secret TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wc_creds_project ON wc_credentials(project_id);

CREATE TABLE IF NOT EXISTS wc_field_mappings (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  wc_field VARCHAR(200) NOT NULL,
  crm_field VARCHAR(100) NOT NULL,
  is_meta BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wc_map_project ON wc_field_mappings(project_id);

CREATE TABLE IF NOT EXISTS wc_import_runs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  triggered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'running',  -- running, success, error
  total_fetched INTEGER NOT NULL DEFAULT 0,
  total_created INTEGER NOT NULL DEFAULT 0,
  total_updated INTEGER NOT NULL DEFAULT 0,
  total_skipped INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wc_runs_project ON wc_import_runs(project_id);

ALTER TABLE products ADD COLUMN IF NOT EXISTS wc_product_id INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS wc_meta JSONB;
CREATE INDEX IF NOT EXISTS idx_products_wc_id ON products(wc_product_id) WHERE wc_product_id IS NOT NULL;
