-- Campos extra para gestion de disputas:
-- - dispute_id: id de Stripe del dispute (dp_xxx)
-- - dispute_evidence_due_by: fecha limite para responder
-- - dispute_amount: monto en disputa
-- - dispute_my_decision: decision interna (pending/accept_refund/contest/won/lost)
-- - dispute_notes: notas internas
-- - dispute_decided_at/by: auditoria

BEGIN;

ALTER TABLE stripe_payments
  ADD COLUMN IF NOT EXISTS dispute_id              VARCHAR(255),
  ADD COLUMN IF NOT EXISTS dispute_evidence_due_by TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispute_amount          NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS dispute_my_decision     VARCHAR(30),
  ADD COLUMN IF NOT EXISTS dispute_notes           TEXT,
  ADD COLUMN IF NOT EXISTS dispute_decided_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispute_decided_by      INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sp_dispute_open
  ON stripe_payments (project_id) WHERE disputed = true AND dispute_my_decision IS DISTINCT FROM 'closed';

COMMIT;
