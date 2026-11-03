-- CRM-ISEIE 252 = MultiCRM 210 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- 210 · Consultas de alumnos, fase 3 (#189): los alumnos de cada tutor y su
-- carga de trabajo.
--
--   · tutor_alumnos: los alumnos MATRICULADOS (activos) en los cursos de cada
--     tutor, leídos del campus una vez al día. «Alumnos sin mensajes» sale de
--     aquí: los que no tienen ninguna conversación con su tutor.
--       - matriculado_desde: Moodle no da la fecha de matrícula sin un plugin;
--         se usa la primera vez que el CRM ve al alumno matriculado y se marca
--         como aproximada (decisión 2 del estudio de la fase 0).
--       - con_conversacion: si ya hay mensajes entre los dos en el campus (de
--         antes de que el CRM leyera, o desde el CRM).
--       - activo: false cuando deja de salir matriculado (baja o fin): sale de
--         la lista (decisión 8: solo matrículas activas).
--   · tutor_carga: «Mi carga de trabajo» con su historial: cada cambio es una
--     fila nueva (la última es la de ahora).
--
-- 210: la 209 es la de la fase 2 (#188). Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS tutor_alumnos (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tutor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alumno_moodle_id BIGINT NOT NULL,
    curso_moodle_id BIGINT NOT NULL,
    curso_nombre TEXT,
    alumno_nombre TEXT,
    alumno_email TEXT,
    matriculado_desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    matricula_aproximada BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_acceso TIMESTAMPTZ,
    con_conversacion BOOLEAN NOT NULL DEFAULT FALSE,
    -- Cuándo se le escribió o escribió él por primera vez (tiempo hasta el primer contacto).
    primer_contacto_at TIMESTAMPTZ,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    visto_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, tutor_id, alumno_moodle_id, curso_moodle_id)
);

CREATE INDEX IF NOT EXISTS idx_tutor_alumnos_tutor ON tutor_alumnos(tutor_id, activo);
CREATE INDEX IF NOT EXISTS idx_tutor_alumnos_alumno ON tutor_alumnos(project_id, alumno_moodle_id);

CREATE TABLE IF NOT EXISTS tutor_carga (
    id SERIAL PRIMARY KEY,
    tutor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nivel VARCHAR(10) NOT NULL CHECK (nivel IN ('baja', 'media', 'alta', 'completa')),
    texto TEXT,
    creado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tutor_carga_tutor ON tutor_carga(tutor_id, created_at DESC);

COMMENT ON TABLE tutor_alumnos IS
  'Alumnos activos en los cursos de cada tutor, leídos del campus (#189). matriculado_desde es aproximada: la primera vez que el CRM lo vio.';
COMMENT ON TABLE tutor_carga IS
  '«Mi carga de trabajo» del tutor (#189): nivel y texto, con historial (una fila por cambio).';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tutor_alumnos, tutor_carga TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE tutor_alumnos_id_seq, tutor_carga_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
