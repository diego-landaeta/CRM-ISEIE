-- 167 · El correo de «¿por qué has desistido?» y lo que contesta cada uno
--
-- Tareas #169 (el correo, la encuesta y el aviso a la gestora) y #170 (el panel,
-- con cuántos enviados y cuántos respondidos). Diego, 23 y 28/09.
--
-- UNA FILA POR PERSONA, y lo dice la base, no el código: `UNIQUE (lead_id)`. Si
-- el proceso diario se dispara dos veces o alguien descarta dos veces a la misma
-- persona, la segunda inserción no entra. Preguntarle dos veces por qué no
-- compró es la forma más rápida de acabar en la carpeta de spam.
--
-- Se guardan las FECHAS de todo —pedido, enviado, contestado— porque sin ellas
-- no hay estadística: «40 respuestas» no dice nada sin saber de cuántos envíos.
--
-- `token` es lo que va en el enlace del correo. La encuesta se abre sin
-- contraseña —a quien no compró no se le pide que se dé de alta—, así que el
-- token es largo y aleatorio, y lo único que deja hacer es contestar ESA
-- encuesta.

BEGIN;

CREATE TABLE IF NOT EXISTS feedback_envios (
  id             SERIAL PRIMARY KEY,
  lead_id        INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- La gestora que lo llevaba cuando se envió. Se guarda aquí y no se mira en
  -- el lead: si mañana lo reasignan, la estadística no puede cambiar de dueña.
  gestora_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Por qué se le pregunta: lo descartaron, o llegó al 7.º día sin comprar.
  disparador     VARCHAR(20) NOT NULL,
  -- pendiente  : creado, el correo todavía no ha salido
  -- revision   : alguien pidió verlo antes de que salga («quiero verlo»)
  -- enviado    : salió
  -- bloqueado  : lo paró el freno de correos (fuera de producción)
  -- fallido    : Brevo no lo aceptó
  -- sin_correo : la persona no tiene correo
  -- cancelado  : se decidió no mandarlo
  estado         VARCHAR(20) NOT NULL,
  token          VARCHAR(64) NOT NULL UNIQUE,
  email          VARCHAR(255),
  pedido_por     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  enviado_at     TIMESTAMPTZ,
  -- Por qué no salió, si no salió. Para no tener que ir al registro de correos.
  nota_envio     TEXT,
  respondido_at  TIMESTAMPTZ,
  motivo         VARCHAR(40),
  comentario     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT feedback_envios_una_por_persona UNIQUE (lead_id),
  CONSTRAINT feedback_envios_disparador CHECK (disparador IN ('descarte', 'dia7')),
  CONSTRAINT feedback_envios_estado CHECK (
    estado IN ('pendiente', 'revision', 'enviado', 'bloqueado', 'fallido', 'sin_correo', 'cancelado'))
);

-- El panel filtra por campus y fecha de envío, y desglosa por gestora.
CREATE INDEX IF NOT EXISTS feedback_envios_proyecto_envio ON feedback_envios (project_id, enviado_at);
CREATE INDEX IF NOT EXISTS feedback_envios_gestora ON feedback_envios (gestora_id);

-- La migracion se corre como postgres, asi que la tabla nace siendo suya y el
-- usuario del CRM no podria ni leerla («permission denied»). Se da a los dos
-- usuarios posibles: crm_user en MultiCRM, crm_iseie_user en ISEIE.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON feedback_envios TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE feedback_envios_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
