-- ============================================================
-- Migracion 005: Tabla expenses (egresos)
-- Permite al CRM llevar contabilidad completa (ingresos via conversions,
-- egresos via esta tabla).
-- ============================================================

BEGIN;

CREATE TYPE expense_category AS ENUM (
  'salarios',
  'alquiler',
  'proveedores',
  'software',
  'publicidad',
  'impuestos',
  'servicios',
  'mantenimiento',
  'otros'
);

CREATE TABLE IF NOT EXISTS expenses (
  id          SERIAL          PRIMARY KEY,
  project_id  INTEGER,
  concepto    VARCHAR(255)    NOT NULL,
  importe     DECIMAL(12,2)   NOT NULL CHECK (importe > 0),
  fecha       DATE            NOT NULL DEFAULT CURRENT_DATE,
  categoria   expense_category NOT NULL DEFAULT 'otros',
  notas       TEXT,
  registrado_por INTEGER,
  created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_expenses_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  CONSTRAINT fk_expenses_user
    FOREIGN KEY (registrado_por) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_expenses_project_fecha ON expenses (project_id, fecha);
CREATE INDEX idx_expenses_fecha ON expenses (fecha);
CREATE INDEX idx_expenses_categoria ON expenses (categoria);

COMMENT ON TABLE expenses IS 'Gastos operativos del negocio (salarios, alquiler, software, etc). project_id = NULL = gasto general no atribuible a un proyecto';
COMMENT ON COLUMN expenses.categoria IS 'Categoria contable del egreso';

COMMIT;
