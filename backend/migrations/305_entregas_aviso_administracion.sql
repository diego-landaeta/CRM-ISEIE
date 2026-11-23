-- 305 · Entregas sin corregir: el aviso a administración (#457)
--
-- Gemela de la 292 del CRM 360 (#769, PR CRM#834), igual que allí.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Manuel (13/11): «primero, recordatorio automático al tutor; si sigue sin
-- resolverse, aviso a administración». El recordatorio a la tutora (48 h) es el de
-- la 304. Esto es el segundo escalón, en la misma vuelta del job
-- (jobs/entregasSinCorregirScheduler.js → tutores/tutor.entregasAdministracion.js):
--
--   · motivo 'plazo': la entrega la ve una tutora y sigue sin nota a los
--     ENTREGAS_AVISO_ADMIN_DIAS días (5) o en su «Recordarme calificar antes de».
--   · motivo 'sin_tutora': no la ve ninguna tutora del CRM; va directa a las 48 h.
--
-- Esta tabla recuerda qué entrega ya se avisó a administración, para no repetirlo en
-- cada vuelta ni al reiniciar. Una entrega es (campus, tarea, alumno de Moodle, fecha
-- de entrega), como en la 304: si el alumno vuelve a entregar, es otra. Aquí no va
-- por persona: el aviso es a toda la administración del campus a la vez.
--
-- Solo números de Moodle: los nombres del alumno y de la tarea se leen en el momento.
--
-- Se puede pasar dos veces.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS entregas_avisos_administracion (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    curso_id INTEGER NOT NULL,
    tarea_id INTEGER NOT NULL,
    alumno_moodle_id INTEGER NOT NULL,
    entregada_at TIMESTAMPTZ NOT NULL,
    motivo VARCHAR(20) NOT NULL CHECK (motivo IN ('plazo', 'sin_tutora')),
    -- Cuándo tocaba avisar (los X días o el «Recordarme calificar antes de»).
    limite_at TIMESTAMPTZ NOT NULL,
    avisado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A cuántas personas de administración (campana) y cuántos correos salieron.
    avisados INTEGER NOT NULL DEFAULT 0,
    correos INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS entregas_avisos_administracion_unica
    ON entregas_avisos_administracion (project_id, tarea_id, alumno_moodle_id, entregada_at);

-- Como en la 304: que el CRM pueda leer y escribir aunque la
-- migración la pase postgres (la API entra como crm_user; en la gemela,
-- crm_iseie_user). Sin esto, el aviso da «permiso denegado».
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON entregas_avisos_administracion TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE entregas_avisos_administracion_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
