-- Portada desde MultiCRM el 16/09/2026. Alli es la 170; aqui la serie va
-- por otro numero. Diego: «en ISEIE nadie esta usando el whatsapp,
-- tampoco en 360 porque estamos haciendo pruebas ahi, asi que adelante,
-- dejalo a la par».

-- El identificador «@lid» de cada conversacion (#128, #138).
--
-- WhatsApp esta pasando a direccionar por `@lid` —un identificador que ocupa el
-- lugar del telefono sin revelarlo—. Una misma persona aparece con las dos
-- llaves segun lo que mande WhatsApp, y hasta ahora el CRM solo guardaba una.
--
-- POR QUE MUERDE. El aviso de «esta etiqueta va en este chat» llega con el jid
-- que WhatsApp tenga a mano, y en el caso real llego asi:
--
--     etiqueta add: 4 en 16699034202151@lid
--
-- mientras esa persona estaba guardada como `584242439474@s.whatsapp.net`. No
-- casa, y la etiqueta se queda fuera.
--
-- Y hay una diferencia entre entornos que lo hace peor: el puente de Baileys
-- traduce el `@lid` a telefono antes de mandarlo (`aTelefono`), pero Evolution
-- guarda la clave «tal como viene de Baileys» y no traduce nada. O sea que las
-- conversaciones se guardan por numero en local y por `@lid` en produccion: la
-- asociacion casaria alli y no aqui. Probar en local no diria la verdad.
--
-- LA SALIDA. El par viaja en la propia clave del mensaje —`remoteJidAlt` o
-- `senderPn`—, asi que se aprende solo con el primer mensaje y se apunta aqui.
-- Con las dos llaves guardadas, la etiqueta encuentra su chat venga como venga.
--
-- Sin esta migracion no se rompe nada: las etiquetas que lleguen por `@lid` se
-- quedan esperando en `wa_etiquetas_pendientes` (migracion 158) en vez de
-- perderse, y se aplicaran cuando el chat aparezca con esa llave.

BEGIN;

ALTER TABLE wa_conversaciones ADD COLUMN IF NOT EXISTS lid VARCHAR(120);

COMMENT ON COLUMN wa_conversaciones.lid IS
  'La OTRA llave de esta misma conversacion: el identificador @lid si el chat se guardo por telefono, o el telefono si se guardo por @lid. Se aprende de la clave del mensaje (remoteJidAlt / senderPn).';

-- Para buscar la conversacion por su otra llave, que es justo lo que hace falta
-- al colocar una etiqueta.
CREATE INDEX IF NOT EXISTS idx_wa_conversaciones_lid
  ON wa_conversaciones (instancia, lid)
  WHERE lid IS NOT NULL;

COMMIT;
