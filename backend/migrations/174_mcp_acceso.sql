-- Portada de MultiCRM (182_mcp_acceso.sql), 30/09/2026: la sección Conexión en ISEIE.
-- Conexion de Claude al CRM por MCP (Model Context Protocol).
--
-- Diego, 28/09: «Vas a hacer una conexion por Claude MCP a CRM. Que hara Claude
-- con ese MCP: poder ver, hacer consultas de prospecto, ventas, facturas, etc.,
-- mas que todo consulta». Y los limites: «si yo estoy en X empresa solo ver los
-- datos de ahi; si solo soy de un campus, solo de ese campus. No puedo ver ni
-- consultar datos de otros campus». Acceso: super admin, admin y las personas
-- a las que se les ponga.
--
-- Tres piezas:
--
--  1. `users.usa_mcp`: la casilla para dar el acceso a quien no es admin. Igual
--     que `usa_whatsapp` o `factura_manager`: POR DEFECTO APAGADO. Super admin y
--     admin no la necesitan, entran por el rol.
--
--  2. `mcp_tokens`: el token personal que cada persona pega en su Claude. Se
--     guarda SOLO su huella (SHA-256), nunca el token: quien lea la base no
--     puede conectarse como nadie. NO CADUCA (decidido con Diana el 28/09: la
--     URL que se pega en Claude tiene que seguir funcionando sin rehacerla); deja
--     de valer si se revoca, si se quita el acceso o si se desactiva el usuario.
--     `expires_at` queda por si algun dia se quiere poner fecha.
--
--  3. `mcp_auditoria`: una fila por consulta. Claude pregunta en nombre de una
--     persona; si un dato sale de donde no debia, esto dice quien, que y cuando.
--
-- Numero 182: en staging el 180 y el 181 ya estaban cogidos (cabecera de marca y
-- novedades). Diana la subio como 180; del 171 al 175 ya estaban en otras ramas
-- (staging, certifex, angel) y dos migraciones con el mismo numero se aplican en
-- un orden que depende del nombre del fichero.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS usa_mcp BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.usa_mcp IS 'Puede conectar Claude al CRM por MCP (solo consulta). Super admin y admin entran por el rol; esta casilla es para dar el acceso a alguien mas.';

CREATE TABLE IF NOT EXISTS mcp_tokens (
    id            SERIAL        PRIMARY KEY,
    user_id       INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nombre        VARCHAR(100)  NOT NULL,
    token_hash    CHAR(64)      NOT NULL UNIQUE,
    -- Los primeros caracteres, para reconocerlo en la lista sin enseñarlo.
    prefijo       VARCHAR(16)   NOT NULL,
    expires_at    TIMESTAMPTZ,              -- NULL = no caduca
    last_used_at  TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens(user_id);

CREATE TABLE IF NOT EXISTS mcp_auditoria (
    id            BIGSERIAL     PRIMARY KEY,
    user_id       INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    token_id      INTEGER       REFERENCES mcp_tokens(id) ON DELETE SET NULL,
    herramienta   VARCHAR(60)   NOT NULL,
    parametros    JSONB,
    ok            BOOLEAN       NOT NULL,
    error         TEXT,
    duracion_ms   INTEGER,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_auditoria_user_fecha ON mcp_auditoria(user_id, created_at DESC);

-- Permisos para el usuario de la aplicacion: la migracion la corre postgres y,
-- sin esto, la API no podria leer ni escribir las tablas nuevas.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_tokens, mcp_auditoria TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE mcp_tokens_id_seq, mcp_auditoria_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
