-- ============================================================
-- Migracion 008: Tabla accounts_payable (cuentas por pagar)
-- Registra facturas/deudas pendientes con proveedores, permitiendo
-- pagos parciales y seguimiento de vencimientos. Complementa expenses:
-- expenses = gastos ya realizados, accounts_payable = deudas a pagar.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS accounts_payable (
  id                      SERIAL          PRIMARY KEY,
  project_id              INTEGER,
  proveedor               VARCHAR(255)    NOT NULL,
  concepto                VARCHAR(255)    NOT NULL,
  categoria               expense_category NOT NULL DEFAULT 'proveedores',
  importe_total           DECIMAL(12,2)   NOT NULL CHECK (importe_total > 0),
  importe_pagado          DECIMAL(12,2)   NOT NULL DEFAULT 0 CHECK (importe_pagado >= 0),
  fecha_factura           DATE            NOT NULL DEFAULT CURRENT_DATE,
  fecha_compromiso_pago   DATE,
  estado                  VARCHAR(20)     NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'parcial', 'pagado', 'cancelado')),
  notas                   TEXT,
  registrado_por          INTEGER,
  created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_ap_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  CONSTRAINT fk_ap_user    FOREIGN KEY (registrado_por) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_ap_pagado_vs_total CHECK (importe_pagado <= importe_total)
);

CREATE INDEX idx_ap_project_estado ON accounts_payable (project_id, estado);
CREATE INDEX idx_ap_fecha_compromiso ON accounts_payable (fecha_compromiso_pago) WHERE estado IN ('pendiente', 'parcial');

CREATE TABLE IF NOT EXISTS accounts_payable_payments (
  id              SERIAL          PRIMARY KEY,
  payable_id      INTEGER         NOT NULL,
  importe         DECIMAL(12,2)   NOT NULL CHECK (importe > 0),
  fecha_pago      DATE            NOT NULL DEFAULT CURRENT_DATE,
  metodo          VARCHAR(50),
  referencia      VARCHAR(100),
  notas           TEXT,
  registrado_por  INTEGER,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_app_payable FOREIGN KEY (payable_id) REFERENCES accounts_payable(id) ON DELETE CASCADE,
  CONSTRAINT fk_app_user    FOREIGN KEY (registrado_por) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_app_payable ON accounts_payable_payments (payable_id);

COMMENT ON TABLE accounts_payable IS 'Facturas/deudas pendientes con proveedores';
COMMENT ON TABLE accounts_payable_payments IS 'Historial de pagos parciales/totales de cada factura';

COMMIT;
