-- 235 · Equipos del tablero, con cargos por nivel (Diego, 26/10/2026)
--
-- «Necesito que también el tablero lo separe en equipo: eres X, perteneces al
-- equipo de SEO, equipo profesional… que sea multi-equipos.» Y luego: «desarrollo
-- y SEO es lo mismo, pero claro, son por roles según jerarquía».
--
--   · task_teams: un equipo de UNA empresa (invoice_issuers), como el resto del
--     tablero (#245: por empresa). Se archiva, no se borra.
--   · task_team_roles: los cargos de cada equipo, con su NIVEL. Delegar va
--     hacia abajo: se asigna a quien tiene un nivel MENOR en el mismo equipo.
--     El nivel admite decimales (1.5) para meter cargos intermedios.
--   · task_team_members: quién está en cada equipo y con qué cargo. Una persona
--     puede estar en varios equipos.
--   · tasks.team_id: el equipo de la tarea. Sin equipo, sale como «Sin equipo».
--
-- Tablas y no ENUM a propósito: los cargos y equipos los crea el admin desde la
-- pantalla. Se puede pasar dos veces. Los equipos de cada empresa se crean con
-- el guion del despliegue, no aquí.

BEGIN;

CREATE TABLE IF NOT EXISTS task_teams (
    id SERIAL PRIMARY KEY,
    issuer_id INTEGER NOT NULL REFERENCES invoice_issuers(id) ON DELETE RESTRICT,
    name VARCHAR(80) NOT NULL,
    color VARCHAR(20) NOT NULL DEFAULT 'gray',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_teams_nombre ON task_teams (issuer_id, lower(name));

CREATE TABLE IF NOT EXISTS task_team_roles (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES task_teams(id) ON DELETE CASCADE,
    name VARCHAR(60) NOT NULL,
    level NUMERIC(6, 2) NOT NULL CHECK (level > 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_team_roles_nombre ON task_team_roles (team_id, lower(name));

CREATE TABLE IF NOT EXISTS task_team_members (
    team_id INTEGER NOT NULL REFERENCES task_teams(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_role_id INTEGER NOT NULL REFERENCES task_team_roles(id) ON DELETE RESTRICT,
    added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_team_members_user ON task_team_members (user_id);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES task_teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks (team_id) WHERE team_id IS NOT NULL;

COMMENT ON TABLE task_teams IS 'Equipos del tablero de tareas, por empresa (Diego, 26/10/2026).';
COMMENT ON TABLE task_team_roles IS 'Cargos de un equipo con su nivel: se delega hacia niveles menores.';
COMMENT ON TABLE task_team_members IS 'Quién está en cada equipo y con qué cargo.';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON task_teams, task_team_roles, task_team_members TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE task_teams_id_seq, task_team_roles_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
