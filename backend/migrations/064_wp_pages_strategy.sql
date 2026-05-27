-- Permite source_strategy='wp_pages' para sitios sin WC ni CPTs,
-- donde los "productos" son páginas WordPress (caso ISEIE).
-- cpt_endpoints se reusa para guardar los parent IDs de las páginas educativas.

ALTER TABLE wc_credentials DROP CONSTRAINT IF EXISTS chk_wc_source_strategy;
ALTER TABLE wc_credentials ADD CONSTRAINT chk_wc_source_strategy
  CHECK (source_strategy IN ('wc_only', 'wc_plus_cpt', 'wp_pages'));
