-- Multi-cursos por lead (#18).
-- Tabla N:N que permite que un lead se interese en varios programas además
-- del principal (leads.producto_interes_id sigue siendo el "principal" para
-- backward-compat: pipelines, filtros, conversiones del flujo actual).
--
-- Cada producto secundario puede tener su propio gestor responsable.
-- Caso de uso: Carmen lleva el interés en Diplomado X, Daniela el Máster Y al mismo lead.

CREATE TABLE IF NOT EXISTS lead_products (
  id                    SERIAL PRIMARY KEY,
  lead_id               INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  product_id            INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  responsable_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status                lead_status NOT NULL DEFAULT 'nuevo',
  notas                 TEXT,
  added_by_user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_via             VARCHAR(20) NOT NULL DEFAULT 'manual',
  -- 'manual' | 'auto_reincidente' | 'webhook' | 'wc'
  added_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_products_lead ON lead_products(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_products_product ON lead_products(product_id);
CREATE INDEX IF NOT EXISTS idx_lead_products_responsable ON lead_products(responsable_id) WHERE responsable_id IS NOT NULL;
