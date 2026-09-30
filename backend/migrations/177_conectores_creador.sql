-- Portada de MultiCRM (185_conectores_creador.sql), 30/09/2026: la sección Conexión en ISEIE.
-- Quién creó cada conector, y cada conexión de Claude.
--
-- Diego, 29/09, al pasar las conexiones de Claude a Conexión → MCP: «que
-- puedas ver quién gestiona o quién creó un MCP y en dónde». El «en dónde» ya
-- estaba (alcance: campus, empresa o todo el sistema, migración 183); el
-- «quién» no se guardaba.
--
-- Las conexiones de Claude que ya existían se atribuyen a quien sacó la PRIMERA
-- URL: al crear una, el CRM le da la URL en el acto a quien la crea, así que esa
-- persona es quien la creó. Los conectores de datos anteriores se quedan sin
-- creador: no hay de dónde sacarlo, y la pantalla dice «—».

BEGIN;

ALTER TABLE project_connectors ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE project_connectors c
   SET created_by = t.user_id
  FROM (SELECT DISTINCT ON (connector_id) connector_id, user_id
          FROM mcp_tokens
         WHERE connector_id IS NOT NULL
         ORDER BY connector_id, created_at) t
 WHERE t.connector_id = c.id
   AND c.created_by IS NULL;

COMMIT;
