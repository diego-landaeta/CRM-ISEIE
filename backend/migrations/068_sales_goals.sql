-- Metas de venta por gestor + periodo (mensual).
-- Una meta = combinación única (user_id, project_id, periodo_yyyymm).
-- meta_ventas: nº de ventas objetivo. meta_facturacion: importe €.

CREATE TABLE IF NOT EXISTS sales_goals (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id        INTEGER REFERENCES projects(id) ON DELETE CASCADE, -- NULL = total cross-proyecto (ISEIE solo tiene 1, igual está)
  periodo_yyyymm    CHAR(7) NOT NULL,   -- formato '2026-06'
  meta_ventas       INTEGER NOT NULL DEFAULT 0 CHECK (meta_ventas >= 0),
  meta_facturacion  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (meta_facturacion >= 0),
  set_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notas             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, project_id, periodo_yyyymm)
);

CREATE INDEX IF NOT EXISTS idx_sales_goals_user_periodo ON sales_goals(user_id, periodo_yyyymm);
CREATE INDEX IF NOT EXISTS idx_sales_goals_periodo ON sales_goals(periodo_yyyymm);
