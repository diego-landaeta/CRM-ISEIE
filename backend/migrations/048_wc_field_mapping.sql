-- Migración 048: mapping configurable para WC import
ALTER TABLE wc_credentials
  ADD COLUMN IF NOT EXISTS field_mapping JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN wc_credentials.field_mapping IS
  'Mapeo configurable de campos WC API → producto CRM. Si está vacío usa mapeo automático.';
