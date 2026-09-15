-- El usuario de WhatsApp de un prospecto, además de su teléfono.
--
-- Mucha gente se contacta por usuario y no por número. Hasta ahora eso no cabía
-- en ninguna parte: o se perdía, o acababa en las notas, donde no se puede
-- pulsar, ni buscar, ni abrir el chat.
--
-- Va en su propia columna y NO sustituye al teléfono: una misma persona puede
-- tener los dos, y de hecho es lo normal.
--
-- Sin bloque de OWNER TO a propósito: una columna nueva hereda el dueño de su
-- tabla, y el usuario con el que se conecta el CRM no es dueño de `leads`. Ese
-- bloque hacía fallar la migración ENTERA con «must be owner of table leads»,
-- y con ella la columna, que es lo único que hace falta.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS whatsapp_usuario VARCHAR(120);

-- Para poder buscarlo desde el buscador de Prospectos sin recorrer la tabla.
CREATE INDEX IF NOT EXISTS idx_leads_whatsapp_usuario
  ON leads (lower(whatsapp_usuario))
  WHERE whatsapp_usuario IS NOT NULL AND whatsapp_usuario <> '';
