-- ============================================================
-- 278: ventas a plazos — la suscripción de Stripe se cierra sola (#747)
-- ============================================================
-- Manuel, 12/11/2026: «si nadie cancela la suscripción a tiempo se cobra una
-- cuota de más. Ya ha pasado». El CRM guarda en cada venta su suscripción de
-- Stripe y, cuando lo cobrado llega al total de la venta, la cancela él y
-- avisa a admisión del campus y a Manuel.
--
-- (Gemela de la 256 del CRM 360.)
--
-- Se puede pasar dos veces.

BEGIN;

ALTER TABLE conversions
  -- La suscripción de Stripe de la venta (sub_…). Sale sola del primer cobro
  -- asociado que venga de una factura de suscripción.
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255),
  -- activa · cerrando (reservada mientras se cancela) · cancelada (la cerró el
  -- CRM) · ya_cerrada (estaba cerrada en Stripe) · revisar (llega al total pero
  -- quedan cuotas previstas sin cobrar) · error (Stripe no dejó cancelarla).
  ADD COLUMN IF NOT EXISTS suscripcion_estado VARCHAR(20),
  ADD COLUMN IF NOT EXISTS suscripcion_revisada_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suscripcion_cerrada_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suscripcion_error TEXT;

ALTER TABLE conversions DROP CONSTRAINT IF EXISTS conversions_suscripcion_estado_valido;
ALTER TABLE conversions ADD CONSTRAINT conversions_suscripcion_estado_valido
  CHECK (suscripcion_estado IS NULL OR suscripcion_estado IN
         ('activa', 'cerrando', 'cancelada', 'ya_cerrada', 'revisar', 'error'));

-- Las que quedan por vigilar.
CREATE INDEX IF NOT EXISTS idx_conversions_suscripcion_abierta
  ON conversions (id)
  WHERE stripe_subscription_id IS NOT NULL AND suscripcion_cerrada_at IS NULL;

-- De qué suscripción es cada cargo, y si ya se ha preguntado (para no preguntar
-- a Stripe dos veces por el mismo cargo).
ALTER TABLE stripe_payments
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS suscripcion_buscada BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_stripe_payments_suscripcion_por_buscar
  ON stripe_payments (id)
  WHERE conversion_id IS NOT NULL AND NOT suscripcion_buscada;

COMMENT ON COLUMN conversions.stripe_subscription_id IS
  'Suscripción de Stripe de la venta a plazos (#747). Al llegar lo cobrado al total, el CRM la cancela.';

COMMIT;
