-- ============================================================
-- Migracion 088: stripe_payments
-- Tabla para guardar historial de pagos Stripe sincronizados.
-- Permite:
--   - IA (Psicologo IA): monitor live de quien pago/disputo/cancelo
--   - Educativo (ISEIH/ISEIE): historico + asociacion con conversions
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS stripe_payments (
  id                    SERIAL          PRIMARY KEY,
  project_id            INTEGER         NOT NULL,
  -- Stripe identifiers
  stripe_id             VARCHAR(255)    NOT NULL,
  type                  VARCHAR(30)     NOT NULL CHECK (type IN ('payment_intent', 'charge', 'invoice', 'subscription')),
  status                VARCHAR(30)     NOT NULL,
  -- Amount
  amount                NUMERIC(10,2)   NOT NULL,
  currency              VARCHAR(3)      NOT NULL DEFAULT 'EUR',
  -- Customer
  customer_email        VARCHAR(255),
  customer_name         VARCHAR(255),
  customer_stripe_id    VARCHAR(255),
  -- Context
  description           TEXT,
  metadata              JSONB,
  payment_method        VARCHAR(30),       -- card / sepa_debit / bank_transfer / etc
  -- Linking with CRM
  conversion_id         INTEGER,
  conversion_payment_id INTEGER,
  lead_id               INTEGER,
  linked_at             TIMESTAMPTZ,
  linked_by             INTEGER,
  link_method           VARCHAR(20),       -- auto_email_match / manual / null
  -- Disputes
  disputed              BOOLEAN         NOT NULL DEFAULT false,
  dispute_status        VARCHAR(30),
  dispute_reason        TEXT,
  -- Refunds
  refunded              BOOLEAN         NOT NULL DEFAULT false,
  refunded_amount       NUMERIC(10,2),
  -- Timestamps
  stripe_created_at     TIMESTAMPTZ     NOT NULL,
  synced_at             TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_sp_project           FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_sp_conversion        FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE SET NULL,
  CONSTRAINT fk_sp_conversion_payment FOREIGN KEY (conversion_payment_id) REFERENCES conversion_payments(id) ON DELETE SET NULL,
  CONSTRAINT fk_sp_lead              FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_sp_linked_by         FOREIGN KEY (linked_by) REFERENCES users(id) ON DELETE SET NULL,
  -- Mismo stripe_id no puede repetirse para el mismo proyecto
  CONSTRAINT uq_sp_project_stripe_id UNIQUE (project_id, stripe_id)
);

CREATE INDEX idx_sp_project_status   ON stripe_payments (project_id, status);
CREATE INDEX idx_sp_customer_email   ON stripe_payments (project_id, customer_email);
CREATE INDEX idx_sp_unlinked         ON stripe_payments (project_id) WHERE conversion_id IS NULL;
CREATE INDEX idx_sp_stripe_created   ON stripe_payments (project_id, stripe_created_at DESC);
CREATE INDEX idx_sp_disputed         ON stripe_payments (project_id) WHERE disputed = true;

-- Sync metadata por proyecto (cuando fue la ultima sync, evita re-paginar)
CREATE TABLE IF NOT EXISTS stripe_sync_state (
  project_id           INTEGER         PRIMARY KEY,
  last_sync_at         TIMESTAMPTZ,
  last_full_sync_at    TIMESTAMPTZ,
  last_synced_until    TIMESTAMPTZ,    -- el created_at mas reciente que sincronizamos
  total_imported       INTEGER         NOT NULL DEFAULT 0,
  last_error           TEXT,

  CONSTRAINT fk_sss_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

COMMENT ON TABLE stripe_payments    IS 'Historial de pagos Stripe sincronizados. Linkable con conversions y conversion_payments.';
COMMENT ON TABLE stripe_sync_state  IS 'Estado de sincronizacion Stripe por proyecto: ultima fecha sincronizada, errores, totales.';

COMMIT;
