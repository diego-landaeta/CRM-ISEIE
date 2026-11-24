-- 333 · Suspensiones y reactivaciones de Moodle en la ficha del alumno (gemela de MultiCRM #531, PR CRM#1047)
--
-- Cuando no paga, Make suspende al alumno en Moodle (su cuenta o su matrícula en un
-- curso) y en el CRM no quedaba rastro. Desde el plugin `local_crm` 1.13.0, el propio
-- Moodle avisa al CRM de cada suspensión y reactivación, la haga quien la haga (Make,
-- una persona, un script): `evento: 'estado_alumno'` en /api/moodle-avisos/:projectId,
-- con la misma firma que los mensajes.
--
-- Una fila por cambio:
--   · `cambio_id` lo pone el plugin (sha1 de alumno, ámbito, curso, estado y momento):
--     el mismo aviso dos veces (al momento y desde la cola del cron) no se apunta dos.
--   · `lead_id`, la ficha del CRM con ese correo (en ese campus, o con una venta en él).
--     Puede no haber: se guarda igual y se enlaza si luego aparece.
--   · `motivo` / `motivo_texto`: Moodle no dice por qué. El CRM lo deduce al recibirlo de
--     lo que sabe de los cobros (consultas.estadoAlumno.js, `deducirMotivo`) y lo deja
--     escrito tal como lo vio en ese momento.
--
-- Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS moodle_estado_alumno (
  id               SERIAL        PRIMARY KEY,
  project_id       INTEGER       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lead_id          INTEGER       REFERENCES leads(id) ON DELETE SET NULL,
  moodle_user_id   INTEGER       NOT NULL,
  alumno_nombre    VARCHAR(255),
  alumno_email     VARCHAR(320),
  -- 'cuenta': la cuenta entera del campus; 'curso': su matrícula en un curso.
  ambito           VARCHAR(10)   NOT NULL,
  curso_moodle_id  INTEGER,
  curso_nombre     VARCHAR(255),
  suspendido       BOOLEAN       NOT NULL,
  -- Cuándo pasó en Moodle (no cuándo llegó el aviso).
  fecha            TIMESTAMPTZ   NOT NULL,
  -- Por dónde: 'ws' servicio web (Make y otras integraciones), 'cli' un script, 'web' una persona.
  via              VARCHAR(10),
  cambio_id        VARCHAR(64)   NOT NULL,
  motivo           VARCHAR(30)   NOT NULL,
  motivo_texto     VARCHAR(300),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT moodle_estado_alumno_ambito CHECK (ambito IN ('cuenta', 'curso')),
  CONSTRAINT moodle_estado_alumno_curso CHECK ((ambito = 'curso') = (curso_moodle_id IS NOT NULL)),
  CONSTRAINT moodle_estado_alumno_via CHECK (via IS NULL OR via IN ('ws', 'cli', 'web'))
);

-- La idempotencia: un cambio de un campus, una fila.
CREATE UNIQUE INDEX IF NOT EXISTS moodle_estado_alumno_cambio
  ON moodle_estado_alumno (project_id, cambio_id);
-- La ficha y el filtro «Suspendidos»: el último estado de cada alumno.
CREATE INDEX IF NOT EXISTS moodle_estado_alumno_lead
  ON moodle_estado_alumno (lead_id, fecha DESC) WHERE lead_id IS NOT NULL;
-- Enlazar después los avisos que llegaron sin ficha.
CREATE INDEX IF NOT EXISTS moodle_estado_alumno_sin_lead
  ON moodle_estado_alumno (project_id, lower(alumno_email)) WHERE lead_id IS NULL;

COMMENT ON TABLE moodle_estado_alumno IS
  'Suspensiones y reactivaciones del alumno en Moodle (cuenta o matrícula), avisadas por el plugin local_crm 1.13.0 (gemela de CRM#531)';
COMMENT ON COLUMN moodle_estado_alumno.motivo IS
  'Deducido por el CRM al recibirlo: cobro_fallido, cuota_vencida, pendiente_vencido, sin_motivo, reactivado o pago.';

-- La tabla es del usuario de la app, no de quien aplica la migración (como en la 308).
DO $$
DECLARE dueno text;
BEGIN
  SELECT tableowner INTO dueno FROM pg_tables WHERE schemaname = 'public' AND tablename = 'leads';
  IF dueno IS NOT NULL THEN
    EXECUTE format('ALTER TABLE moodle_estado_alumno OWNER TO %I', dueno);
    EXECUTE format('ALTER SEQUENCE moodle_estado_alumno_id_seq OWNER TO %I', dueno);
  END IF;
END $$;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON moodle_estado_alumno TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE moodle_estado_alumno_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
