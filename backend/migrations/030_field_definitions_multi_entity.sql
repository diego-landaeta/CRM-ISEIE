-- ============================================================
-- Migracion 030: Campos custom multi-entidad (lead, client, product)
-- Extiende project_field_definitions; anade custom_fields a clients (si existe) y products.
-- ============================================================

BEGIN;

ALTER TABLE project_field_definitions
  ADD COLUMN IF NOT EXISTS entity VARCHAR(20) NOT NULL DEFAULT 'lead'
    CHECK (entity IN ('lead', 'client', 'product'));

ALTER TABLE project_field_definitions DROP CONSTRAINT IF EXISTS uq_fd_project_key;
ALTER TABLE project_field_definitions DROP CONSTRAINT IF EXISTS uq_fd_project_entity_key;
ALTER TABLE project_field_definitions
  ADD CONSTRAINT uq_fd_project_entity_key UNIQUE (project_id, entity, field_key);

DROP INDEX IF EXISTS idx_fd_project_active;
CREATE INDEX IF NOT EXISTS idx_fd_project_entity_active
  ON project_field_definitions (project_id, entity, active, orden);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clients') THEN
    EXECUTE 'ALTER TABLE clients ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT ''{}''::jsonb';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_clients_custom_fields ON clients USING GIN (custom_fields)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products') THEN
    EXECUTE 'ALTER TABLE products ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT ''{}''::jsonb';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_products_custom_fields ON products USING GIN (custom_fields)';
  END IF;
END $$;

COMMENT ON COLUMN project_field_definitions.entity IS
  'Entidad sobre la que aplica el campo: lead | client | product. Mismo field_key puede coexistir en distintas entidades del mismo proyecto.';

COMMIT;
