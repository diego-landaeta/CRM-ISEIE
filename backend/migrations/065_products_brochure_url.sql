-- Añade brochure_url para almacenar PDF/folleto del curso extraído por scraper.
-- stripe_link ya existe (migration 002).
ALTER TABLE products ADD COLUMN IF NOT EXISTS brochure_url VARCHAR(500);
COMMENT ON COLUMN products.brochure_url IS 'URL de descarga del folleto/brochure/dossier PDF (extraído por scraper)';
