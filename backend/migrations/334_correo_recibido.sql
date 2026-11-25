-- Migración 334: el correo que ENTRA, en `email_envios` (CRM-ISEIE#701, gemela de CRM#1032).
--
-- ISEIE no tenía la Bandeja del 360 (#146): `email_envios` (127) solo apunta lo
-- que el CRM manda. Para leer buzones hace falta guardar lo que llega, y es la
-- misma cosa —un correo, con su remitente, su asunto, su fecha y su cuerpo—, así
-- que va en la misma tabla, como en el 360 (sus migraciones 166 y 171, juntas).
--
-- QUÉ SE AÑADE
--   · `remitente`: de quién es. En lo que entra es lo que se mira primero.
--   · `cuerpo_html`: el texto del correo. DATOS DE PERSONAS: lo que entra no lo
--     escribimos nosotros y puede traer lo que al remitente le dé la gana (su
--     factura, su DNI). Solo lo enseña `GET /api/correos/:id`, con permiso.
--   · `direccion`: 'salida' (lo manda el CRM) o 'entrada' (llegó a un buzón).
--     Con DEFAULT 'salida', todo lo que ya hay queda bien sin tocarlo.
--   · `estado` admite 'recibido': lo que entra no «se envió».
--
-- LO QUE EVITA LOS DUPLICADOS: la `clave` con su índice único (127). Para lo que
-- entra se guarda `entrada:<buzón>:<Message-ID>`: releer el buzón no duplica.
--
-- En ISEIE el envío sigue por Brevo (Diego, CRM#1058): aquí no se rellena
-- `cuerpo_html` de lo que sale. Reaplicable: todo con IF NOT EXISTS / DROP IF EXISTS.

BEGIN;

ALTER TABLE email_envios
  ADD COLUMN IF NOT EXISTS cuerpo_html TEXT,
  ADD COLUMN IF NOT EXISTS remitente   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS direccion   VARCHAR(8) NOT NULL DEFAULT 'salida';

ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS email_envios_direccion_check;
ALTER TABLE email_envios
  ADD CONSTRAINT email_envios_direccion_check CHECK (direccion IN ('salida', 'entrada'));

-- El CHECK de la 127 era anónimo en la columna: Postgres lo llamó
-- `email_envios_estado_check`, que es el nombre que se quita aquí.
ALTER TABLE email_envios DROP CONSTRAINT IF EXISTS email_envios_estado_check;
ALTER TABLE email_envios
  ADD CONSTRAINT email_envios_estado_check
  CHECK (estado IN ('enviado', 'fallido', 'bloqueado', 'recibido'));

-- La Bandeja se pide siempre por dirección y por fecha.
CREATE INDEX IF NOT EXISTS idx_email_envios_direccion
  ON email_envios (direccion, created_at DESC);

COMMENT ON COLUMN email_envios.cuerpo_html IS
  'El texto del correo (en ISEIE, solo lo que entra). DATOS DE PERSONAS: quien lo enseñe tiene que pedir permisos.';
COMMENT ON COLUMN email_envios.remitente IS
  'De quién es el correo. NULL en los envíos anteriores a esta columna.';
COMMENT ON COLUMN email_envios.direccion IS
  'salida = lo mandó el CRM · entrada = llegó a un buzón y se leyó por IMAP.';

COMMIT;
