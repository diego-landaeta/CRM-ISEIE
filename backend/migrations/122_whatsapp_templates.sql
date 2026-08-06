-- Migracion 122: plantillas de WhatsApp en base de datos
--
-- Hasta ahora vivian en el localStorage del navegador, con dos consecuencias:
--
--   · No se comparten. Cada gestora tiene las suyas en su equipo, nadie puede
--     revisarlas y si cambia de ordenador las pierde.
--   · Los dos CRMs las guardaban DISTINTO y ni siquiera coincidian entre si.
--     ISEIH: {id, label, text}   con clave 'crm.wa-templates.<proyecto>'
--     ISEIE: {id, label, body}   con clave 'crm.whatsapp.templates.v1', global
--     y ademas el hook de ISEIE era un stub vacio, asi que su dialogo iba por
--     libre con su propio formato.
--
-- Aqui se unifican. El campo se llama body, como en el CRM hermano.
--
-- Las variables siguen siendo de llave simple ({nombre}, {producto}) y NO se
-- pasan por renderTemplate de email-templates: ese escapa HTML siempre y
-- convertiria «Master & Diplomado» en «Master &amp; Diplomado» dentro del chat.

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id           SERIAL       PRIMARY KEY,
  project_id   INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label        VARCHAR(120) NOT NULL,
  body         TEXT         NOT NULL,
  -- 'compartida' la ve todo el proyecto; 'personal' solo quien la creo.
  ambito       VARCHAR(12)  NOT NULL DEFAULT 'compartida'
                            CHECK (ambito IN ('compartida', 'personal')),
  owner_id     INTEGER      REFERENCES users(id) ON DELETE CASCADE,
  orden        INTEGER      NOT NULL DEFAULT 0,
  active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Una personal sin dueño no la veria nadie; una compartida con dueño
  -- confundiria a quien la mire. Se impide desde el principio.
  CONSTRAINT whatsapp_templates_ambito_owner CHECK (
    (ambito = 'personal'   AND owner_id IS NOT NULL) OR
    (ambito = 'compartida' AND owner_id IS NULL)
  )
);

-- El propietario, sin cablear ningun nombre: se toma el dueño de la base de
-- datos en la que se este ejecutando. En ISEIH es crm_user y en ISEIE
-- crm_iseie_user, y en staging otro distinto; asi el fichero es identico en
-- todas partes y nadie tiene que acordarse.
--
-- Sin esto la tabla se queda de postgres y la aplicacion responde 500 con
-- «permission denied for table whatsapp_templates», que es exactamente lo que
-- paso al probarla.
DO $$
DECLARE duenyo TEXT;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO duenyo
    FROM pg_database WHERE datname = current_database();
  EXECUTE format('ALTER TABLE whatsapp_templates OWNER TO %I', duenyo);
  EXECUTE format('ALTER SEQUENCE whatsapp_templates_id_seq OWNER TO %I', duenyo);
END $$;

CREATE INDEX IF NOT EXISTS idx_wa_templates_project
  ON whatsapp_templates (project_id, active, orden);
CREATE INDEX IF NOT EXISTS idx_wa_templates_owner
  ON whatsapp_templates (owner_id) WHERE owner_id IS NOT NULL;

COMMENT ON TABLE whatsapp_templates IS
  'Plantillas de WhatsApp por proyecto. Antes vivian en localStorage y no se compartian entre gestoras.';
COMMENT ON COLUMN whatsapp_templates.body IS
  'Texto con variables de llave simple: {nombre}, {nombreCompleto}, {producto}, {proyecto}, {email}, {telefono}.';

-- Las cuatro de siempre, para cada proyecto activo, y solo si el proyecto no
-- tiene ninguna: asi volver a pasar la migracion no duplica nada.
INSERT INTO whatsapp_templates (project_id, label, body, orden)
SELECT p.id, v.label, v.body, v.orden
  FROM projects p
 CROSS JOIN (VALUES
   ('Saludo inicial', 'Hola {nombre}, te escribimos desde {proyecto}. Vimos tu interés por {producto} y queremos ayudarte. ¿Tienes 2 minutos para una llamada rápida?', 1),
   ('Seguimiento',    'Hola {nombre}, ¿pudiste revisar la información sobre {producto} que te enviamos? Quedo atenta a tus dudas.', 2),
   ('Oferta',         'Hola {nombre}, tenemos una oferta especial sobre {producto} hasta el viernes. ¿Te llamo para contártelo?', 3),
   ('Reactivar',      'Hola {nombre}, hace días que no hablamos sobre {producto}. ¿Sigue siendo de tu interés?', 4)
 ) AS v(label, body, orden)
 WHERE p.active
   AND NOT EXISTS (SELECT 1 FROM whatsapp_templates w WHERE w.project_id = p.id);
