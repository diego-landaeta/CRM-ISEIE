-- ============================================================
-- 021: Editor de forms (CRM-175)
-- ============================================================

CREATE TABLE IF NOT EXISTS form_templates (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  embed_id VARCHAR(40) NOT NULL UNIQUE,
  nombre VARCHAR(200) NOT NULL,
  template_kind VARCHAR(50) NOT NULL DEFAULT 'contacto_basico',  -- contacto_basico | lead_con_producto | custom
  schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {color, button_label, success_msg, redirect_url, show_logo, show_producto_label}
  active BOOLEAN NOT NULL DEFAULT true,
  submissions_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forms_project ON form_templates(project_id);
