-- Asociar productos a AdSets (no solo a campañas). Cada adset suele corresponder
-- a un producto distinto en cuentas multi-curso (ej. una campaña "Ventas" con N
-- adsets, cada uno por maestría).
CREATE TABLE IF NOT EXISTS meta_adset_products (
  id                    SERIAL PRIMARY KEY,
  adset_id              VARCHAR(50) NOT NULL REFERENCES meta_adsets(adset_id) ON DELETE CASCADE,
  product_id            INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asociado_por_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notas                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (adset_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_map_adset ON meta_adset_products(adset_id);
CREATE INDEX IF NOT EXISTS idx_map_project ON meta_adset_products(project_id);
