-- 313 · El plugin del CRM en cada Moodle, notas internas, respuestas guardadas y el
--       chat de grupo en las consultas (CRM-ISEIE#406, gemela de MultiCRM #679)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Es el porte, en una sola migración, de las tres del 360:
--   · 245_moodle_plugin_crm            (códigos de conexión y plugin de cada campus)
--   · 247_consultas_notas_y_respuestas (notas internas y respuestas guardadas)
--   · 248_consultas_chat_de_grupo      (consultas del chat de grupo del curso)
-- El texto de cada parte es el mismo que allí. Los GRANT van a crm_user y a
-- crm_iseie_user (el que exista): en el servidor la aplica postgres.
--
-- Reaplicable.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Parte 1 (245 en el 360) · El plugin del CRM en cada Moodle (#679)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ ES
--
-- El plugin `local_crm` (tools/moodle-local-crm) avisa al CRM de cada mensaje
-- privado del campus, firmado con una clave del campus. Aquí se guarda esa clave
-- (cifrada, como el resto de claves), si el plugin está activo y cuándo llegó el
-- último aviso, para enseñar en el panel que el campus está conectado.
--
-- Con el plugin activo, la respuesta desde el CRM sale por el plugin, en nombre
-- de la tutora, con el token del campus: deja de hacer falta el token personal de
-- cada tutora (`tutor_campus.token_cifrado`), que sigue valiendo en los campus
-- sin plugin.
--
-- Reaplicable.
-- ─────────────────────────────────────────────────────────────────────────────

-- Los códigos de conexión: como en Certifex, conectar un campus es instalar el
-- plugin y pegar UN código. El código es de un solo uso y caduca; se guarda solo su
-- huella (sha256), nunca el código.
CREATE TABLE IF NOT EXISTS moodle_conexion_codigos (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  huella       TEXT NOT NULL UNIQUE,
  expira_at    TIMESTAMPTZ NOT NULL,
  usado_at     TIMESTAMPTZ,
  sitio        TEXT,
  creado_por   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Intentos con ese código: pasado el tope se anula (que un código filtrado no sirva para probar sin fin).
ALTER TABLE moodle_conexion_codigos ADD COLUMN IF NOT EXISTS intentos INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_moodle_conexion_codigos_proyecto ON moodle_conexion_codigos (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS moodle_plugin_campus (
  project_id       INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  secreto_cifrado  TEXT NOT NULL,
  secreto_iv       TEXT NOT NULL,
  secreto_tag      TEXT NOT NULL,
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_aviso_at  TIMESTAMPTZ,
  creado_por       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- El repaso de cada 15 minutos (plugin 1.8.0): hasta qué mensaje de Moodle está al día,
-- cuándo fue el último bueno, si falló por qué, y qué versión del plugin tiene el campus.
ALTER TABLE moodle_plugin_campus ADD COLUMN IF NOT EXISTS sincronizado_hasta_id BIGINT;
ALTER TABLE moodle_plugin_campus ADD COLUMN IF NOT EXISTS sincronizado_at TIMESTAMPTZ;
ALTER TABLE moodle_plugin_campus ADD COLUMN IF NOT EXISTS sincronizacion_error TEXT;
ALTER TABLE moodle_plugin_campus ADD COLUMN IF NOT EXISTS version_plugin TEXT;

-- Como en la 232 y la 246: que el CRM pueda leer y escribir aunque la migración la
-- pase postgres (en el servidor la aplica postgres, y la API entra como crm_user; en
-- la gemela, crm_iseie_user). Sin esto, conectar un campus da «permiso denegado».
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON moodle_conexion_codigos TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE moodle_conexion_codigos_id_seq TO %I', r);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON moodle_plugin_campus TO %I', r);
    END IF;
  END LOOP;
END $$;

-- ── Parte 2 (247 en el 360) · Notas internas en las consultas y respuestas guardadas en el servidor (#679)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Para que el personal se organice mejor:
--
--   · consulta_notas: lo que una tutora deja escrito en una consulta para quien la
--     lleve después (un relevo, coordinación). Solo lo ve el personal: nunca sale
--     al campus ni lo ve el alumno.
--
--   · respuestas_guardadas: las respuestas que se repiten («La tarea está en
--     Actividades…»). Antes vivían en el navegador de cada tutora y se perdían al
--     cambiar de equipo. Ahora:
--       - personales  → user_id puesto, project_id vacío;
--       - del campus  → project_id puesto, user_id vacío: las define coordinación
--                       y las ven todas las tutoras de ese campus.
--
-- Se puede pasar dos veces.
-- ─────────────────────────────────────────────────────────────────────────────


CREATE TABLE IF NOT EXISTS consulta_notas (
    id SERIAL PRIMARY KEY,
    consulta_id INTEGER NOT NULL REFERENCES consultas(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    autor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    texto TEXT NOT NULL CHECK (length(btrim(texto)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consulta_notas_consulta ON consulta_notas (consulta_id, created_at);

CREATE TABLE IF NOT EXISTS respuestas_guardadas (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    titulo VARCHAR(120) NOT NULL CHECK (length(btrim(titulo)) > 0),
    texto TEXT NOT NULL CHECK (length(btrim(texto)) > 0),
    creado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- O de una persona o de un campus, nunca de los dos ni de ninguno.
    CONSTRAINT respuestas_guardadas_de_quien CHECK ((user_id IS NULL) <> (project_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_respuestas_guardadas_usuario ON respuestas_guardadas (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_respuestas_guardadas_campus ON respuestas_guardadas (project_id) WHERE project_id IS NOT NULL;

-- Como en la 245 y la 246: que el CRM pueda leer y escribir aunque la migración la
-- pase postgres (en el servidor la aplica postgres, y la API entra como crm_user; en
-- la gemela, crm_iseie_user). Sin esto, anotar o guardar una respuesta da «permiso denegado».
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON consulta_notas TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE consulta_notas_id_seq TO %I', r);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON respuestas_guardadas TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE respuestas_guardadas_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;


-- ── Parte 3 (248 en el 360) · Consultas en el chat de GRUPO del alumno con las tutoras del curso (#679, plugin 1.9.0)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CAMBIA (opción B de la #285, elegida por Carlos el 06/11/2026)
--
-- Con el plugin local_crm 1.9.0, «Entrar al chat» de un curso abre UNA conversación de
-- grupo por alumno y curso: el alumno y las tutoras de ese curso. Todas ven lo mismo y
-- cualquiera responde. En el CRM es una sola consulta:
--
--   · consultas.conversacion_grupo_id  el chat de grupo de la consulta. La respuesta desde
--                                      el CRM va ahí (no a una conversación privada). Una
--                                      consulta que venía del chat directo y sigue en el de
--                                      grupo lo tiene puesto y su conversación privada sigue
--                                      en conversacion_externa_id.
--   · consultas.grupo_tipo             de qué chat es: 'plugin' (el del alumno con las tutoras
--                                      de su curso) o 'curso' (la conversación de un grupo del
--                                      curso con una tutora dentro, #285: lo que se responde ahí
--                                      lo leen todos los alumnos del grupo).
--   · consultas.participantes          quién estaba en ese chat en el último mensaje
--                                      ([{ id, nombre, tutora, alumno }], ids de Moodle; en un
--                                      grupo del curso, solo las tutoras y quien escribe).
--   · consulta_mensajes.autor_moodle_id
--     consulta_mensajes.autor_nombre_campus
--                                      quién escribió en el campus. En un chat de grupo
--                                      responde cualquier tutora, también una sin ficha en el
--                                      CRM: su nombre sale igual en la consulta.
--
-- La consulta sigue teniendo su tutora (tutor_id) y su curso para las métricas y «Mi
-- campus»; el relevo cambia la tutora de la consulta, ya no la conversación.
--
-- Reaplicable.
-- ─────────────────────────────────────────────────────────────────────────────


ALTER TABLE consultas ADD COLUMN IF NOT EXISTS conversacion_grupo_id BIGINT;
ALTER TABLE consultas ADD COLUMN IF NOT EXISTS participantes JSONB;
ALTER TABLE consultas ADD COLUMN IF NOT EXISTS grupo_tipo TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consultas_grupo_tipo_valido') THEN
    ALTER TABLE consultas ADD CONSTRAINT consultas_grupo_tipo_valido CHECK (grupo_tipo IS NULL OR grupo_tipo IN ('plugin', 'curso'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_consultas_conversacion_grupo
    ON consultas (project_id, conversacion_grupo_id) WHERE conversacion_grupo_id IS NOT NULL;

ALTER TABLE consulta_mensajes ADD COLUMN IF NOT EXISTS autor_moodle_id BIGINT;
ALTER TABLE consulta_mensajes ADD COLUMN IF NOT EXISTS autor_nombre_campus TEXT;


COMMIT;
