-- 245 · Las pulsaciones del botón de WhatsApp de las webs (29/10/2026)
--
-- Diego, 29/10: «WhatsApp es que toquen el widget, y tocan y ellas cargan». La
-- persona pulsa el botón de la web, se abre el WhatsApp de una gestora y la
-- gestora da de alta el lead a mano. Hasta ahora no quedaba rastro de la
-- pulsación, así que no había forma de saber cuántos pulsan ni cuántos pasan a
-- la conversación («yo haría la 1, así medimos cuáles pulsan y cuántos pasan a
-- la conversación»).
--
-- Una fila por pulsación: a qué gestora mandó el botón, desde qué página y
-- cuándo. Nada de la persona: el botón no sabe quién es.
--
-- Cuando la gestora da de alta un lead con origen WhatsApp, se le cruza su
-- última pulsación sin cruzar de las 24 h anteriores (`lead_id`, `cruzado_at`).
--
-- Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS widget_pulsaciones (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pagina      TEXT,
  idioma      VARCHAR(5),
  creado_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lead_id     INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  cruzado_at  TIMESTAMPTZ
);

-- El cruce: la última sin cruzar de una gestora en un campus.
CREATE INDEX IF NOT EXISTS idx_widget_pulsaciones_gestora
    ON widget_pulsaciones (project_id, user_id, creado_at DESC);
-- Las cifras de la pantalla, por periodo.
CREATE INDEX IF NOT EXISTS idx_widget_pulsaciones_creado
    ON widget_pulsaciones (creado_at);
CREATE INDEX IF NOT EXISTS idx_widget_pulsaciones_lead
    ON widget_pulsaciones (lead_id) WHERE lead_id IS NOT NULL;

COMMENT ON TABLE widget_pulsaciones IS
  'Cada pulsacion del boton de WhatsApp de las webs (245): a que gestora mando, desde que pagina y cuando; y el lead que dio de alta esa gestora despues, si se cruzo.';

-- Como en la 243: que el CRM pueda escribir aunque la migración la pase postgres.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON widget_pulsaciones TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE widget_pulsaciones_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
