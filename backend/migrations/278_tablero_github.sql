-- 278 · El tablero de tareas, al día con las issues de GitHub (CRM-ISEIE#435, gemela de CRM#737)
--
-- Diego, 11/11/2026: «GitHub manda y el tablero lo refleja». Cada issue del
-- repositorio de este CRM es una tarea del equipo de desarrollo; el webhook de
-- GitHub la mantiene al día (abierta → «Por hacer», PR a staging → «En
-- revisión», cerrada → «Hecha», reabierta → «En curso»). Solo en ese sentido:
-- nada del CRM sube a GitHub.
--
--   · github_tablero_config     una sola fila: el repositorio, el equipo, quién
--                               supervisa (y lleva lo que no tiene responsable) y
--                               la copia privada de la empresa.
--   · github_usuarios           login de GitHub → persona del CRM (el asignado de
--                               la issue es el responsable de la tarea).
--   · github_issue_tareas       el vínculo issue ↔ tarea: UNIQUE (repo, número).
--   · github_entregas           cada aviso del webhook ya procesado (el id de
--                               X-GitHub-Delivery): el mismo aviso dos veces no
--                               hace nada la segunda.
--   · el servicio «github» en las credenciales: el secreto del webhook y el token
--     de solo lectura, cifrados como las demás (JSON {"webhook_secret","token"}).
--
-- Todo detrás de GITHUB_TABLERO_ACTIVO (apagado de serie). Se puede pasar dos veces.

-- ALTER TYPE ... ADD VALUE va suelto, como en la 264: no se usa el valor aquí.
ALTER TYPE api_service ADD VALUE IF NOT EXISTS 'github';

BEGIN;

CREATE TABLE IF NOT EXISTS github_tablero_config (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    repo VARCHAR(140) NOT NULL,
    team_id INTEGER REFERENCES task_teams(id) ON DELETE SET NULL,
    supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    copia_repo VARCHAR(140),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- El repositorio público de este CRM. El equipo, de serie, el de desarrollo si
-- solo hay uno; si hay dos (el 360 tiene uno por empresa) se elige en el panel.
-- El supervisor se elige en el panel: sin él, el webhook no crea tareas.
INSERT INTO github_tablero_config (id, repo, team_id)
SELECT 1, 'diego-landaeta/CRM-ISEIE',
       (SELECT CASE WHEN COUNT(*) = 1 THEN MIN(id) END
          FROM task_teams WHERE is_active AND lower(name) ~ '(desarrollo|programaci[oó]n)')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS github_usuarios (
    login VARCHAR(39) PRIMARY KEY CHECK (login = lower(login)),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_github_usuarios_user ON github_usuarios (user_id);

CREATE TABLE IF NOT EXISTS github_issue_tareas (
    id SERIAL PRIMARY KEY,
    repo VARCHAR(140) NOT NULL,
    number INTEGER NOT NULL,
    node_id VARCHAR(100),
    task_id INTEGER NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
    estado VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (estado IN ('open', 'closed', 'borrada')),
    asignados TEXT[] NOT NULL DEFAULT '{}',
    por_definir BOOLEAN NOT NULL DEFAULT FALSE,
    prs INTEGER[] NOT NULL DEFAULT '{}',
    comentarios INTEGER NOT NULL DEFAULT 0,
    copia_repo VARCHAR(140),
    copia_number INTEGER,
    github_updated_at TIMESTAMPTZ,
    ultima_sincronizacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_github_issue_tareas UNIQUE (repo, number)
);
CREATE INDEX IF NOT EXISTS idx_github_issue_tareas_asignados ON github_issue_tareas USING GIN (asignados);

CREATE TABLE IF NOT EXISTS github_entregas (
    delivery_id VARCHAR(80) PRIMARY KEY,
    evento VARCHAR(40) NOT NULL,
    accion VARCHAR(40),
    repo VARCHAR(140),
    number INTEGER,
    resultado VARCHAR(200),
    recibida_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_github_entregas_fecha ON github_entregas (recibida_at DESC);

COMMENT ON TABLE github_tablero_config IS 'Tablero ↔ GitHub (CRM-ISEIE#435, gemela de CRM#737): repositorio, equipo, supervisor y copia de la empresa. Una fila.';
COMMENT ON TABLE github_usuarios IS 'Login de GitHub → persona del CRM: el asignado de la issue es el responsable de la tarea.';
COMMENT ON TABLE github_issue_tareas IS 'Cada issue del repositorio con su tarea del tablero (GitHub manda).';
COMMENT ON TABLE github_entregas IS 'Avisos del webhook de GitHub ya procesados (X-GitHub-Delivery), para no repetirlos.';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON github_tablero_config, github_usuarios, github_issue_tareas, github_entregas TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE github_issue_tareas_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
