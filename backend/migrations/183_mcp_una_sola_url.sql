-- En MultiCRM es la 193_mcp_una_sola_url.sql (#237, desde la PR #239: una sola URL de Claude por persona).
--
-- Una sola URL de Claude por persona (Diego, 05/10/2026).
--
-- Del 29/09 al 05/10 hubo dos formas de conectar Claude al CRM: la URL
-- personal (todo lo que ve la persona) y las «conexiones» de Conexión → MCP
-- (conectores de tipo 'mcp', migración 184), que recortaban la URL a un campus,
-- una empresa o todo el sistema. Diego: «una sola, no ambas, no tiene sentido
-- así, porque en el MCP el superadmin decide quién tiene acceso y qué no según
-- su rol».
--
-- Las URLs que ya se sacaron de una conexión NO se revocan: pasan a ser
-- personales y siguen funcionando en Claude sin tocar nada. Desde ahora ven lo
-- que permite el rol de su dueño, como todas. Conservan su nombre
-- («Conector: …») para que cada uno la reconozca en su lista.
--
-- Primero se sueltan de la conexión y DESPUÉS se borran las conexiones:
-- mcp_tokens.connector_id es ON DELETE CASCADE, y al revés se borrarían las URLs.
-- La columna se queda (vacía) para no romper nada que la lea.
--
-- Se puede pasar dos veces.

BEGIN;

UPDATE mcp_tokens SET connector_id = NULL WHERE connector_id IS NOT NULL;

DELETE FROM project_connectors WHERE type = 'mcp';

COMMIT;
