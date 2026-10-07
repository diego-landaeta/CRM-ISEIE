-- Portada de MultiCRM (183_conectores_alcance.sql), 30/09/2026: la sección Conexión en ISEIE.
-- Conectores de un campus, de una EMPRESA o de TODO el sistema.
--
-- Diego, 29/09: «también poder elegir empresas y, si soy super admin, poder
-- elegir todo el sistema». Y sobre qué pasa con la empresa: «son todos en una
-- sola, tiene que ser único» — UN conector para todos sus campus, no una copia
-- por campus.
--
--   alcance = 'campus'   el de siempre: de `project_id`.
--   alcance = 'empresa'  de la sociedad `issuer_id` y todos sus campus.
--   alcance = 'sistema'  de todos (solo lo crea un super admin).
--
-- `project_id` sigue siendo obligatorio: en un conector de empresa o de sistema
-- es el CAMPUS POR DEFECTO, adonde va lo importado que no dice de qué campus es.
-- Lo que sí lo dice (el campo «Campus» al mapear) va al suyo, siempre dentro
-- del alcance del conector.
--
-- El tipo `mcp` («Servidor MCP»: la URL para Claude, ver la 184) no necesita
-- nada aquí: `type` es texto libre, sin CHECK ni ENUM (comprobado en el catálogo).

BEGIN;

ALTER TABLE project_connectors ADD COLUMN IF NOT EXISTS alcance VARCHAR(10) NOT NULL DEFAULT 'campus';
ALTER TABLE project_connectors ADD COLUMN IF NOT EXISTS issuer_id INTEGER REFERENCES invoice_issuers(id) ON DELETE CASCADE;

ALTER TABLE project_connectors DROP CONSTRAINT IF EXISTS project_connectors_alcance_ok;
ALTER TABLE project_connectors ADD CONSTRAINT project_connectors_alcance_ok CHECK (
     (alcance = 'campus'  AND issuer_id IS NULL)
  OR (alcance = 'empresa' AND issuer_id IS NOT NULL)
  OR (alcance = 'sistema' AND issuer_id IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_connectors_issuer ON project_connectors(issuer_id) WHERE issuer_id IS NOT NULL;

COMMIT;
