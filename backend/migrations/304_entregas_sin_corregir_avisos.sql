-- 304 · Aviso a la tutora de las entregas sin corregir de más de 48 h (#457)
--
-- Gemela de la 254 del CRM 360 (parte 7 de la #681, PR CRM#736), igual que allí.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Indicaciones de Carlos (05/11): «aviso por correo si una tarea lleva más de 48 h
-- sin atender». El job (jobs/entregasSinCorregirScheduler.js) lee de Moodle las
-- entregas por corregir de cada tutora y le escribe UNA vez por entrega.
--
-- Esta tabla es lo que recuerda qué entrega ya se le avisó a qué tutora, para no
-- repetirlo en cada vuelta ni al reiniciar. Una entrega es (campus, tarea, alumno de
-- Moodle, fecha de entrega): si el alumno vuelve a entregar, la fecha cambia y es una
-- entrega nueva, que se vuelve a avisar. Va por tutora porque un curso puede tener
-- dos profesoras y las dos la ven en «Mi campus».
--
-- No guarda nada de Moodle más allá de los números: el nombre del alumno y de la
-- tarea se leen en el momento.
--
-- Se puede pasar dos veces.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS entregas_sin_corregir_avisos (
    id SERIAL PRIMARY KEY,
    tutor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    curso_id INTEGER NOT NULL,
    tarea_id INTEGER NOT NULL,
    alumno_moodle_id INTEGER NOT NULL,
    entregada_at TIMESTAMPTZ NOT NULL,
    avisado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Si salió el correo (con el freno de correos a tutores, solo la campana).
    por_correo BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS entregas_sin_corregir_avisos_unica
    ON entregas_sin_corregir_avisos (tutor_id, project_id, tarea_id, alumno_moodle_id, entregada_at);

-- Como en el CRM 360: que el CRM pueda leer y escribir aunque la migración la
-- pase postgres (en el servidor la aplica postgres, y la API entra como crm_user; en
-- la gemela, crm_iseie_user). Sin esto, el aviso da «permiso denegado».
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON entregas_sin_corregir_avisos TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE entregas_sin_corregir_avisos_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
