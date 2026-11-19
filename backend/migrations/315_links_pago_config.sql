-- 315 · Links de pago: lo que configura el admin en la tarjeta (#407, gemela de CRM#680, donde es la 300; fase 2)
--
-- Diego, 17/11: «todo lo de Stripe se configura desde la web», en Integraciones ›
-- Links de pago, por campus y con el permiso `links_pago.configurar`. La 314 ya
-- dejó el descuento máximo en el campus; esto añade el resto de reglas de venta,
-- también en el campus y no en la integración (cambiar o borrar la clave no las
-- pierde):
--
--   · caducidad: la de por defecto (7 días) y la máxima que puede elegir la
--     gestora al crear el link (30 días);
--   · cuotas: si el campus las admite (sí, mensuales) y cuántas como máximo (12).
--     Crear links en cuotas llega en la fase 4; aquí solo queda la regla;
--   · monedas: las admitidas ({EUR}) y la de por defecto (EUR), que tiene que
--     estar entre las admitidas.
--
-- Valores de arranque: los de la decisión del 17/11 (7 días, cuotas mensuales) y
-- la propuesta de la PR para lo que quedó abierto (30 días de máximo, 12 cuotas,
-- solo euros). Un admin los cambia en la tarjeta.
--
-- `payment_links.stripe_price_id`: el precio de Stripe que se crea para cada link
-- (el importe editado por la gestora). Se guarda para poder rastrearlo.
--
-- Se puede pasar dos veces.

BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS links_pago_caducidad_dias     INTEGER    NOT NULL DEFAULT 7;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS links_pago_caducidad_max_dias INTEGER    NOT NULL DEFAULT 30;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS links_pago_cuotas_admitidas   BOOLEAN    NOT NULL DEFAULT TRUE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS links_pago_cuotas_max         INTEGER    NOT NULL DEFAULT 12;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS links_pago_monedas            VARCHAR(3)[] NOT NULL DEFAULT ARRAY['EUR']::VARCHAR(3)[];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS links_pago_moneda_defecto     VARCHAR(3) NOT NULL DEFAULT 'EUR';

DO $$
BEGIN
  -- De 1 a 365 días; la de por defecto no pasa de la máxima.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_links_pago_caducidad_rango') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_links_pago_caducidad_rango CHECK (
      links_pago_caducidad_max_dias BETWEEN 1 AND 365
      AND links_pago_caducidad_dias BETWEEN 1 AND links_pago_caducidad_max_dias);
  END IF;
  -- Cuotas: de 2 a 36 (Stripe no pone tope; 36 es el nuestro, para que nadie
  -- escriba 360 por error).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_links_pago_cuotas_rango') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_links_pago_cuotas_rango CHECK (
      links_pago_cuotas_max BETWEEN 2 AND 36);
  END IF;
  -- Al menos una moneda, todas con forma ISO (tres mayúsculas), y la de por
  -- defecto, una de ellas.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_links_pago_monedas_validas') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_links_pago_monedas_validas CHECK (
      cardinality(links_pago_monedas) >= 1
      AND array_to_string(links_pago_monedas, ',') ~ '^[A-Z]{3}(,[A-Z]{3})*$'
      AND links_pago_moneda_defecto = ANY(links_pago_monedas));
  END IF;
END $$;

COMMENT ON COLUMN projects.links_pago_caducidad_dias IS
  'Días que dura un link de pago si la gestora no elige otra cosa (CRM#680, 315).';
COMMENT ON COLUMN projects.links_pago_caducidad_max_dias IS
  'Máximo de días que la gestora puede dar a un link de pago (CRM#680, 315).';
COMMENT ON COLUMN projects.links_pago_cuotas_admitidas IS
  'Si el campus admite links de pago en cuotas mensuales (CRM#680, 315; se crean desde la fase 4).';
COMMENT ON COLUMN projects.links_pago_cuotas_max IS
  'Número máximo de cuotas de un link de pago (CRM#680, 315).';
COMMENT ON COLUMN projects.links_pago_monedas IS
  'Monedas en las que se pueden crear links de pago en este campus (CRM#680, 315).';
COMMENT ON COLUMN projects.links_pago_moneda_defecto IS
  'Moneda que sale elegida al crear un link de pago (CRM#680, 315). Una de links_pago_monedas.';

ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255);

COMMIT;
