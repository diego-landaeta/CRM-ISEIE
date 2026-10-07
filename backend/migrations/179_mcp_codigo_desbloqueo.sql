-- En MultiCRM es la 189_mcp_codigo_desbloqueo.sql (#237: la seguridad del MCP, igual en los dos CRM).
--
-- Código de desbloqueo del MCP de Claude (#192, épica #191).
--
-- Diego, 30/09: «un código en el CRM que se genere y tienes que dárselo a
-- Claude en cada nueva conversación». Es un SEGUNDO FACTOR: la URL sola ya no
-- basta para sacar datos.
--
-- Investigado el 03/10 (comentario en la #192): en Claude Desktop y claude.ai
-- el conector comparte UNA sesión MCP entre todos los chats, así que el CRM no
-- puede saber cuándo empieza una conversación. El desbloqueo va atado a la
-- CONEXIÓN (el token), con caducidad por inactividad y un máximo absoluto. Los
-- tiempos van en el .env (MCP_DESBLOQUEO_*), pendientes de que Diego los apruebe.
--
-- Tres piezas:
--
--  1. `mcp_codigos`: el código que la persona pide en Conexión → MCP y le da a
--     Claude. Se guarda SOLO su huella. Vale 10 minutos y una sola vez; pedir
--     otro anula el anterior.
--
--  2. `mcp_desbloqueos`: una fila por conexión desbloqueada, con el último uso
--     (para la inactividad) y el máximo. `sesion` queda por si algún día se
--     ata también a la sesión MCP en los clientes que la renuevan (Claude Code).
--
--  3. En `mcp_tokens`: los fallos seguidos y hasta cuándo está bloqueada la
--     conexión (5 fallos → 15 minutos, y aviso por correo).

BEGIN;

CREATE TABLE IF NOT EXISTS mcp_codigos (
    id            SERIAL        PRIMARY KEY,
    user_id       INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    codigo_hash   CHAR(64)      NOT NULL,
    caduca_at     TIMESTAMPTZ   NOT NULL,
    usado_at      TIMESTAMPTZ,
    -- La conexión que lo usó: para la auditoría y para saber qué se desbloqueó.
    token_id      INTEGER       REFERENCES mcp_tokens(id) ON DELETE SET NULL,
    anulado_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_codigos_user ON mcp_codigos(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mcp_desbloqueos (
    token_id        INTEGER       PRIMARY KEY REFERENCES mcp_tokens(id) ON DELETE CASCADE,
    user_id         INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    codigo_id       INTEGER       REFERENCES mcp_codigos(id) ON DELETE SET NULL,
    sesion          VARCHAR(100),
    desbloqueado_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    ultimo_uso_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    caduca_max_at   TIMESTAMPTZ   NOT NULL
);

ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS fallos_codigo   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS bloqueado_hasta TIMESTAMPTZ;

COMMENT ON COLUMN mcp_tokens.bloqueado_hasta IS 'Bloqueada por fallar el código de desbloqueo (#192): hasta esta hora no se acepta ningún código ni se dan datos.';

-- Permisos para el usuario de la aplicación (la migración la corre postgres).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_codigos, mcp_desbloqueos TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE mcp_codigos_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
