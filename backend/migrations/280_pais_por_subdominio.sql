-- ============================================================
-- 279: el país de entrada de cada prospecto, por el subdominio (#221)
-- ============================================================
-- Manuel: medir prospectos y ventas por país y separar el retargeting de Meta
-- por país. Las webs de Psiko Aprende y Fono Aprende tienen un subdominio por
-- país (cl.fonoaprende.com, mx.fonoaprende.com…): el país sale de la dirección
-- de entrada y de una tabla de cada campus.
--
--   projects.paises_por_subdominio  prefijo de subdominio → código ISO 3166-1
--                                   de dos letras: {"cl": "CL", "mx": "MX"}.
--                                   Vacía = el campus no separa por país. Se
--                                   edita en Configuración del campus (permiso
--                                   projects.edit): añadir un país es solo eso.
--   leads.pais_origen               el código del país por el que entró, o NULL
--                                   (dominio raíz, prefijo sin configurar o sin
--                                   dirección). Lo pone el alta; los que ya
--                                   estaban, scripts/rellenar-pais-origen.mjs.
--
-- Mismo número (279) en los dos CRMs: está libre en los dos.
--
-- Se puede pasar dos veces.

BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS paises_por_subdominio JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_paises_por_subdominio_objeto;
ALTER TABLE projects ADD CONSTRAINT projects_paises_por_subdominio_objeto
  CHECK (jsonb_typeof(paises_por_subdominio) = 'object');

COMMENT ON COLUMN projects.paises_por_subdominio IS
  'Prefijo de subdominio → código ISO de país (#221). {"cl":"CL","mx":"MX"}. Vacío = sin país.';

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS pais_origen VARCHAR(2);

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_pais_origen_iso;
ALTER TABLE leads ADD CONSTRAINT leads_pais_origen_iso
  CHECK (pais_origen IS NULL OR pais_origen ~ '^[A-Z]{2}$');

COMMENT ON COLUMN leads.pais_origen IS
  'País de entrada (#221): código ISO deducido del subdominio de landing_url con projects.paises_por_subdominio.';

-- Los filtros van siempre dentro de un campus o de una empresa.
CREATE INDEX IF NOT EXISTS idx_leads_project_pais_origen
  ON leads (project_id, pais_origen)
  WHERE pais_origen IS NOT NULL;

-- Psiko Aprende y Fono Aprende arrancan con los cuatro países que pidió Manuel.
-- Solo si su tabla está vacía (no pisa lo que alguien ya haya configurado) y
-- por el nombre sin espacios ni mayúsculas, para no tocar ningún otro campus.
-- En un CRM sin esos campus no hace nada.
UPDATE projects
   SET paises_por_subdominio = '{"mx": "MX", "co": "CO", "cl": "CL", "pe": "PE"}'::jsonb,
       updated_at = NOW()
 WHERE regexp_replace(lower(nombre), '[^a-z]', '', 'g') IN ('psikoaprende', 'fonoaprende')
   AND paises_por_subdominio = '{}'::jsonb;

COMMIT;
