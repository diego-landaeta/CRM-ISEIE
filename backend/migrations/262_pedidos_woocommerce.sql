-- CRM-ISEIE 262 = MultiCRM 218 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- #14 · Los pedidos de WooCommerce llegan al CRM.
--
-- Hasta ahora el módulo de WooCommerce traía productos y nada más: el conector
-- solo enseñaba una muestra de pedidos y no se guardaba ninguno. Esta migración
-- añade dónde guardarlos y dos interruptores por tienda:
--
--   woocommerce_orders            un pedido por (proyecto, id de WooCommerce)
--   wc_credentials.sync_orders    ¿se sincronizan los pedidos de esta tienda? (apagado)
--   wc_credentials.orders_last_sync_at   hasta dónde se sincronizó: la próxima vuelta
--                                        pide solo lo modificado desde entonces
--   wc_credentials.webhook_secret el secreto con el que WooCommerce firma sus avisos
--
-- Un pedido NO crea una venta por sí solo (el dinero del CRM sale de
-- `conversion_payments`, y un pedido y un cobro de Stripe podrían ser lo mismo):
-- se guarda y, si su correo es el de un prospecto del campus, se enlaza a él.
--
-- Sin riesgo: una tabla nueva y tres columnas nuevas, apagadas. Reaplicable. Para deshacerlo:
--   DROP TABLE woocommerce_orders;
--   ALTER TABLE wc_credentials DROP COLUMN sync_orders, DROP COLUMN orders_last_sync_at, DROP COLUMN webhook_secret;
BEGIN;

CREATE TABLE IF NOT EXISTS woocommerce_orders (
    id              SERIAL         PRIMARY KEY,
    project_id      INTEGER        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    wc_order_id     BIGINT         NOT NULL,
    numero          VARCHAR(50),
    status          VARCHAR(50),
    total           NUMERIC(12,2),
    currency        VARCHAR(10),
    customer_email  VARCHAR(255),
    customer_name   VARCHAR(200),
    line_items      JSONB          NOT NULL DEFAULT '[]'::jsonb,
    lead_id         INTEGER        REFERENCES leads(id) ON DELETE SET NULL,
    wc_created_at   TIMESTAMPTZ,
    wc_modified_at  TIMESTAMPTZ,
    synced_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, wc_order_id)
);
CREATE INDEX IF NOT EXISTS idx_wco_project_fecha ON woocommerce_orders (project_id, wc_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wco_email ON woocommerce_orders (project_id, lower(customer_email));
CREATE INDEX IF NOT EXISTS idx_wco_lead ON woocommerce_orders (lead_id) WHERE lead_id IS NOT NULL;

ALTER TABLE wc_credentials ADD COLUMN IF NOT EXISTS sync_orders BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE wc_credentials ADD COLUMN IF NOT EXISTS orders_last_sync_at TIMESTAMPTZ;
ALTER TABLE wc_credentials ADD COLUMN IF NOT EXISTS webhook_secret VARCHAR(100);

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON woocommerce_orders TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE woocommerce_orders_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
