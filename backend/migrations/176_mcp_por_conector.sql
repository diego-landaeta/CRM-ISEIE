-- Portada de MultiCRM (184_mcp_por_conector.sql), 30/09/2026: la sección Conexión en ISEIE.
-- Un token del MCP de Claude puede nacer de un CONECTOR.
--
-- Diego, 29/09: «el servidor MCP es para que dé la API y yo meterla en Claude y
-- hacer mis consultas allí, como hizo Diana». En Conectores, «Servidor MCP»
-- no trae datos a ninguna parte: saca una URL para Claude, acotada al «Para
-- quién» del conector (un campus, una empresa o todo el sistema).
--
-- El token es el mismo de siempre (migración 182, `mcp_tokens`): personal, solo
-- se guarda su huella. Con `connector_id`, lo que ve Claude es lo de la persona
-- DENTRO del alcance del conector — nunca más de lo que ya ve la persona. Se
-- comprueba en cada consulta: cambiar el «Para quién» o apagar el conector
-- tiene efecto en la siguiente pregunta. Borrar el conector borra sus tokens.

BEGIN;

ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS connector_id INTEGER REFERENCES project_connectors(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_conector ON mcp_tokens(connector_id) WHERE connector_id IS NOT NULL;

COMMIT;
