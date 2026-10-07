-- En MultiCRM es la 190_mcp_caducidad_y_rotacion.sql (#237: la seguridad del MCP, igual en los dos CRM).
--
-- MCP de Claude: caducidad, rotación y URLs sin usar (#194, épica #191).
--
-- Hasta ahora las URLs no caducaban y, al quitarle el acceso a alguien, sus
-- URLs solo se pausaban. Diego, en la #194:
--   · caducidad configurable (se propone 90 días);
--   · correo al dueño 7 días antes de que caduque;
--   · revocar solas las URLs que lleven N días sin usarse (se proponen 30);
--   · guardar desde dónde se usó por última vez (IP y cliente);
--   · al DESACTIVAR a una persona, revocar sus URLs.
--
-- Los días van en el .env (MCP_TOKEN_DIAS, MCP_TOKEN_AVISO_DIAS,
-- MCP_TOKEN_SIN_USO_DIAS). Aquí solo las columnas.
--
-- Quitar la CASILLA de acceso sigue pausando (decidido el 28/09): eso no cambia.
-- Lo que revoca es desactivar a la persona en Usuarios.

BEGIN;

-- Desde dónde se usó por última vez. Con «Agregar conector personalizado» la
-- IP es la de los servidores de Anthropic, no la de la persona; aun así sirve
-- para ver un cambio raro (otro cliente, otro país).
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS last_used_ip      VARCHAR(64);
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS last_used_cliente VARCHAR(200);

-- Por qué se revocó: 'manual', 'sin_uso', 'usuario_desactivado', 'conector'.
-- Para que el panel diga algo más útil que «Revocada».
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS revocado_motivo   VARCHAR(30);

-- Cuándo se avisó de que iba a caducar: un solo correo por URL.
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS aviso_caducidad_at TIMESTAMPTZ;

-- Desde cuándo cuentan los «N días sin usarse». Las URLs que ya existen
-- empiezan a contar HOY: si no, la primera vuelta tras desplegar revocaría sin
-- aviso todas las que llevan un mes sin usarse, justo lo que este despliegue
-- quiere evitar. Las nuevas empiezan al crearse.
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS rotacion_desde TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Las URLs que ya existen no caducaban. Se les da el plazo entero desde HOY y
-- no desde que se crearon: si no, las de finales de septiembre caducarían a
-- finales de diciembre sin aviso suficiente, y alguna ya vieja moriría al
-- desplegar. 90 días = lo que propone la #194; si MCP_TOKEN_DIAS es otro, las
-- nuevas usarán ese y estas se quedan con 90.
UPDATE mcp_tokens
   SET expires_at = NOW() + INTERVAL '90 days'
 WHERE expires_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_vivos_caducidad
    ON mcp_tokens(expires_at) WHERE revoked_at IS NULL;

COMMIT;
