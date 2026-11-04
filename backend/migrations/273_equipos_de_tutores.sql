-- 273 · Equipos de tutores en el tablero (Diego, 04/11/2026)
--
-- «Un tablero de tutores separado del de colaboradores»: quien lleva las
-- colaboraciones de los profesores ve sus dos tableros por separado, y los
-- tutores tienen el suyo, sin ver el de desarrollo.
--
--   · task_teams.tipo: 'colaboradores' (los de siempre: desarrollo, SEO…) o
--     'tutores'. A un equipo de tutores se puede meter a tutores; a uno de
--     colaboradores, como hasta hoy, solo a gente con tablero.
--
-- Se puede pasar dos veces. El equipo «Tutores» de cada empresa se crea con el
-- guion del despliegue, no aquí.

BEGIN;

ALTER TABLE task_teams ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'colaboradores';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_teams_tipo_check') THEN
    ALTER TABLE task_teams ADD CONSTRAINT task_teams_tipo_check CHECK (tipo IN ('colaboradores', 'tutores'));
  END IF;
END $$;

COMMENT ON COLUMN task_teams.tipo IS 'colaboradores (desarrollo, SEO…) o tutores: a un equipo de tutores se puede meter a tutores (04/11/2026).';

COMMIT;
