-- Migracion 127: registro de correos enviados
--
-- Hasta ahora un envio fallido moria en un logger.error() que nadie lee. Los
-- 3.133 intentos perdidos de ISEIE y MultiCRM no dejaron ni una fila en ninguna
-- parte: se supo por los logs del servidor, no por el CRM.
--
-- Y sin registro tampoco se puede saber si algo YA se envio, que es lo que hizo
-- que el vigilante del catalogo mandara el mismo aviso cinco veces en una tarde:
-- cada reinicio del proceso lo disparaba otra vez.

CREATE TABLE IF NOT EXISTS email_envios (
  id            SERIAL       PRIMARY KEY,

  -- Clave de idempotencia. Es lo unico verdaderamente nuevo: quien necesite que
  -- un correo salga UNA sola vez la pasa (por ejemplo 'recordatorio-482'). Quien
  -- no, la deja vacia y no se controla nada. El indice unico parcial de abajo es
  -- la barrera: el segundo intento choca contra el indice, no manda otro correo.
  clave         TEXT,

  -- En plural a proposito. `to` llega al servicio de cuatro formas distintas, y
  -- una de ellas es adminEmails.join(',') — varios correos en una cadena. Fingir
  -- que siempre hay un destinatario unico seria mentir en el nombre.
  destinatarios TEXT         NOT NULL,
  asunto        TEXT         NOT NULL,

  -- Las mismas etiquetas que el CRM ya pasa a Brevo: ['rfc','created'],
  -- ['doc-factura','psiko-3'], ['email-sequence','seq-12']...
  -- Se guardan tal cual en vez de inventar un campo «motivo» paralelo: la
  -- convencion ya existia en los diez sitios que mandan correo, y duplicarla
  -- habria dejado el campo nuevo vacio hasta tocarlos uno a uno.
  etiquetas     TEXT[],

  -- Casi siempre NULL: solo lo pasan secuencias, documentos y correos a leads.
  -- Recordatorios, peticiones de cambio y avisos de Google Ads no lo tienen.
  project_id    INTEGER      REFERENCES projects(id) ON DELETE SET NULL,

  -- `bloqueado` es distinto de `fallido`: no es que Brevo lo rechazara, es que
  -- el freno de pruebas decidio no mandarlo. Mezclarlos haria que el registro de
  -- fallos pareciera roto en cada entorno que no sea produccion.
  estado        VARCHAR(12)  NOT NULL CHECK (estado IN ('enviado', 'fallido', 'bloqueado')),
  -- Los intentos que se hicieron de verdad, no el tope. Un 4xx corta a la
  -- primera; ver un 3 repetido avisa de que Brevo va mal antes de que se queje
  -- nadie.
  intentos      SMALLINT     NOT NULL DEFAULT 1,
  brevo_msg_id  VARCHAR(200),
  error         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Una fila por clave, y solo cuando hay clave: los envios sin clave —los
-- manuales de una gestora a un lead— pueden repetirse las veces que haga falta.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_envios_clave
  ON email_envios (clave) WHERE clave IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_envios_fecha
  ON email_envios (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_envios_estado
  ON email_envios (estado, created_at DESC);
-- Para «ensename todos los de facturas» sin desempaquetar el array en cada fila.
CREATE INDEX IF NOT EXISTS idx_email_envios_etiquetas
  ON email_envios USING GIN (etiquetas);

-- El propietario, sin cablear ningun nombre: se toma el dueño de la base en la
-- que se este ejecutando. En ISEIH es crm_user y en ISEIE crm_iseie_user. Sin
-- esto la tabla se queda de postgres y la aplicacion responde 500 con
-- «permission denied», que es lo que paso al probar la 122.
DO $$
DECLARE duenyo TEXT;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO duenyo
    FROM pg_database WHERE datname = current_database();
  EXECUTE format('ALTER TABLE email_envios OWNER TO %I', duenyo);
  EXECUTE format('ALTER SEQUENCE email_envios_id_seq OWNER TO %I', duenyo);
END $$;

COMMENT ON TABLE email_envios IS
  'Todo correo que el CRM intenta mandar, saliera o no. Antes solo quedaba en el log del servidor.';
COMMENT ON COLUMN email_envios.clave IS
  'Clave de idempotencia. Si se repite, el correo no se vuelve a enviar.';
COMMENT ON COLUMN email_envios.etiquetas IS
  'Las tags que el CRM ya manda a Brevo. La primera es la categoria: rfc, manual, doc-factura...';
