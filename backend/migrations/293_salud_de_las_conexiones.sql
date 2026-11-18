-- 293 · La salud de las conexiones de cada campus (CRM#533)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ ES
--
-- Integraciones › «Salud de las conexiones»: una fila por campus y una casilla
-- por conexión (Stripe, Moodle, WooCommerce, Brevo, Meta, webhooks), en verde,
-- ámbar o rojo, con la última señal de vida y el motivo si falla.
--
-- Casi todo sale de rastros que ya estaban (`stripe_sync_state`,
-- `project_integrations.last_test_*`, `wc_import_runs`, `meta_ad_accounts`,
-- `project_webhook_tokens.last_used_at`, `webhooks_salientes_envios`…). Faltaban
-- dos cosas, y son estas dos tablas:
--
--   1. `conexiones_salud`: lo que contestó cada conexión la última vez que se
--      comprobó con «Comprobar ahora», y CUÁNDO FUE LA ÚLTIMA BUENA. Las
--      columnas `last_test_*` de `project_integrations` solo guardan la última
--      prueba: si falla, se pierde desde cuándo funcionaba. WooCommerce no tenía
--      ni eso.
--
--   2. `webhook_recepciones`: el último aviso que llegó de Stripe a CADA campus
--      (aceptado, rechazado y por qué). Hasta ahora solo estaba en memoria y para
--      todo el CRM a la vez (`status/webhooks.js`): se perdía en cada reinicio y
--      no decía de qué campus era.
--
-- Sin claves ni datos de clientes: fechas, sí/no y el motivo del fallo.
-- Reaplicable.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conexiones_salud (
  project_id     INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 'stripe', 'brevo', 'moodle', 'woocommerce'…
  conexion       VARCHAR(30)  NOT NULL,
  ok             BOOLEAN      NOT NULL,
  mensaje        TEXT,
  comprobado_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- La última vez que contestó bien. No se borra al fallar: es la pregunta.
  ultimo_ok_at   TIMESTAMPTZ,
  PRIMARY KEY (project_id, conexion)
);

COMMENT ON TABLE conexiones_salud IS
  'CRM#533: la última comprobación de cada conexión de cada campus («Comprobar ahora») y la última buena. Sin claves.';

CREATE TABLE IF NOT EXISTS webhook_recepciones (
  -- 'stripe' (de momento el único que entra por campus con firma).
  fuente              VARCHAR(30)  NOT NULL,
  project_id          INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ultimo_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resultado           VARCHAR(12)  NOT NULL,
  -- Solo cuando no se acepta. Nunca el cuerpo del aviso.
  motivo              TEXT,
  ultimo_aceptado_at  TIMESTAMPTZ,
  aceptados           INTEGER      NOT NULL DEFAULT 0,
  rechazados          INTEGER      NOT NULL DEFAULT 0,
  PRIMARY KEY (fuente, project_id),
  CONSTRAINT webhook_recepciones_resultado CHECK (resultado IN ('aceptado', 'rechazado', 'error'))
);

COMMENT ON TABLE webhook_recepciones IS
  'CRM#533: el último aviso de cada webhook entrante por campus (aceptado/rechazado y motivo). Sin datos del evento.';

-- Como en la 206 y la 245: que el CRM pueda leer y escribir aunque la migración la
-- pase postgres (la API entra como crm_user; en la gemela, crm_iseie_user).
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON conexiones_salud, webhook_recepciones TO %I', r);
    END IF;
  END LOOP;
END $$;
