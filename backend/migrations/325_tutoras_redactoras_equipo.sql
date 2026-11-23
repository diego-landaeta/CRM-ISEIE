-- 325 · Tutoras redactoras: su tablero aparte y su área en las fichas (Diego, 23/11/2026; CRM-ISEIE#687)
--
-- «Habilitar su panel de Trello separado, y que el admin pueda filtrar por los
-- dos equipos, sus facturas…». Solo estructura; los equipos y sus miembros se
-- crean con scripts/datos/2311_equipo_tutoras_redactoras.sql, como el de
-- «Tutores» de la 243.
--
--   · task_teams.tipo admite 'redactoras': el tablero de las tutoras
--     redactoras, aparte del de desarrollo ('colaboradores') y del de tutores.
--   · colaboradores.area admite 'redaccion' («Redacción de cursos»): la ficha
--     de una redactora que no tiene usuario sigue contando en su equipo.
--
-- Se puede pasar dos veces.

BEGIN;

ALTER TABLE task_teams DROP CONSTRAINT IF EXISTS task_teams_tipo_check;
ALTER TABLE task_teams ADD CONSTRAINT task_teams_tipo_check
  CHECK (tipo IN ('colaboradores', 'tutores', 'redactoras'));
COMMENT ON COLUMN task_teams.tipo IS
  'colaboradores (desarrollo, SEO…), tutores o redactoras (tutoras redactoras, 23/11/2026): quién puede estar en el equipo.';

ALTER TABLE colaboradores DROP CONSTRAINT IF EXISTS colaboradores_area_check;
ALTER TABLE colaboradores ADD CONSTRAINT colaboradores_area_check
  CHECK (area IN ('soporte', 'desarrollo', 'wordpress', 'seo', 'contenido', 'redaccion', 'otra'));

-- Las mismas tablas de siempre: sin tablas nuevas, solo se asegura el acceso.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON task_teams, task_team_roles, task_team_members, colaboradores TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
