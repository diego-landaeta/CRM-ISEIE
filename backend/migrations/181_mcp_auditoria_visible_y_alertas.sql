-- En MultiCRM es la 191_mcp_auditoria_visible_y_alertas.sql (#237: la seguridad del MCP, igual en los dos CRM).
--
-- MCP de Claude: auditoría visible y alertas (#195, épica #191).
--
-- `mcp_auditoria` guarda cada consulta desde la 182, pero nadie podía verla.
-- Diego, en la #195:
--   · Conexión → MCP → Actividad, para super admin y admin;
--   · alertas por correo: ráfagas, IP o cliente nuevos, fallos de desbloqueo y
--     consultas de madrugada (umbrales en el .env);
--   · cuánto se guarda la auditoría (12 meses), con limpieza.
--
-- Tres piezas:
--
--  1. En `mcp_auditoria`: la IP y el cliente de cada consulta. Sin ellos no se
--     puede saber si una IP o un cliente son NUEVOS para esa persona.
--
--  2. `mcp_alertas`: cada alerta enviada. Sirve para no repetir la misma (una
--     ráfaga no avisa cada 5 minutos mientras dura) y queda como historial.
--
--  3. `mcp_vigilancia`: hasta qué fila de la auditoría se ha revisado ya. Así
--     cada consulta se mira una vez, aunque el servidor se reinicie.

BEGIN;

ALTER TABLE mcp_auditoria ADD COLUMN IF NOT EXISTS ip      VARCHAR(64);
ALTER TABLE mcp_auditoria ADD COLUMN IF NOT EXISTS cliente VARCHAR(200);

-- La pantalla de Actividad ordena y filtra por fecha; la limpieza borra por fecha.
CREATE INDEX IF NOT EXISTS idx_mcp_auditoria_fecha ON mcp_auditoria(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_auditoria_token_fecha ON mcp_auditoria(token_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mcp_alertas (
    id          BIGSERIAL     PRIMARY KEY,
    -- 'rafaga', 'ip_nueva', 'cliente_nuevo', 'fallos_desbloqueo', 'madrugada'
    tipo        VARCHAR(30)   NOT NULL,
    user_id     INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    detalle     JSONB,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_alertas_tipo_user ON mcp_alertas(tipo, user_id, created_at DESC);

-- Una sola fila. Empieza en la última consulta que ya había: lo anterior al
-- despliegue no dispara alertas de golpe.
CREATE TABLE IF NOT EXISTS mcp_vigilancia (
    id                    INTEGER      PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    ultimo_auditoria_id   BIGINT       NOT NULL DEFAULT 0,
    actualizado_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
INSERT INTO mcp_vigilancia (id, ultimo_auditoria_id)
SELECT 1, COALESCE(MAX(id), 0) FROM mcp_auditoria
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_alertas, mcp_vigilancia TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE mcp_alertas_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
