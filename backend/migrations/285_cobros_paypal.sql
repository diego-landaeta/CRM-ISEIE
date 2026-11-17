-- ============================================================
-- 285: cobros de PayPal y el ORIGEN de cada cobro (#766, Automatizaciones 3/9)
-- ============================================================
-- Hasta ahora PayPal solo existía como forma de pago que se apunta a mano. Con
-- esto, los cobros de la cuenta PayPal Business de cada campus entran solos:
-- por el sondeo de la API de informes de PayPal y, si está dado de alta, por el
-- webhook firmado. Cada cobro se enlaza a su venta como los de Stripe.
--
--   paypal_payments        un cobro de PayPal (su id de transacción/captura),
--                          igual que `stripe_payments`: se guarda aunque no se
--                          sepa de quién es, y se enlaza a la venta cuando se
--                          sabe. Único por (campus, id de PayPal).
--   paypal_sync_state      hasta dónde ha leído el sondeo en cada campus.
--
--   conversion_payments.origen      de dónde salió el cobro: 'paypal' o
--                                   'santander' (la 286). NULL = apuntado a mano
--                                   o de antes (los de Stripe siguen con su nota
--                                   «Auto-Stripe …» y su enlace en stripe_payments).
--   conversion_payments.origen_ref  el id del cobro en su origen. ÚNICO con el
--                                   origen: el mismo cobro de PayPal o el mismo
--                                   movimiento del banco no pueden entrar dos
--                                   veces en el CRM, ni con dos procesos a la vez.
--
-- Todo detrás de PAYPAL_COBROS_ACTIVO (apagado de serie). Sin el interruptor ni
-- credenciales, estas tablas se quedan vacías.
--
-- Mismo número (285) en los dos CRMs. Se puede pasar dos veces.

BEGIN;

ALTER TABLE conversion_payments
  ADD COLUMN IF NOT EXISTS origen VARCHAR(20),
  ADD COLUMN IF NOT EXISTS origen_ref VARCHAR(120);

ALTER TABLE conversion_payments DROP CONSTRAINT IF EXISTS conversion_payments_origen_valido;
ALTER TABLE conversion_payments ADD CONSTRAINT conversion_payments_origen_valido
  CHECK (origen IS NULL OR origen IN ('paypal', 'santander'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversion_payments_origen_ref
  ON conversion_payments (origen, origen_ref)
  WHERE origen IS NOT NULL AND origen_ref IS NOT NULL;

COMMENT ON COLUMN conversion_payments.origen IS
  'De dónde salió el cobro (#766): paypal | santander. NULL = apuntado a mano (o de Stripe, que lleva su propio enlace).';
COMMENT ON COLUMN conversion_payments.origen_ref IS
  'Id del cobro en su origen (transacción de PayPal, movimiento del extracto). Único con el origen: no se registra dos veces.';

CREATE TABLE IF NOT EXISTS paypal_payments (
  id                    SERIAL          PRIMARY KEY,
  project_id            INTEGER         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  paypal_id             VARCHAR(64)     NOT NULL,
  tipo                  VARCHAR(20)     NOT NULL DEFAULT 'cobro' CHECK (tipo IN ('cobro', 'reembolso')),
  -- completed | pending | reversed | denied | refunded (lo que diga PayPal, normalizado)
  status                VARCHAR(20)     NOT NULL,
  amount                NUMERIC(12,2)   NOT NULL,
  currency              VARCHAR(3)      NOT NULL DEFAULT 'EUR',
  fee_amount            NUMERIC(12,2),
  net_amount            NUMERIC(12,2),
  customer_email        VARCHAR(255),
  customer_name         VARCHAR(255),
  payer_id              VARCHAR(64),
  invoice_id            VARCHAR(127),
  custom_id             VARCHAR(255),
  description           TEXT,
  event_code            VARCHAR(10),
  -- En un reembolso, el cobro que devuelve.
  referencia_paypal_id  VARCHAR(64),
  paypal_created_at     TIMESTAMPTZ     NOT NULL,
  -- El enlace con el CRM, como en stripe_payments.
  lead_id               INTEGER         REFERENCES leads(id) ON DELETE SET NULL,
  conversion_id         INTEGER         REFERENCES conversions(id) ON DELETE SET NULL,
  conversion_payment_id INTEGER         REFERENCES conversion_payments(id) ON DELETE SET NULL,
  link_method           VARCHAR(30),
  linked_by             INTEGER         REFERENCES users(id) ON DELETE SET NULL,
  linked_at             TIMESTAMPTZ,
  -- Por dónde llegó la última vez: 'sondeo' | 'webhook'.
  llegado_por           VARCHAR(10),
  synced_at             TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_paypal_payments_project_id UNIQUE (project_id, paypal_id)
);

CREATE INDEX IF NOT EXISTS idx_paypal_payments_fecha ON paypal_payments (project_id, paypal_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paypal_payments_sin_enlazar ON paypal_payments (project_id) WHERE conversion_payment_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_paypal_payments_cobro ON paypal_payments (conversion_payment_id) WHERE conversion_payment_id IS NOT NULL;

COMMENT ON TABLE paypal_payments IS
  'Cobros de la cuenta PayPal de cada campus (#766). Entran por el sondeo de la API de informes o por el webhook firmado.';

CREATE TABLE IF NOT EXISTS paypal_sync_state (
  project_id         INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  last_sync_at       TIMESTAMPTZ,
  last_synced_until  TIMESTAMPTZ,
  total_imported     INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT
);

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON paypal_payments, paypal_sync_state TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE paypal_payments_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
