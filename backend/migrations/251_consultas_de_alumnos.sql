-- CRM-ISEIE 251 = MultiCRM 209 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- 209 · Consultas de alumnos, fase 2 (#188): las consultas que llegan del campus,
-- sus mensajes, adjuntos y la hora de cada paso.
--
--   · consultas: alumno, curso, proyecto, empresa, tutor asignado y estado
--     (abierta = el alumno espera respuesta · respondida · cerrada). La hora de
--     cada evento que pide la #188: entrada, asignación, primera lectura,
--     primera respuesta, cierre y reapertura.
--   · consulta_mensajes: del alumno o del tutor, con su texto y su fecha. El id
--     del mensaje en Moodle hace que el mismo mensaje dos veces no se duplique
--     (índice único por proyecto). Las respuestas del tutor esperan aquí hasta
--     que el campus las acepta (enviado_campus_at / error_envio).
--   · consulta_adjuntos: los archivos del tutor, en el almacenamiento del CRM
--     (local o R2). El alumno los abre con un enlace propio que caduca.
--   · consulta_eventos: el historial (asignada, reasignada, leída, respondida,
--     cerrada, reabierta), para medir y para ver qué pasó.
--   · tutor_campus: el token del tutor en ese campus, cifrado, para que la
--     respuesta salga en su nombre (opción «a» del estudio de la fase 0).
--
-- 209: la 208 es la de la fase 1 (#187). Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS consultas (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- La empresa del proyecto cuando entró: si el campus cambia de empresa, la
    -- consulta se cuenta donde se atendió.
    issuer_id INTEGER REFERENCES invoice_issuers(id) ON DELETE SET NULL,
    alumno_moodle_id BIGINT,
    alumno_nombre TEXT,
    alumno_email TEXT,
    curso_moodle_id BIGINT,
    curso_nombre TEXT,
    tutor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'abierta'
        CHECK (estado IN ('abierta', 'respondida', 'cerrada')),
    origen VARCHAR(20) NOT NULL DEFAULT 'moodle',
    -- La conversación de Moodle de la que sale (mensajería privada alumno ↔ tutor).
    conversacion_externa_id BIGINT,
    entrada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    asignada_at TIMESTAMPTZ,
    primera_lectura_at TIMESTAMPTZ,
    primera_respuesta_at TIMESTAMPTZ,
    cerrada_at TIMESTAMPTZ,
    reabierta_at TIMESTAMPTZ,
    -- Desde cuándo espera el alumno: el semáforo se cuenta desde aquí.
    espera_desde TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consultas_tutor_estado ON consultas(tutor_id, estado);
CREATE INDEX IF NOT EXISTS idx_consultas_project_estado ON consultas(project_id, estado);
CREATE INDEX IF NOT EXISTS idx_consultas_alumno ON consultas(project_id, alumno_moodle_id);
-- Otras conversaciones de Moodle de la misma consulta: tras reasignarla, el
-- tutor nuevo responde con su token y Moodle abre la conversación de ese tutor
-- con el alumno; lo que el alumno conteste ahí sigue siendo esta consulta.
ALTER TABLE consultas ADD COLUMN IF NOT EXISTS conversaciones_extra BIGINT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS consulta_mensajes (
    id SERIAL PRIMARY KEY,
    consulta_id INTEGER NOT NULL REFERENCES consultas(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    autor VARCHAR(10) NOT NULL CHECK (autor IN ('alumno', 'tutor')),
    autor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    texto TEXT NOT NULL,
    -- El id del mensaje en Moodle. Vacío en una respuesta que aún no ha llegado.
    externo_id BIGINT,
    escrito_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Respuestas del tutor: cuándo la aceptó el campus, o por qué no.
    enviado_campus_at TIMESTAMPTZ,
    error_envio TEXT,
    intentos INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_consulta_mensajes_externo
    ON consulta_mensajes(project_id, externo_id) WHERE externo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consulta_mensajes_consulta ON consulta_mensajes(consulta_id, escrito_at);

CREATE TABLE IF NOT EXISTS consulta_adjuntos (
    id SERIAL PRIMARY KEY,
    mensaje_id INTEGER NOT NULL REFERENCES consulta_mensajes(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    tipo TEXT,
    tamano INTEGER,
    storage_key TEXT NOT NULL,
    -- El enlace que va en el mensaje al alumno: largo, al azar y con caducidad.
    token_descarga VARCHAR(64) NOT NULL UNIQUE,
    expira_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consulta_eventos (
    id BIGSERIAL PRIMARY KEY,
    consulta_id INTEGER NOT NULL REFERENCES consultas(id) ON DELETE CASCADE,
    tipo VARCHAR(30) NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    detalle JSONB,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consulta_eventos_consulta ON consulta_eventos(consulta_id, at);

ALTER TABLE tutor_campus ADD COLUMN IF NOT EXISTS token_cifrado TEXT;
ALTER TABLE tutor_campus ADD COLUMN IF NOT EXISTS token_iv TEXT;
ALTER TABLE tutor_campus ADD COLUMN IF NOT EXISTS token_tag TEXT;

COMMENT ON TABLE consultas IS
  'Consultas de alumnos que llegan del campus (#188): alumno, curso, proyecto, empresa, tutor, estado y la hora de cada paso.';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON consultas, consulta_mensajes, consulta_adjuntos TO %I', r);
      EXECUTE format('GRANT SELECT, INSERT ON consulta_eventos TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE consultas_id_seq, consulta_mensajes_id_seq, consulta_adjuntos_id_seq, consulta_eventos_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
