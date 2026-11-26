-- ============================================================
-- 343: cobro automático cancelado en Stripe (CRM#1103 / CRM-ISEIE#759)
-- ============================================================
-- Carlos, 24/11/2026: «la persona cancela la suscripción en Stripe y no se hace
-- el pago: como no se cobra, no sale el aviso de impago». El webhook ya recibía
-- `customer.subscription.deleted`, pero nadie lo trataba: la cuota que Stripe
-- ya no iba a cobrar seguía en el CRM como si se fuera a cobrar sola.
--
-- Desde ahora, cuando Stripe cancela (o da por perdido) el cobro de una cuota:
--   · la cuota SIGUE PENDIENTE (no se toca `fecha_cobro`): si vence sin
--     cobrarse, es impago, como cualquier otra (Alumnos activos, Por cobrar);
--   · queda marcada «cobro automático cancelado», con la fecha y el motivo que
--     da Stripe;
--   · se avisa a la gestora de la venta y a los admins del campus, una vez;
--   · en la ficha de la venta sale un botón para mandarle un link de esa cuota.
--
-- Vale para las dos formas de cobrar cuotas solas con Stripe:
--   · el cobro automático del CRM (309): el calendario (Subscription Schedule);
--   · las ventas a plazos con suscripción de Stripe (#747, 256).
--
--   conversion_installments.cobro_auto_cancelado_el / _motivo
--       La marca en la cuota. Se borra si se vuelve a programar en Stripe.
--   conversion_cobro_auto.cancelado_en_stripe_el / _motivo
--       Por qué se quitó el cobro automático de la venta (sin persona del CRM).
--   cobro_auto_cuotas.estado  + 'cancelada'
--       Programada (o fallida) que Stripe ya no cobrará. No se reintenta.
--   conversions.suscripcion_estado  + 'cancelada_en_stripe'
--       La suscripción de la venta a plazos la canceló Stripe (o el alumno)
--       antes de cobrarla entera.
--   stripe_cobros_cancelados
--       Una fila por cancelación: la llave (venta + suscripción, calendario o
--       factura de Stripe) hace que un aviso repetido de Stripe no cuente ni
--       avise dos veces.
--
-- CHECK y no ENUM, como en la 256 y la 309. Se puede pasar dos veces.
-- Mismo contenido en los dos CRMs (aquí 343; en el 360, 332).

BEGIN;

ALTER TABLE conversion_installments
  ADD COLUMN IF NOT EXISTS cobro_auto_cancelado_el     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cobro_auto_cancelado_motivo TEXT;

COMMENT ON COLUMN conversion_installments.cobro_auto_cancelado_el IS
  'Stripe canceló (o dio por perdido) el cobro automático de esta cuota (CRM#1103). Sigue pendiente: se cobra con un link.';

ALTER TABLE conversion_cobro_auto
  ADD COLUMN IF NOT EXISTS cancelado_en_stripe_el     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelado_en_stripe_motivo TEXT;

ALTER TABLE cobro_auto_cuotas DROP CONSTRAINT IF EXISTS cobro_auto_cuotas_estado;
ALTER TABLE cobro_auto_cuotas ADD CONSTRAINT cobro_auto_cuotas_estado
  CHECK (estado IN ('programada', 'cobrada', 'fallida', 'quitada', 'cancelada'));

ALTER TABLE conversions DROP CONSTRAINT IF EXISTS conversions_suscripcion_estado_valido;
ALTER TABLE conversions ADD CONSTRAINT conversions_suscripcion_estado_valido
  CHECK (suscripcion_estado IS NULL OR suscripcion_estado IN
         ('activa', 'cerrando', 'cancelada', 'ya_cerrada', 'revisar', 'error', 'cancelada_en_stripe'));

CREATE TABLE IF NOT EXISTS stripe_cobros_cancelados (
  id             SERIAL       PRIMARY KEY,
  project_id     INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversion_id  INTEGER      NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,
  -- cobro_automatico: el calendario del CRM (309) · suscripcion: venta a plazos (#747).
  origen         VARCHAR(20)  NOT NULL,
  -- Lo que se canceló en Stripe: sub_sched_…, sub_… o in_….
  referencia     VARCHAR(255) NOT NULL,
  evento_tipo    VARCHAR(60)  NOT NULL,
  stripe_event_id VARCHAR(255),
  motivo         TEXT         NOT NULL,
  -- Lo que dijo Stripe (razón, comentario, petición…), para mirarlo después.
  detalle        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  cancelado_el   TIMESTAMPTZ  NOT NULL,
  -- Las cuotas (conversion_installments) que quedaron marcadas.
  cuotas         INTEGER[]    NOT NULL DEFAULT '{}',
  avisado_el     TIMESTAMPTZ,
  -- Si la suscripción volvió a cobrarse sola (de «impagada» a activa).
  reactivada_el  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT stripe_cobros_cancelados_origen_check CHECK (origen IN ('cobro_automatico', 'suscripcion')),
  CONSTRAINT stripe_cobros_cancelados_una_vez UNIQUE (conversion_id, referencia)
);

CREATE INDEX IF NOT EXISTS idx_stripe_cobros_cancelados_venta
  ON stripe_cobros_cancelados (conversion_id, created_at DESC);

COMMENT ON TABLE stripe_cobros_cancelados IS
  'Cobros de cuotas que Stripe canceló o dio por perdidos (CRM#1103): uno por venta y cosa de Stripe; el aviso sale una vez.';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON stripe_cobros_cancelados TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE stripe_cobros_cancelados_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
