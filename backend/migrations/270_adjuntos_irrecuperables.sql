-- 270 · Adjuntos de WhatsApp que ya no se pueden bajar (#365, gemela de CRM#638, donde es la 240)
--
-- Auditoría del 03/11: 3.252 errores en 7 días de `/chat/getBase64FromMediaMessage` («Message not
-- found»), en ráfagas de 130 o 260 que coinciden con los despliegues. Al arrancar, el CRM volvía a
-- pedir TODOS los mensajes sin archivo, también los que Evolution ya no tiene y nunca va a tener.
--
-- Se cuentan los intentos de cada adjunto y, al llegar al tope (WA_MEDIA_INTENTOS, 3 por defecto), se
-- marca como irrecuperable: ni el arranque ni el botón de reintentar lo vuelven a pedir.
-- Se puede pasar dos veces.

ALTER TABLE wa_mensajes ADD COLUMN IF NOT EXISTS media_intentos SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE wa_mensajes ADD COLUMN IF NOT EXISTS media_irrecuperable BOOLEAN NOT NULL DEFAULT FALSE;

-- La búsqueda de pendientes al arrancar filtra por estas dos condiciones.
CREATE INDEX IF NOT EXISTS idx_wa_mensajes_media_pendiente
  ON wa_mensajes (conversacion_id)
  WHERE media_url IS NULL AND NOT media_irrecuperable;
