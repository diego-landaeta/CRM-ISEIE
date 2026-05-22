-- ============================================================
-- 022: Nominas (CRM-171, CRM-173)
-- payroll_plans = config por usuario (fijo, horas, comisiones)
-- payroll_periods = mes cerrado, snapshot del calculo
-- payroll_adjustments = bonos / anticipos / extras / descuentos
-- work_hours = registro de horas trabajadas (cuando aplica modo horas)
-- ============================================================

CREATE TABLE IF NOT EXISTS payroll_plans (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  modo_fijo NUMERIC(12,2),  -- monto mensual; null si no aplica
  modo_horas NUMERIC(12,2),  -- precio/hora; null si no aplica
  modo_comisiones BOOLEAN NOT NULL DEFAULT false,  -- usa commissions calculadas
  active BOOLEAN NOT NULL DEFAULT true,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_alguno CHECK (modo_fijo IS NOT NULL OR modo_horas IS NOT NULL OR modo_comisiones)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_plan_proj_user ON payroll_plans(project_id, user_id);

CREATE TABLE IF NOT EXISTS work_hours (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  horas NUMERIC(6,2) NOT NULL CHECK (horas > 0),
  notas TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_hours_user_fecha ON work_hours(user_id, fecha);
CREATE INDEX IF NOT EXISTS idx_work_hours_project ON work_hours(project_id);

CREATE TABLE IF NOT EXISTS payroll_periods (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  periodo_year INTEGER NOT NULL,
  periodo_month INTEGER NOT NULL CHECK (periodo_month BETWEEN 1 AND 12),
  fijo NUMERIC(12,2) NOT NULL DEFAULT 0,
  horas_total NUMERIC(8,2) NOT NULL DEFAULT 0,
  precio_hora NUMERIC(12,2),
  monto_horas NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_comisiones NUMERIC(12,2) NOT NULL DEFAULT 0,
  ajustes NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado VARCHAR(20) NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado', 'pagado')),
  cerrado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cerrado_at TIMESTAMPTZ,
  fecha_pago DATE,
  detalle JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_period ON payroll_periods(project_id, user_id, periodo_year, periodo_month);

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id SERIAL PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('bono', 'anticipo', 'descuento', 'extra')),
  importe NUMERIC(12,2) NOT NULL,  -- positivo = suma, negativo = resta (anticipo/descuento)
  concepto VARCHAR(255) NOT NULL,
  doc_url TEXT,
  doc_key TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adj_period ON payroll_adjustments(period_id);
