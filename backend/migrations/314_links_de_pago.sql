-- 314 · Links de pago: las tablas (#407, gemela de CRM#680, donde es la 250; fase 1)
--
-- Carlos (05/11): «que cualquier comercial o gestora cree un link de pago desde
-- el CRM, sin pedírselo a nadie ni entrar en Stripe». La propuesta publicada en
-- la CRM#680 lo parte en fases; esta es la primera y SOLO prepara el terreno:
--
--   · `payment_links`: cada link que crea una persona del CRM, con su campus, su
--     prospecto o venta, el curso, el precio del catálogo y lo que se cobra, si es
--     pago único o en cuotas, su estado y los ids de Stripe.
--   · `payment_link_eventos`: el historial de cada link (abierto, pagado, intento
--     fallido, caducado, anulado…). `stripe_event_id` es único: un aviso de Stripe
--     que llegue dos veces se apunta una sola.
--   · `stripe_payments.payment_link_id`: del cargo al link que lo generó.
--   · `projects.links_pago_descuento_max_pct`: el descuento máximo sobre el
--     precio del catálogo que admite el campus. 0 de serie: nadie descuenta salvo
--     el admin. Va en el campus y no en la integración de Stripe porque es una
--     regla de venta, no una credencial: cambiar o borrar la clave no la pierde.
--
-- Todavía no se crea ningún link: eso es la fase 2, y depende de que Diego elija
-- Payment Link o Checkout Session. Por eso los ids de Stripe de los dos caminos
-- caben aquí.
--
-- Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS payment_links (
    id                       SERIAL        PRIMARY KEY,
    project_id               INTEGER       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    lead_id                  INTEGER       REFERENCES leads(id) ON DELETE SET NULL,
    conversion_id            INTEGER       REFERENCES conversions(id) ON DELETE SET NULL,
    product_id               INTEGER       REFERENCES products(id) ON DELETE SET NULL,
    -- Quién lo creó: al pagarse, la venta va a su nombre (fase 3).
    created_by               INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    -- Lo que decía el catálogo al crearlo y lo que se cobra de verdad.
    precio_catalogo          NUMERIC(10,2),
    importe                  NUMERIC(10,2) NOT NULL,
    descuento_pct            NUMERIC(5,2)  NOT NULL DEFAULT 0,
    moneda                   VARCHAR(3)    NOT NULL DEFAULT 'EUR',
    -- Pago único o en cuotas. Con cuotas, cuántas y de cuánto cada una.
    modalidad                VARCHAR(10)   NOT NULL DEFAULT 'unico',
    num_cuotas               INTEGER,
    importe_cuota            NUMERIC(10,2),
    estado                   VARCHAR(20)   NOT NULL DEFAULT 'creado',
    url                      TEXT,
    -- Los ids de Stripe. Según el camino que se elija se rellenan unos u otros.
    stripe_payment_link_id   VARCHAR(255),
    stripe_checkout_session_id VARCHAR(255),
    stripe_payment_intent_id VARCHAR(255),
    stripe_customer_id       VARCHAR(255),
    stripe_subscription_id   VARCHAR(255),
    stripe_schedule_id       VARCHAR(255),
    caduca_el                TIMESTAMPTZ,
    pagado_el                TIMESTAMPTZ,
    anulado_por              INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    anulado_el               TIMESTAMPTZ,
    motivo_anulacion         TEXT,
    created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT payment_links_estado_valido CHECK (
      estado IN ('creado', 'abierto', 'pagado', 'pagado_parcial', 'caducado', 'anulado')),
    CONSTRAINT payment_links_modalidad_valida CHECK (modalidad IN ('unico', 'cuotas')),
    -- Con cuotas, al menos dos y su importe; sin cuotas, ninguno de los dos.
    -- Los IS NOT NULL hacen falta: un CHECK con un NULL dentro da «desconocido»
    -- y Postgres lo deja pasar (comprobado en la prueba).
    CONSTRAINT payment_links_cuotas_coherentes CHECK (
      (modalidad = 'unico'  AND num_cuotas IS NULL AND importe_cuota IS NULL)
      OR (modalidad = 'cuotas' AND num_cuotas IS NOT NULL AND importe_cuota IS NOT NULL
          AND num_cuotas >= 2 AND importe_cuota > 0)),
    CONSTRAINT payment_links_importe_positivo CHECK (importe > 0),
    CONSTRAINT payment_links_descuento_rango CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
    CONSTRAINT payment_links_moneda_iso CHECK (moneda ~ '^[A-Z]{3}$'),
    -- Un link anulado lleva cuándo y por qué. Quién no se exige aquí: si se da
    -- de baja a esa persona, `anulado_por` queda vacío y el link no puede romperse.
    CONSTRAINT payment_links_anulacion_completa CHECK (
      (estado <> 'anulado') OR (anulado_el IS NOT NULL AND motivo_anulacion IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_payment_links_campus_estado ON payment_links (project_id, estado);
CREATE INDEX IF NOT EXISTS idx_payment_links_lead          ON payment_links (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_links_venta         ON payment_links (conversion_id) WHERE conversion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_links_creador       ON payment_links (created_by, created_at DESC);
-- El aviso de Stripe trae el id del link o de la sesión: se busca por ahí (fase 3).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_links_stripe_link
    ON payment_links (stripe_payment_link_id) WHERE stripe_payment_link_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_links_stripe_session
    ON payment_links (stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
-- El cron de caducidad mira solo los vivos.
CREATE INDEX IF NOT EXISTS idx_payment_links_por_caducar
    ON payment_links (caduca_el) WHERE estado IN ('creado', 'abierto');

COMMENT ON TABLE payment_links IS
  'Links de pago creados desde el CRM (CRM#680, 314). La venta y el cobro se atan por crm_link_id en la metadata, no por el correo.';

CREATE TABLE IF NOT EXISTS payment_link_eventos (
    id               SERIAL       PRIMARY KEY,
    link_id          INTEGER      NOT NULL REFERENCES payment_links(id) ON DELETE CASCADE,
    tipo             VARCHAR(60)  NOT NULL,
    ocurrido_el      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- NULL para lo que hace el propio CRM (crear, anular, caducar por el cron).
    stripe_event_id  VARCHAR(255),
    datos            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payment_link_eventos_stripe UNIQUE (stripe_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_link_eventos_link ON payment_link_eventos (link_id, ocurrido_el);

COMMENT ON TABLE payment_link_eventos IS
  'Historial de cada link de pago (CRM#680, 314). stripe_event_id único: un aviso repetido se apunta una vez.';

ALTER TABLE stripe_payments
  ADD COLUMN IF NOT EXISTS payment_link_id INTEGER REFERENCES payment_links(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sp_payment_link ON stripe_payments (payment_link_id) WHERE payment_link_id IS NOT NULL;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS links_pago_descuento_max_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_links_pago_descuento_rango') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_links_pago_descuento_rango
      CHECK (links_pago_descuento_max_pct >= 0 AND links_pago_descuento_max_pct <= 100);
  END IF;
END $$;

COMMENT ON COLUMN projects.links_pago_descuento_max_pct IS
  'Descuento máximo (%) sobre el precio del catálogo al crear un link de pago (CRM#680). 0: solo el admin descuenta.';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON payment_links, payment_link_eventos TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE payment_links_id_seq, payment_link_eventos_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
