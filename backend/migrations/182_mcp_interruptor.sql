-- En MultiCRM es la 192_mcp_interruptor.sql (#237: la seguridad del MCP, igual en los dos CRM).
--
-- Interruptor de emergencia del MCP de Claude (#196, épica #191).
--
-- Diego: «MCP_DISABLED=1 en .env, y un botón de super admin en el panel que
-- corta todo el MCP al momento (todas las URLs dejan de responder) y lo vuelve
-- a encender».
--
-- El .env necesita reiniciar el servidor; el botón no. Por eso el estado del
-- botón vive en la base: vale para todos los procesos a la vez y sobrevive a un
-- reinicio (si alguien lo apaga y el servidor se reinicia, sigue apagado).
-- El .env manda: con MCP_DISABLED=1 el botón no puede encenderlo.

BEGIN;

CREATE TABLE IF NOT EXISTS mcp_interruptor (
    id            INTEGER      PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    apagado       BOOLEAN      NOT NULL DEFAULT FALSE,
    cambiado_por  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    cambiado_at   TIMESTAMPTZ,
    motivo        TEXT
);
INSERT INTO mcp_interruptor (id, apagado) VALUES (1, FALSE) ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON mcp_interruptor TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
