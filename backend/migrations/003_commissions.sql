-- ============================================================
-- CRM-ISEIE — Migración 003: Comisiones
-- Depende de: 001 (users, projects), 002 (conversions, products)
-- ============================================================
--
-- Consolida del CRM hermano:
--   011 → commission_rules + commissions (esqueleto inicial)
--   016 → rediseño: product_id NULL-able, base_calc enum, condicion JSONB,
--          UNIQUE con NULLS NOT DISTINCT
-- ============================================================

BEGIN;

-- ============================================================
-- COMMISSION_RULES — regla "gestor X cobra Y% por producto Z (o todo)"
-- product_id NULL = aplica a todas las ventas del gestor en ese proyecto
-- ============================================================
CREATE TABLE commission_rules (
    id          SERIAL          PRIMARY KEY,
    project_id  INTEGER         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     INTEGER         NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    product_id  INTEGER         REFERENCES products(id) ON DELETE CASCADE,
    pct         DECIMAL(5,2)    NOT NULL CHECK (pct >= 0 AND pct <= 100),
    base_calc   VARCHAR(20)     NOT NULL DEFAULT 'cobrado'
                                CHECK (base_calc IN ('cobrado', 'vendido')),
    condicion   JSONB,
    active      BOOLEAN         NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Una regla por (proyecto, gestor, producto). NULL en product = regla genérica.
CREATE UNIQUE INDEX uq_cr_project_user_product
    ON commission_rules (project_id, user_id, COALESCE(product_id, 0));

CREATE INDEX idx_cr_project_user ON commission_rules (project_id, user_id) WHERE active = true;

COMMENT ON TABLE commission_rules IS 'Reglas: gestor X cobra Y% por producto Z. Lo define superadmin.';
COMMENT ON COLUMN commission_rules.product_id IS 'NULL = aplica a todas las ventas del gestor; NOT NULL = override por producto';
COMMENT ON COLUMN commission_rules.base_calc IS 'Base de cálculo: cobrado (importe pagado) o vendido (importe total)';
COMMENT ON COLUMN commission_rules.condicion IS 'Condición JSONB opcional: { field, op, value } o { op:AND/OR, rules:[...] }';

-- Trigger updated_at
CREATE TRIGGER trg_commission_rules_updated_at
    BEFORE UPDATE ON commission_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- COMMISSIONS — generadas automáticamente al crear/pagar conversion
-- ============================================================
CREATE TABLE commissions (
    id               SERIAL          PRIMARY KEY,
    conversion_id    INTEGER         NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,
    rule_id          INTEGER         REFERENCES commission_rules(id) ON DELETE SET NULL,
    user_id          INTEGER         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id       INTEGER         REFERENCES products(id) ON DELETE SET NULL,
    importe_base     DECIMAL(12,2)   NOT NULL,
    pct              DECIMAL(5,2)    NOT NULL,
    importe_comision DECIMAL(12,2)   NOT NULL,
    base_calc        VARCHAR(20)     NOT NULL DEFAULT 'cobrado'
                                     CHECK (base_calc IN ('cobrado', 'vendido')),
    estado           VARCHAR(20)     NOT NULL DEFAULT 'pendiente'
                                     CHECK (estado IN ('pendiente', 'pagado', 'cancelado')),
    fecha_pago       DATE,
    notas            TEXT,
    created_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_co_conversion UNIQUE (conversion_id)
);

CREATE INDEX idx_co_user_estado ON commissions (user_id, estado);
CREATE INDEX idx_co_created     ON commissions (created_at);

COMMENT ON TABLE commissions IS 'Comisiones generadas automáticamente al crear/pagar una conversion.';

CREATE TRIGGER trg_commissions_updated_at
    BEFORE UPDATE ON commissions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
