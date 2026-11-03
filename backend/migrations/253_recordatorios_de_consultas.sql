-- CRM-ISEIE 253 = MultiCRM 211 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- 211 · Consultas de alumnos, fase 4 (#190): recordatorios y avisos de fuera
-- de plazo.
--
--   · consultas.recordatorio_plazo_at: cuándo se recordó al tutor que la
--     consulta se acerca al plazo (decisión 4).
--   · consultas.aviso_fuera_plazo_at: cuándo se avisó a administración de que
--     se pasó del plazo.
--     Los dos valen para la espera de ahora: si el alumno vuelve a escribir,
--     `espera_desde` es posterior y se vuelve a avisar.
--   · tutor_carga_recordatorios: el último recordatorio de «carga
--     desactualizada» a cada tutor (decisión 9), para no repetirlo cada día.
--
-- 211: la 210 es la de la fase 3 (#189). Se puede pasar dos veces.

BEGIN;

ALTER TABLE consultas ADD COLUMN IF NOT EXISTS recordatorio_plazo_at TIMESTAMPTZ;
ALTER TABLE consultas ADD COLUMN IF NOT EXISTS aviso_fuera_plazo_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_consultas_abiertas_espera
    ON consultas (COALESCE(espera_desde, entrada_at)) WHERE estado = 'abierta';

CREATE TABLE IF NOT EXISTS tutor_carga_recordatorios (
    tutor_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    ultimo_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tutor_carga_recordatorios IS
  'Último recordatorio de «carga de trabajo desactualizada» a cada tutor (#190).';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tutor_carga_recordatorios TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
