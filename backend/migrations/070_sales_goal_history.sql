-- Historial de cambios en metas de venta. Snapshot del estado anterior cada
-- vez que se hace UPSERT en sales_goals.
-- Permite ver: quién cambió, cuándo, de qué a qué.

CREATE TABLE IF NOT EXISTS sales_goal_history (
  id                    SERIAL PRIMARY KEY,
  goal_id               INTEGER REFERENCES sales_goals(id) ON DELETE SET NULL,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id            INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  periodo_yyyymm        CHAR(7) NOT NULL,
  -- Estado nuevo (lo que queda activo tras el cambio)
  meta_ventas           INTEGER NOT NULL,
  meta_facturacion      NUMERIC(10,2) NOT NULL,
  -- Estado previo (NULL = creación inicial; valores = edición de meta existente)
  prev_meta_ventas      INTEGER,
  prev_meta_facturacion NUMERIC(10,2),
  notas                 TEXT,
  -- Acción: 'create' (no existía), 'update' (cambio), 'delete' (se borró)
  action                VARCHAR(10) NOT NULL,
  changed_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sgh_user_changed ON sales_goal_history(user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sgh_periodo ON sales_goal_history(periodo_yyyymm);
CREATE INDEX IF NOT EXISTS idx_sgh_goal ON sales_goal_history(goal_id);
