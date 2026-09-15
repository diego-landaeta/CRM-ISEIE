-- Migracion 128: conversaciones y mensajes de WhatsApp
--
-- Hasta ahora WhatsApp vivia FUERA del CRM: un navegador remoto retransmitido
-- por video desde el servidor de España, con 326 ms de ida y vuelta medidos.
-- Se veia la conversacion pero no se guardaba nada — no se podia buscar en
-- ella, ni verla en la ficha del lead, ni medir el trabajo comercial.
--
-- Con Evolution API lo que viaja son DATOS, no pixeles. Los mensajes acaban
-- aqui, y el retardo desaparece porque un mensaje son unos cientos de bytes.

CREATE TABLE IF NOT EXISTS wa_conversaciones (
  id            SERIAL       PRIMARY KEY,

  -- De que numero del CRM. Hoy habra uno solo, pero Psiko e ISEIH acabaran
  -- teniendo el suyo y entonces la misma persona puede escribir a los dos:
  -- son conversaciones distintas, no una compartida.
  instancia     VARCHAR(60)  NOT NULL,
  -- Tal como lo manda WhatsApp: 5511999999999@s.whatsapp.net
  jid           VARCHAR(120) NOT NULL,
  -- El mismo numero ya normalizado, que es por donde se cruza con leads.
  telefono      VARCHAR(30)  NOT NULL,
  -- Como se llama en WhatsApp. A veces no coincide con el nombre del CRM, y
  -- saberlo ayuda a la gestora a reconocer con quien habla.
  nombre_push   VARCHAR(160),
  -- La foto de perfil de WhatsApp. Es una direccion temporal que caduca, asi
  -- que se refresca cuando entra un mensaje nuevo de esa persona.
  avatar_url    TEXT,

  lead_id       INTEGER      REFERENCES leads(id) ON DELETE SET NULL,
  project_id    INTEGER      REFERENCES projects(id) ON DELETE SET NULL,

  -- El freno que de verdad protege el numero. Lo que hace que WhatsApp
  -- suspenda una linea no es tanto detectar el cliente como que la gente la
  -- bloquee o la reporte. Si alguien pide que no se le escriba, se marca aqui
  -- y el CRM se NIEGA a enviar, aunque la gestora lo intente.
  no_escribir   BOOLEAN      NOT NULL DEFAULT FALSE,
  motivo_no_escribir TEXT,

  ultimo_at     TIMESTAMPTZ,
  no_leidos     INTEGER      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_wa_conv UNIQUE (instancia, jid)
);

CREATE TABLE IF NOT EXISTS wa_mensajes (
  id              SERIAL       PRIMARY KEY,
  conversacion_id INTEGER      NOT NULL REFERENCES wa_conversaciones(id) ON DELETE CASCADE,

  -- El identificador que da WhatsApp (key.id). Evolution reintenta el webhook
  -- si el CRM tarda en contestar, asi que sin esta barrera el mismo mensaje
  -- aparecerian dos veces en el chat.
  wa_id           VARCHAR(120),

  -- Sale de key.fromMe, que es lo unico que distingue una cosa de la otra.
  direccion       VARCHAR(9)   NOT NULL CHECK (direccion IN ('entrante', 'saliente')),
  tipo            VARCHAR(20)  NOT NULL DEFAULT 'texto',
  texto           TEXT,
  media_url       TEXT,
  media_mime      VARCHAR(100),
  -- Como se llamaba el fichero para quien lo mando. Un «presupuesto.pdf» dice
  -- mucho mas en el chat que la ruta con la que lo guardamos nosotros.
  nombre_archivo  VARCHAR(255),

  -- Solo para los salientes: entregado y leido llegan despues, por webhook.
  estado          VARCHAR(12)  CHECK (estado IN ('enviado', 'entregado', 'leido', 'fallido')),
  -- Quien lo mando desde el CRM. Vacio en los entrantes.
  enviado_por     INTEGER      REFERENCES users(id) ON DELETE SET NULL,

  -- La hora de WhatsApp (messageTimestamp), no la de cuando llego el webhook:
  -- si el CRM estuvo caido diez minutos, el chat no puede mentir en el orden.
  ts              TIMESTAMPTZ  NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_mensajes_waid
  ON wa_mensajes (wa_id) WHERE wa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_mensajes_conv
  ON wa_mensajes (conversacion_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_wa_conv_lead
  ON wa_conversaciones (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_conv_recientes
  ON wa_conversaciones (instancia, ultimo_at DESC);
-- Para cruzar un telefono entrante con el lead que lo tenga.
CREATE INDEX IF NOT EXISTS idx_wa_conv_telefono
  ON wa_conversaciones (telefono);

-- El propietario, sin cablear ningun nombre: se toma el dueño de la base en la
-- que se este ejecutando (crm_user en ISEIH, crm_iseie_user en ISEIE). Sin
-- esto las tablas se quedan de postgres y la aplicacion responde 500 con
-- «permission denied», que es lo que paso al probar la 122.
DO $$
DECLARE duenyo TEXT;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO duenyo
    FROM pg_database WHERE datname = current_database();
  EXECUTE format('ALTER TABLE wa_conversaciones OWNER TO %I', duenyo);
  EXECUTE format('ALTER SEQUENCE wa_conversaciones_id_seq OWNER TO %I', duenyo);
  EXECUTE format('ALTER TABLE wa_mensajes OWNER TO %I', duenyo);
  EXECUTE format('ALTER SEQUENCE wa_mensajes_id_seq OWNER TO %I', duenyo);
END $$;

COMMENT ON TABLE wa_conversaciones IS
  'Un hilo de WhatsApp por persona y numero del CRM. Antes las conversaciones no se guardaban en ninguna parte.';
COMMENT ON COLUMN wa_conversaciones.no_escribir IS
  'Si esta marcado, el CRM se niega a enviar. Es lo que evita que suspendan el numero.';
COMMENT ON COLUMN wa_mensajes.wa_id IS
  'key.id de WhatsApp. Unico: los webhooks se reintentan y duplicarian el mensaje.';
