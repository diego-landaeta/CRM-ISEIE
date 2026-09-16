-- El identificador de WhatsApp es unico POR CONVERSACION, no en toda la tabla.
--
-- EL FALLO
--   El indice era `UNIQUE (wa_id) WHERE wa_id IS NOT NULL`, global. Pero el
--   mismo mensaje llega a TODAS las sesiones que lo reciben, con el MISMO wa_id:
--
--     · Dos gestoras en el mismo grupo de WhatsApp. Las dos reciben el mensaje.
--       Con el indice global, la primera que llega se lo queda y a la otra el
--       INSERT le hace conflicto: en su pantalla ESE MENSAJE NO EXISTE.
--     · Y con un numero enlazado en dos sesiones, los mensajes se reparten al
--       azar entre las dos conversaciones. Medido: el grupo «Soporte ISEIE»
--       tenia el texto en una conversacion y el siguiente mensaje en la otra,
--       asi que ninguna de las dos enseñaba la conversacion entera.
--
--   No se ve hasta que hay dos sesiones mirando el mismo chat, que es
--   exactamente lo que pasa con los grupos (#74).
--
-- POR QUE ES SEGURO
--   `actualizarEstado` busca por `wa_id` sin conversacion, asi que un acuse
--   sigue marcando las dos copias del mismo mensaje — que es lo correcto: es el
--   mismo mensaje visto por dos sesiones.
BEGIN;

DROP INDEX IF EXISTS uq_wa_mensajes_waid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_mensajes_conv_waid
  ON wa_mensajes (conversacion_id, wa_id) WHERE wa_id IS NOT NULL;

-- Se conserva un indice por `wa_id` solo, sin unicidad: lo usan los acuses de
-- entrega y la busqueda del mensaje citado, y sin el pasarian a recorrer tabla.
CREATE INDEX IF NOT EXISTS idx_wa_mensajes_waid
  ON wa_mensajes (wa_id) WHERE wa_id IS NOT NULL;

COMMIT;
