-- 320 · Cobro automático de las cuotas con Stripe (#680; Diego, 19/11/2026)
--
-- «Que cada cuota se cobre en la fecha que ellas digan.» La fecha la pacta la
-- gestora con cada alumno en el plan de cuotas de la venta; el «25 de cada mes»
-- era solo un ejemplo. Y lo cobra STRIPE, no un cron del CRM:
--
--   · el alumno paga la primera cuota (o la inicial) con su link, que guarda su
--     tarjeta en un cliente de Stripe con su consentimiento;
--   · el CRM programa en Stripe un Subscription Schedule con una fase por cuota
--     pendiente: cada fase empieza en la fecha de su cuota y cobra su importe;
--   · cada cobro entra por el camino de siempre y salda SU cuota;
--   · si la gestora cambia la fecha o el importe de una cuota, el CRM rehace las
--     fases en Stripe.
--
-- Tablas:
--   · `conversion_cobro_auto`: una fila por venta. Si está activo, la tarjeta
--     guardada (cliente y método de pago de Stripe, marca, cuatro últimas cifras
--     y caducidad; nunca el número), el schedule de Stripe y cómo quedó la última
--     vez que se pasó el plan a Stripe.
--   · `cobro_auto_cuotas`: cada cuota programada en Stripe: su precio, la fecha y
--     el importe que tiene Stripe, la factura con la que se cobró y lo que ha
--     pasado (intentos, fallos, reintento).
--   · `payment_links.guarda_tarjeta`: el link que, al pagarse, guarda la tarjeta.
--   · En el campus (Integraciones › Links de pago): si el cobro automático está
--     permitido (apagado de serie) y a los cuántos días se reintenta una cuota que
--     falló (3 de serie; 0 = no se reintenta). Un reintento como mucho.
--
-- Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS conversion_cobro_auto (
    conversion_id             INTEGER      PRIMARY KEY REFERENCES conversions(id) ON DELETE CASCADE,
    project_id                INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    activo                    BOOLEAN      NOT NULL DEFAULT FALSE,
    -- La tarjeta que guardó el alumno al pagar su link. Sin ella no se programa nada.
    stripe_customer_id        VARCHAR(255),
    stripe_payment_method_id  VARCHAR(255),
    tarjeta_marca             VARCHAR(30),
    tarjeta_ultimos4          VARCHAR(4),
    tarjeta_caduca_mes        SMALLINT,
    tarjeta_caduca_anio       SMALLINT,
    tarjeta_guardada_el       TIMESTAMPTZ,
    -- El link con el que la guardó (y aceptó los cobros siguientes).
    tarjeta_link_id           INTEGER      REFERENCES payment_links(id) ON DELETE SET NULL,
    -- El calendario de cobros en Stripe.
    stripe_schedule_id        VARCHAR(255),
    -- Lo último que se pasó a Stripe (cuota, fecha, importe): si no cambia, no se llama.
    fases_firma               TEXT,
    sincronizado_el           TIMESTAMPTZ,
    -- Si la última vez Stripe no aceptó el plan, por qué. La pantalla lo enseña.
    sync_error                TEXT,
    activado_por              INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    activado_el               TIMESTAMPTZ,
    desactivado_por           INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    desactivado_el            TIMESTAMPTZ,
    created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT conversion_cobro_auto_ultimos4 CHECK (tarjeta_ultimos4 IS NULL OR tarjeta_ultimos4 ~ '^[0-9]{4}$'),
    CONSTRAINT conversion_cobro_auto_activado CHECK (NOT activo OR activado_el IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_conversion_cobro_auto_cliente
    ON conversion_cobro_auto (project_id, stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversion_cobro_auto_schedule
    ON conversion_cobro_auto (stripe_schedule_id) WHERE stripe_schedule_id IS NOT NULL;

COMMENT ON TABLE conversion_cobro_auto IS
  'Cobro automático de las cuotas de una venta (#680, 309): tarjeta guardada (sin el número) y el Subscription Schedule de Stripe que las cobra.';

CREATE TABLE IF NOT EXISTS cobro_auto_cuotas (
    installment_id            INTEGER       PRIMARY KEY REFERENCES conversion_installments(id) ON DELETE CASCADE,
    conversion_id             INTEGER       NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,
    project_id                INTEGER       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- programada: está en Stripe con su fecha. cobrada: Stripe la cobró.
    -- fallida: el cobro falló (y quizá hay un reintento). quitada: ya no está en
    -- Stripe (se pagó por otro lado, se borró, se desactivó el cobro automático).
    estado                    VARCHAR(20)   NOT NULL DEFAULT 'programada',
    -- Lo que tiene Stripe: el precio de la fase, su fecha y su importe.
    stripe_price_id           VARCHAR(255),
    fecha_programada          DATE,
    importe_programado        NUMERIC(10,2),
    -- La factura de Stripe con la que se cobra (y su página de pago, el respaldo).
    stripe_invoice_id         VARCHAR(255),
    url_pago                  TEXT,
    intentos                  SMALLINT      NOT NULL DEFAULT 0,
    error_codigo              VARCHAR(80),
    error_mensaje             TEXT,
    -- El único reintento: cuándo toca. NULL = no hay.
    reintento_el              DATE,
    reintentado_el            TIMESTAMPTZ,
    avisado_el                TIMESTAMPTZ,
    -- Lo que ha pasado, en orden: [{ el, que, ... }].
    historial                 JSONB         NOT NULL DEFAULT '[]'::jsonb,
    created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT cobro_auto_cuotas_estado CHECK (estado IN ('programada', 'cobrada', 'fallida', 'quitada'))
);

CREATE INDEX IF NOT EXISTS idx_cobro_auto_cuotas_venta ON cobro_auto_cuotas (conversion_id);
CREATE INDEX IF NOT EXISTS idx_cobro_auto_cuotas_precio
    ON cobro_auto_cuotas (stripe_price_id) WHERE stripe_price_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cobro_auto_cuotas_reintento
    ON cobro_auto_cuotas (reintento_el) WHERE estado = 'fallida' AND reintento_el IS NOT NULL AND reintentado_el IS NULL;

COMMENT ON TABLE cobro_auto_cuotas IS
  'Cada cuota programada en Stripe para cobrarse sola (#680, 309): precio, fecha e importe en Stripe, su factura y lo que ha pasado.';

ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS guarda_tarjeta BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN payment_links.guarda_tarjeta IS
  'El link guarda la tarjeta del alumno para que Stripe cobre solas las cuotas siguientes (setup_future_usage=off_session; #680, 309).';

ALTER TABLE projects ADD COLUMN IF NOT EXISTS links_pago_cobro_auto                BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS links_pago_cobro_auto_reintento_dias INTEGER NOT NULL DEFAULT 3;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_links_pago_cobro_auto_reintento') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_links_pago_cobro_auto_reintento
      CHECK (links_pago_cobro_auto_reintento_dias BETWEEN 0 AND 15);
  END IF;
END $$;
COMMENT ON COLUMN projects.links_pago_cobro_auto IS
  'Si en este campus Stripe puede cobrar solas las cuotas con la tarjeta guardada (#680, 309). Apagado de serie.';
COMMENT ON COLUMN projects.links_pago_cobro_auto_reintento_dias IS
  'A los cuántos días se reintenta (una vez) una cuota cuyo cobro automático falló (#680, 309). 0 = no se reintenta.';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON conversion_cobro_auto, cobro_auto_cuotas TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
