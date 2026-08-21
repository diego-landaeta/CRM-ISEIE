-- A que mensaje responde cada mensaje.
--
-- Responder citando ya funciona: al otro lado sale con la cita encima, como en
-- WhatsApp. Lo que faltaba era verlo en NUESTRO propio chat — la respuesta
-- aparecia suelta, sin decir a que contestaba, y en una conversacion movida eso
-- es justo la mitad de la informacion.
--
-- Se guarda el identificador de WhatsApp (wa_id) del mensaje citado, no nuestro
-- id: es lo unico que WhatsApp manda cuando alguien nos responde a nosotros, y
-- puede referirse a un mensaje que todavia no tengamos guardado.

ALTER TABLE wa_mensajes
  ADD COLUMN IF NOT EXISTS responde_a VARCHAR(120);

-- Para resolver la cita al pintar el hilo: se busca el mensaje citado por su
-- wa_id dentro de la misma conversacion.
CREATE INDEX IF NOT EXISTS idx_wa_mensajes_responde
  ON wa_mensajes (responde_a) WHERE responde_a IS NOT NULL;

-- Sin clave ajena a proposito.
--
-- El mensaje citado puede no estar en nuestra base: alguien responde a algo de
-- hace un ano que nunca se sincronizo, o a un mensaje de antes de enlazar. Con
-- una clave ajena eso reventaria el guardado del mensaje entero — se perderia
-- la respuesta por no tener la pregunta. Cuando no esta, se pinta sin cita.
