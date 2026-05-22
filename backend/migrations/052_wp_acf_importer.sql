-- ============================================================
-- Migración 052: importer multi-fuente WP REST + ACF
-- Owner/GRANT ajustado a crm_iseie_user.
-- ============================================================

BEGIN;

ALTER TABLE wc_credentials
  ADD COLUMN IF NOT EXISTS wp_user           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS wp_app_password   VARCHAR(500),
  ADD COLUMN IF NOT EXISTS source_strategy   VARCHAR(20) NOT NULL DEFAULT 'wc_only',
  ADD COLUMN IF NOT EXISTS cpt_endpoints     JSONB           DEFAULT '[]'::jsonb;

ALTER TABLE wc_credentials
  DROP CONSTRAINT IF EXISTS chk_wc_source_strategy;
ALTER TABLE wc_credentials
  ADD CONSTRAINT chk_wc_source_strategy
  CHECK (source_strategy IN ('wc_only', 'wc_plus_cpt'));

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS source_type        VARCHAR(40),
  ADD COLUMN IF NOT EXISTS source_id          INTEGER,
  ADD COLUMN IF NOT EXISTS descripcion_larga  TEXT,
  ADD COLUMN IF NOT EXISTS horas              VARCHAR(50),
  ADD COLUMN IF NOT EXISTS num_modulos        INTEGER,
  ADD COLUMN IF NOT EXISTS fecha_inicio_texto VARCHAR(200),
  ADD COLUMN IF NOT EXISTS imagen_secundaria_1 VARCHAR(500),
  ADD COLUMN IF NOT EXISTS imagen_secundaria_2 VARCHAR(500),
  ADD COLUMN IF NOT EXISTS video_presentacion VARCHAR(500),
  ADD COLUMN IF NOT EXISTS video_opiniones_1  VARCHAR(500),
  ADD COLUMN IF NOT EXISTS video_opiniones_2  VARCHAR(500),
  ADD COLUMN IF NOT EXISTS h2_presentacion        VARCHAR(300),
  ADD COLUMN IF NOT EXISTS h2_a_quien_dirigido    VARCHAR(300),
  ADD COLUMN IF NOT EXISTS h2_objetivos           VARCHAR(300),
  ADD COLUMN IF NOT EXISTS h2_beneficios          VARCHAR(300),
  ADD COLUMN IF NOT EXISTS h2_por_que_estudiar    VARCHAR(300),
  ADD COLUMN IF NOT EXISTS h2_temarios            VARCHAR(300),
  ADD COLUMN IF NOT EXISTS texto_por_que_estudiar TEXT,
  ADD COLUMN IF NOT EXISTS raw_acf            JSONB;

CREATE INDEX IF NOT EXISTS idx_products_source ON products(project_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS product_benefits (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  orden       INTEGER NOT NULL DEFAULT 0,
  texto       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_benefits_product ON product_benefits(product_id, orden);

CREATE TABLE IF NOT EXISTS product_objectives (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  orden       INTEGER NOT NULL DEFAULT 0,
  texto       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_objectives_product ON product_objectives(product_id, orden);

CREATE TABLE IF NOT EXISTS product_faqs (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  orden       INTEGER NOT NULL DEFAULT 0,
  pregunta    TEXT NOT NULL,
  respuesta   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_faqs_product ON product_faqs(product_id, orden);

CREATE TABLE IF NOT EXISTS product_targets (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  orden       INTEGER NOT NULL DEFAULT 0,
  encabezado  VARCHAR(300),
  texto       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_targets_product ON product_targets(product_id, orden);

GRANT ALL PRIVILEGES ON product_benefits, product_objectives, product_faqs, product_targets TO crm_iseie_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_iseie_user;

COMMIT;
