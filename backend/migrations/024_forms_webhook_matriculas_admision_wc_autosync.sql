-- ============================================================
-- 024: 3 mejoras
--   1) form_templates.field_mapping + kind webhook
--   2) matriculas: estados extendidos + datos_admision + webhook_token
--   3) wc_credentials: auto_sync_enabled + sync_interval_minutes
-- Nota: el rol DB en CRM-ISEIE es crm_iseie_user (no crm_user del hermano).
-- ============================================================

-- ===== Forms: kind webhook + field_mapping
ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'form',  -- form | webhook
  ADD COLUMN IF NOT EXISTS field_mapping JSONB NOT NULL DEFAULT '{}'::jsonb;
  -- field_mapping: {"target_field": "source_path"} ej {"nombre": "data.full_name", "email": "contact.email"}

-- ===== Matriculas: estados extendidos + datos admision
ALTER TABLE matriculas DROP CONSTRAINT IF EXISTS matriculas_estado_check;
ALTER TABLE matriculas ADD CONSTRAINT matriculas_estado_check
  CHECK (estado IN ('solicitud_admision', 'datos_validados', 'pendiente', 'validada', 'rechazada'));

ALTER TABLE matriculas
  ALTER COLUMN conversion_id DROP NOT NULL,  -- en solicitud admision aun no hay conversion
  ADD COLUMN IF NOT EXISTS datos_admision JSONB,  -- payload completo del webhook
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual',  -- manual | webhook | form
  ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(150),  -- DNI o email para evitar duplicados
  ADD COLUMN IF NOT EXISTS webhook_received_at TIMESTAMPTZ;

-- Indice de dedupe por proyecto (DNI o email)
CREATE UNIQUE INDEX IF NOT EXISTS uq_matricula_project_dedupe
  ON matriculas (project_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Token webhook por proyecto (compartido para ambos casos: forms webhook y matriculas)
CREATE TABLE IF NOT EXISTS project_webhook_tokens (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind VARCHAR(30) NOT NULL,  -- 'matriculas' | 'leads' | 'custom'
  token VARCHAR(80) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  field_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  notas TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  uses_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pwt_project_kind ON project_webhook_tokens(project_id, kind);

-- ===== WooCommerce auto-sync
ALTER TABLE wc_credentials
  ADD COLUMN IF NOT EXISTS auto_sync_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sync_interval_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS last_wc_count INTEGER;  -- ultimo total de productos visto, para skip si no cambio

-- ===== Owner correcto para nuevas tablas (rol DB: crm_iseie_user)
ALTER TABLE project_webhook_tokens OWNER TO crm_iseie_user;
ALTER SEQUENCE project_webhook_tokens_id_seq OWNER TO crm_iseie_user;
