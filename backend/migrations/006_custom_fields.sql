-- ============================================================
-- Migracion 006: Campos custom en leads
-- Cada proyecto define sus propios campos extra (edad, titulacion, etc)
-- Los valores se guardan en leads.custom_fields JSONB
-- ============================================================

BEGIN;

CREATE TYPE field_type AS ENUM ('text', 'number', 'date', 'select', 'boolean', 'textarea');

CREATE TABLE IF NOT EXISTS project_field_definitions (
  id          SERIAL       PRIMARY KEY,
  project_id  INTEGER      NOT NULL,
  field_key   VARCHAR(60)  NOT NULL,
  label       VARCHAR(150) NOT NULL,
  type        field_type   NOT NULL DEFAULT 'text',
  options     JSONB,
  required    BOOLEAN      NOT NULL DEFAULT false,
  orden       INTEGER      NOT NULL DEFAULT 0,
  grupo       VARCHAR(60),
  active      BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_fd_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT uq_fd_project_key UNIQUE (project_id, field_key)
);

CREATE INDEX idx_fd_project_active ON project_field_definitions (project_id, active, orden);

-- JSONB de valores de campos custom en cada lead
ALTER TABLE leads ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_leads_custom_fields ON leads USING GIN (custom_fields);

COMMENT ON TABLE project_field_definitions IS 'Campos personalizados por proyecto - hasta ~15 campos recomendados por proyecto';
COMMENT ON COLUMN leads.custom_fields IS 'Valores de campos custom: {"edad": 35, "titulacion": "Master"}';
COMMENT ON COLUMN project_field_definitions.field_key IS 'Clave del campo en snake_case (edad, titulacion_actual, etc)';
COMMENT ON COLUMN project_field_definitions.type IS 'Tipo para render en frontend: text, number, date, select, boolean, textarea';
COMMENT ON COLUMN project_field_definitions.options IS 'Solo para type=select: {"choices": ["Opcion 1", "Opcion 2"]}';
COMMENT ON COLUMN project_field_definitions.grupo IS 'Agrupacion visual opcional: "Datos academicos", "Contacto", etc';

COMMIT;
