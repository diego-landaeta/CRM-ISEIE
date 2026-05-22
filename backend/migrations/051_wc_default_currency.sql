-- Migración 051: divisa por defecto del WC import
ALTER TABLE wc_credentials
  ADD COLUMN IF NOT EXISTS default_currency VARCHAR(10) NOT NULL DEFAULT 'EUR';
