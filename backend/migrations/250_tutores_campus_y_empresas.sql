-- CRM-ISEIE 250 = MultiCRM 208 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- 208 · Consultas de alumnos, fase 1 (#187): el tutor con empresas enteras y su
-- matrícula en el campus de cada proyecto.
--
-- Los campus del tutor ya existen: son sus `user_projects`, los mismos que se
-- marcan al darlo de alta y los que mira Tutores (OTRO_PROYECTO). Aquí solo se
-- añade lo que no había:
--
--   · tutor_empresas: las empresas ENTERAS de un tutor. «Asignar una empresa
--     cubre todos sus proyectos, también los que se añadan después: se resuelve
--     al consultar, no copiando filas» (#187). Por eso no se copia nada a
--     `user_projects`: los campus de la empresa se leen de
--     `projects.sociedad_emisora_id` cada vez.
--
--   · tutor_campus: si el correo del tutor es usuario del campus (Moodle) de cada
--     proyecto. activa, pendiente de matrícula o baja en el campus. Sin fila =
--     aún no se ha comprobado (o el campus no está conectado en Integraciones).
--
-- 208: la 207 es la de Matrículas (#199, PR #341). Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS tutor_empresas (
    tutor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issuer_id INTEGER NOT NULL REFERENCES invoice_issuers(id) ON DELETE CASCADE,
    creado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tutor_id, issuer_id)
);

CREATE INDEX IF NOT EXISTS idx_tutor_empresas_issuer ON tutor_empresas(issuer_id);

COMMENT ON TABLE tutor_empresas IS
  'Empresas enteras de un tutor para las consultas de alumnos (#187). Cubre los campus de la empresa al consultar, también los nuevos; no copia filas a user_projects.';

CREATE TABLE IF NOT EXISTS tutor_campus (
    tutor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    estado VARCHAR(20) NOT NULL CHECK (estado IN ('activa', 'pendiente', 'baja')),
    -- El id del usuario en ese Moodle, para el día que haya que escribirle.
    moodle_user_id INTEGER,
    comprobado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Lo último que dijo el campus si la comprobación no pudo hacerse (token
    -- caducado, campus caído…). El estado se queda como estaba.
    error TEXT,
    PRIMARY KEY (tutor_id, project_id)
);

COMMENT ON TABLE tutor_campus IS
  'Matrícula del tutor en el campus (Moodle) de cada proyecto (#187): activa, pendiente (su correo no es usuario) o baja (lo era y ya no, o está suspendido).';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tutor_empresas TO %I', r);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tutor_campus TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
