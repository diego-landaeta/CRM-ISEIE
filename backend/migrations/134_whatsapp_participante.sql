-- Quien escribio cada mensaje de un grupo.
--
-- En un chat de una persona sobra: el jid de la conversacion YA es ella. En un
-- grupo no: hablan muchos, y sin esto todos los mensajes salen iguales. Una
-- gestora que abre el grupo de Psiko no puede saber quien dijo que, que es la
-- mitad de para que sirve leer un grupo.
--
-- No se guardaba porque el modulo nacio pensando solo en conversaciones de uno
-- a uno. Se ve en cuanto entra el primer grupo de verdad.
--
-- Van dos columnas y no una: el jid es lo estable —no cambia nunca— y el nombre
-- es lo que se enseña. Guardar solo el nombre dejaria mensajes huerfanos el dia
-- que alguien se cambie el suyo; guardar solo el jid obligaria a resolverlo en
-- cada pintada.
ALTER TABLE wa_mensajes
  ADD COLUMN IF NOT EXISTS participante        VARCHAR(80),
  ADD COLUMN IF NOT EXISTS participante_nombre VARCHAR(120);

COMMENT ON COLUMN wa_mensajes.participante IS
  'Jid de quien escribio, SOLO en grupos. Null en conversaciones de una persona.';
COMMENT ON COLUMN wa_mensajes.participante_nombre IS
  'Como se llamaba al guardarlo. Se enseña tal cual; el jid es lo que identifica.';
