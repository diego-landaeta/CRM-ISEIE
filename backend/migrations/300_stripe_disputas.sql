-- ============================================================
-- 300: disputas de Stripe, una fila por disputa (#396, gemela de la 282 de CRM#839)
-- ============================================================
-- Hasta ahora una disputa vivia en las columnas dispute_* de su cargo
-- (stripe_payments, migraciones 086 y 087). Eso deja fuera dos casos que la
-- tarea necesita:
--
--   · La disputa de un cargo que el CRM no tiene: anterior al corte del alta
--     del campus, o que no entro nunca. El webhook hacia un UPDATE sobre una
--     fila que no existe y la disputa se perdia sin aviso.
--   · Saber si ya se aviso a los admins (al entrar y cuando quedan pocos dias)
--     sin repetir el aviso en cada vuelta del sondeo.
--
-- Las columnas dispute_* del cargo siguen igual y se siguen escribiendo: la
-- pantalla de Pagos Stripe las lee. Esta tabla es la que lee la de Disputas.
--
-- Solo lectura de Stripe: nada de aqui se manda a Stripe. La respuesta a la
-- disputa se da en el panel de Stripe.
--
-- (En ISEIE es la 300: 299 es la ultima de staging y 304-305 las usa una PR abierta.)
--
-- Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS stripe_disputes (
  id                  SERIAL        PRIMARY KEY,
  project_id          INTEGER       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dispute_id          VARCHAR(255)  NOT NULL,          -- dp_… (o du_… en las antiguas)
  charge_id           VARCHAR(255),                    -- ch_… / py_…
  payment_intent_id   VARCHAR(255),
  -- En la moneda de la disputa, en unidades (no centimos). No se suman monedas
  -- distintas: el resumen las separa.
  amount              NUMERIC(14,2) NOT NULL,
  currency            VARCHAR(3)    NOT NULL,
  reason              VARCHAR(60),
  -- warning_needs_response · warning_under_review · warning_closed ·
  -- needs_response · under_review · won · lost · prevented · charge_refunded
  status              VARCHAR(40)   NOT NULL,
  evidence_due_by     TIMESTAMPTZ,                     -- fecha limite para responder
  has_evidence        BOOLEAN,
  customer_email      VARCHAR(255),
  customer_name       VARCHAR(255),
  livemode            BOOLEAN       NOT NULL DEFAULT true,
  stripe_created_at   TIMESTAMPTZ   NOT NULL,
  -- Por donde llego por primera vez: 'webhook' o 'sondeo'.
  origen              VARCHAR(20),
  -- Avisos a los admins: al entrar, y el segundo cuando quedan pocos dias y
  -- sigue sin respuesta en Stripe. Se marcan ANTES de avisar (con una sola
  -- sentencia) para que el webhook y el sondeo no avisen los dos.
  avisada_at          TIMESTAMPTZ,
  recordada_at        TIMESTAMPTZ,
  synced_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_stripe_disputes_project_dispute UNIQUE (project_id, dispute_id)
);

-- Las abiertas, que es lo que se mira casi siempre.
CREATE INDEX IF NOT EXISTS idx_stripe_disputes_abiertas
  ON stripe_disputes (project_id, evidence_due_by)
  WHERE status IN ('warning_needs_response', 'warning_under_review', 'needs_response', 'under_review');

CREATE INDEX IF NOT EXISTS idx_stripe_disputes_charge
  ON stripe_disputes (project_id, charge_id);

-- Cuando se miraron las disputas de cada cuenta por ultima vez, y si fallo.
ALTER TABLE stripe_sync_state
  ADD COLUMN IF NOT EXISTS disputes_synced_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disputes_last_error TEXT;

COMMENT ON TABLE stripe_disputes IS
  'Disputas de Stripe de cada campus (#396). Solo lectura de Stripe; avisos a los admins de su empresa.';

-- Como en la 245 y la 247: en el servidor la migracion la pasa postgres y la API
-- entra como crm_user (crm_iseie_user en la gemela). Sin esto, la pantalla y el
-- sondeo dan «permiso denegado».
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON stripe_disputes TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE stripe_disputes_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
