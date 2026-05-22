-- Migración 045 (product_modules): módulos/temario de productos.
-- Owner ajustado a crm_iseie_user.

CREATE TABLE IF NOT EXISTS product_modules (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  orden       INTEGER NOT NULL DEFAULT 0,
  titulo      VARCHAR(300) NOT NULL,
  descripcion TEXT,
  horas       INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_modules_product ON product_modules(product_id, orden);

ALTER TABLE product_modules OWNER TO crm_iseie_user;
ALTER SEQUENCE product_modules_id_seq OWNER TO crm_iseie_user;
