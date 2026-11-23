-- 328 · Links de pago: los creados directamente en Stripe y sus cobros (CRM-ISEIE#688, gemela de la 317 de MultiCRM, CRM#1019)
--
-- Diego, 23/11/2026: «sí, crea la tarea para recoger los links de Stripe».
--
-- Hasta hoy, un link de pago hecho a mano en el panel de Stripe (fuera del CRM)
-- no entraba: el webhook descartaba todo checkout sin la marca del CRM, así que
-- su cobro no iba a ninguna venta ni salía en Links de pago.
--
--   · `stripe_links_externos`: los Payment Links de la cuenta de Stripe del
--     campus que NO creó el CRM, con lo que se cobra, la moneda, si está activo y
--     si admite códigos promocionales. Se recogen con la clave de links del campus
--     (cada 30 minutos, con «Traer de Stripe» y con los avisos `payment_link.*`).
--     Un link de Stripe no se borra nunca: se desactiva, y aquí queda `activo`.
--   · `stripe_payments.stripe_link_externo_id`: del cargo al link de Stripe que lo
--     cobró. Lo pone el aviso `checkout.session.completed` de esa sesión.
--   · `stripe_payments.por_vincular_motivo` y `por_vincular_candidatos`: si al
--     cobrarse no se encuentra a quién es (ni por el correo ni por el móvil), o
--     hay varias coincidencias, el cargo queda en la bandeja «Cobros de Stripe
--     por vincular» con el motivo y las ventas que podrían ser. Se vacía al
--     vincularlo (a mano o solo).
--   · `stripe_payments.checkout_externo`: lo que dijo la sesión de Checkout (id,
--     PaymentIntent, teléfono, descuento y código promocional), porque el cargo
--     no lo trae.
--
-- No se crea ningún cobro aquí ni se toca ninguno: el cobro se apunta por el
-- mismo camino que los demás cargos (`addPayment` y la comprobación de
-- duplicados), así que un cargo ya vinculado en Conciliación no se repite.
--
-- Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS stripe_links_externos (
    id                       SERIAL        PRIMARY KEY,
    project_id               INTEGER       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stripe_payment_link_id   VARCHAR(255)  NOT NULL,
    url                      TEXT,
    activo                   BOOLEAN       NOT NULL DEFAULT true,
    -- Lo que se cobra: el nombre del producto de Stripe y su importe. NULL si el
    -- link lleva varios precios distintos o deja al cliente poner el importe.
    nombre                   TEXT,
    importe                  NUMERIC(12,2),
    moneda                   VARCHAR(3),
    codigos_promocionales    BOOLEAN       NOT NULL DEFAULT false,
    metadata                 JSONB         NOT NULL DEFAULT '{}'::jsonb,
    visto_el                 TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    actualizado_el           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_stripe_links_externos UNIQUE (project_id, stripe_payment_link_id),
    CONSTRAINT stripe_links_externos_moneda_iso CHECK (moneda IS NULL OR moneda ~ '^[A-Z]{3}$')
);

CREATE INDEX IF NOT EXISTS idx_stripe_links_externos_campus ON stripe_links_externos (project_id, activo);

COMMENT ON TABLE stripe_links_externos IS
  'Payment Links creados directamente en el panel de Stripe del campus, no en el CRM (CRM-ISEIE#688 / CRM#1019, 328). Solo lectura: el CRM no los cambia.';

ALTER TABLE stripe_payments
  ADD COLUMN IF NOT EXISTS stripe_link_externo_id INTEGER REFERENCES stripe_links_externos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS por_vincular_motivo VARCHAR(30),
  ADD COLUMN IF NOT EXISTS por_vincular_candidatos JSONB,
  ADD COLUMN IF NOT EXISTS checkout_externo JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stripe_payments_por_vincular_motivo_valido') THEN
    ALTER TABLE stripe_payments ADD CONSTRAINT stripe_payments_por_vincular_motivo_valido
      CHECK (por_vincular_motivo IS NULL OR por_vincular_motivo IN
             ('sin_datos', 'sin_coincidencia', 'varias_coincidencias', 'sin_venta', 'sin_pendiente'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sp_link_externo ON stripe_payments (stripe_link_externo_id)
  WHERE stripe_link_externo_id IS NOT NULL;
-- La bandeja: los cobrados de un link de Stripe que aún no tienen cobro en una venta.
CREATE INDEX IF NOT EXISTS idx_sp_por_vincular ON stripe_payments (project_id, stripe_created_at DESC)
  WHERE stripe_link_externo_id IS NOT NULL AND conversion_payment_id IS NULL;

COMMENT ON COLUMN stripe_payments.stripe_link_externo_id IS
  'El link creado en Stripe (no en el CRM) que cobró este cargo (CRM#1019).';
COMMENT ON COLUMN stripe_payments.por_vincular_motivo IS
  'Por qué el cobro de un link de Stripe no se vinculó solo: sin_datos, sin_coincidencia, varias_coincidencias, sin_venta, sin_pendiente (CRM#1019).';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON stripe_links_externos TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE stripe_links_externos_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
