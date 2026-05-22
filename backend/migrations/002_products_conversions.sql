-- ============================================================
-- CRM-ISEIE — Migración 002: extras para products + conversions
-- Depende de: 001_initial_schema.sql
-- ============================================================
--
-- Consolida del CRM hermano las migraciones que añaden las columnas/tablas
-- que `products` y `conversions` necesitan más allá del esqueleto en 001:
--   010 → projects.logo_url/logo_key + products.precio/moneda/stripe_link/sku/duracion/url_info
--   012 → conversions.producto_contratado_id (FK)
--   017 → tabla conversion_installments (cuotas fraccionadas)
--   041 → products.image_url
--   054 → products.modalidad
--   060 → tabla conversion_refunds (devoluciones)
--   062 → tabla product_url_aliases (slugs alternativos por proyecto)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PROJECTS — logo
-- ============================================================
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS logo_key VARCHAR(500);

COMMENT ON COLUMN projects.logo_url IS 'URL pública del logo del proyecto (R2 o /api/projects/:id/logo)';
COMMENT ON COLUMN projects.logo_key IS 'Key interno en R2/disco para servir/borrar el logo';

-- ============================================================
-- 2. PRODUCTS — campos comerciales + imagen + modalidad
-- ============================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS precio        DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS moneda        VARCHAR(10) NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS stripe_link   VARCHAR(500),
  ADD COLUMN IF NOT EXISTS sku           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS duracion      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS url_info      VARCHAR(500),
  ADD COLUMN IF NOT EXISTS image_url     TEXT,
  ADD COLUMN IF NOT EXISTS image_key     VARCHAR(500),
  ADD COLUMN IF NOT EXISTS modalidad     VARCHAR(80);

COMMENT ON COLUMN products.precio IS 'Precio del producto (sin IVA)';
COMMENT ON COLUMN products.stripe_link IS 'Stripe Payment Link / Checkout URL';
COMMENT ON COLUMN products.url_info IS 'URL con más info (landing pública del producto)';
COMMENT ON COLUMN products.image_url IS 'URL absoluta o clave "r2://…" de la imagen del producto';
COMMENT ON COLUMN products.modalidad IS 'Online / Presencial / Mixto / Híbrido (extraído por scraper o ACF)';

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_project_nombre
    ON products (project_id, nombre) WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_dossiers_product_active
    ON dossiers (product_id, active);

-- ============================================================
-- 3. CONVERSIONS — FK al producto del catálogo
-- ============================================================
ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS producto_contratado_id INTEGER;

-- Añadir FK solo si no existe (PG no tiene IF NOT EXISTS para constraints)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_conv_product'
  ) THEN
    ALTER TABLE conversions
      ADD CONSTRAINT fk_conv_product
      FOREIGN KEY (producto_contratado_id) REFERENCES products(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_conv_product ON conversions (producto_contratado_id);

-- ============================================================
-- 4. CONVERSION_INSTALLMENTS (cuotas fraccionadas)
-- ============================================================
CREATE TABLE IF NOT EXISTS conversion_installments (
    id                 SERIAL          PRIMARY KEY,
    conversion_id      INTEGER         NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,
    numero             INTEGER         NOT NULL,
    importe_previsto   DECIMAL(12,2)   NOT NULL CHECK (importe_previsto > 0),
    fecha_vencimiento  DATE            NOT NULL,
    fecha_cobro        DATE,
    importe_cobrado    DECIMAL(12,2),
    metodo             VARCHAR(50),
    enviar_email       BOOLEAN         NOT NULL DEFAULT false,
    email_enviado_at   TIMESTAMPTZ,
    payment_id         INTEGER         REFERENCES conversion_payments(id) ON DELETE SET NULL,
    notas              TEXT,
    created_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_inst_conversion_numero UNIQUE (conversion_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_inst_vencimiento ON conversion_installments (fecha_vencimiento) WHERE fecha_cobro IS NULL;
CREATE INDEX IF NOT EXISTS idx_inst_conversion  ON conversion_installments (conversion_id);

COMMENT ON TABLE conversion_installments IS 'Cuotas previstas de una conversión fraccionada. fecha_cobro NULL = pendiente.';

-- Trigger updated_at para la tabla nueva (set_updated_at() definida en 001)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_conversion_installments_updated_at'
  ) THEN
    CREATE TRIGGER trg_conversion_installments_updated_at
      BEFORE UPDATE ON conversion_installments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END$$;

-- ============================================================
-- 5. CONVERSION_REFUNDS (devoluciones)
-- ============================================================
CREATE TABLE IF NOT EXISTS conversion_refunds (
    id              SERIAL         PRIMARY KEY,
    conversion_id   INTEGER        NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,
    importe         DECIMAL(12,2)  NOT NULL CHECK (importe > 0),
    fecha           DATE           NOT NULL DEFAULT CURRENT_DATE,
    motivo          TEXT,
    created_by      INTEGER        REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversion_refunds_conversion
    ON conversion_refunds (conversion_id, fecha DESC);

COMMENT ON TABLE conversion_refunds IS
  'Devoluciones registradas sobre conversiones. El importe se resta del neto al leer pero no modifica importe_pagado.';

-- ============================================================
-- 6. PRODUCT_URL_ALIASES (slugs alternativos por proyecto)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_url_aliases (
    id          SERIAL         PRIMARY KEY,
    project_id  INTEGER        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    product_id  INTEGER        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url_slug    VARCHAR(255)   NOT NULL,
    source_host VARCHAR(255),
    created_by  INTEGER        REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_product_url_aliases UNIQUE (project_id, url_slug)
);

CREATE INDEX IF NOT EXISTS idx_product_url_aliases_lookup
    ON product_url_aliases (project_id, url_slug);

CREATE INDEX IF NOT EXISTS idx_product_url_aliases_product
    ON product_url_aliases (product_id);

COMMENT ON TABLE product_url_aliases IS
  'Slugs alternativos de URL que apuntan al mismo producto. Útil para multi-sitio con slugs distintos (ES master vs MX maestría).';

COMMIT;
