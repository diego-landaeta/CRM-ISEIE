-- Portada desde MultiCRM el 16/09/2026. Alli es la 168; aqui la serie va
-- por otro numero. Diego: «en ISEIE nadie esta usando el whatsapp,
-- tampoco en 360 porque estamos haciendo pruebas ahi, asi que adelante,
-- dejalo a la par».

-- Las etiquetas de WhatsApp, dentro del CRM (#128 punto 2, y #138).
--
-- Diego: «poder extraer las etiquetas de WhatsApp y nosotros poner etiquetas
-- para ese funcionamiento». Las gestoras ya organizan sus chats con etiquetas y
-- el CRM las ignoraba: quien mira la ficha no ve lo que la gestora ya sabe.
--
-- NO SE CONFUNDEN CON LAS DEL CRM. En la pantalla del chat ya hay algo que se
-- llama «etiqueta» (#72) y es el ESTADO del prospecto: pendiente de contestar,
-- ya vendido, no interesado. Eso viaja con la persona y lo decide el CRM. Estas
-- otras viven en el movil de la gestora y las decide ella. Son dos cosas y se
-- enseñan las dos, sin que una pise a la otra.
--
-- POR QUE UNA COPIA Y NO PREGUNTARLE A EVOLUTION CADA VEZ. Dos motivos, y los
-- dos comprobados en su codigo (etiqueta 2.3.7):
--
--   1. `findLabels` lee de la base de Evolution, que solo se llena si tiene
--      `DATABASE_SAVE_DATA_LABELS` encendido. Con esa opcion apagada devuelve
--      lista vacia aunque el movil tenga veinte etiquetas — el mismo tropiezo
--      que ya costo los audios («Message not found» por SAVE_DATA_NEW_MESSAGE).
--      Los avisos, en cambio, llegan siempre.
--
--   2. Evolution GUARDA el nombre pelado —`name.replace(/[^\x20-\x7E]/g, '')`,
--      whatsapp.baileys.service.ts:1828— pero MANDA el aviso con el nombre
--      entero. O sea que «Presupuesto ✅» se queda en «Presupuesto » en su base
--      y llega completo por el webhook. Si el CRM se fiara de `findLabels`,
--      perderia los acentos y los emojis de las etiquetas de la gestora.
--
-- Asi que manda el aviso, y `findLabels` solo sirve para la primera carga.

BEGIN;

CREATE TABLE IF NOT EXISTS wa_etiquetas (
  id          SERIAL      PRIMARY KEY,

  -- De quien es. Las etiquetas son del movil de cada gestora, no del CRM: dos
  -- personas pueden tener una «Urgente» que no es la misma.
  instancia   VARCHAR(60) NOT NULL,
  -- El id que le da WhatsApp. Es el que viaja en los avisos de asociacion.
  wa_id       VARCHAR(60) NOT NULL,

  nombre      VARCHAR(160) NOT NULL,
  -- WhatsApp manda un numero de paleta, no un color. Se guarda tal cual y quien
  -- pinta decide: inventarse aqui un #RRGGBB seria fijar hoy una paleta que
  -- luego no se puede cambiar sin tocar los datos.
  color       VARCHAR(20),

  -- Borrar de verdad se llevaria por delante el historial de que estuvo puesta.
  -- Se marca, y deja de ofrecerse.
  borrada     BOOLEAN     NOT NULL DEFAULT FALSE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_wa_etiqueta UNIQUE (instancia, wa_id)
);

CREATE TABLE IF NOT EXISTS wa_conversacion_etiquetas (
  conversacion_id INTEGER     NOT NULL REFERENCES wa_conversaciones(id) ON DELETE CASCADE,
  etiqueta_id     INTEGER     NOT NULL REFERENCES wa_etiquetas(id)      ON DELETE CASCADE,
  puesta_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversacion_id, etiqueta_id)
);

-- Para pintar la lista de chats: se piden las etiquetas de 50 conversaciones de
-- golpe, no de una en una.
CREATE INDEX IF NOT EXISTS idx_wa_conv_etiq_conv
  ON wa_conversacion_etiquetas (conversacion_id);
-- Y para el camino contrario: «enseñame los chats con esta etiqueta».
CREATE INDEX IF NOT EXISTS idx_wa_conv_etiq_etiq
  ON wa_conversacion_etiquetas (etiqueta_id);

COMMIT;

-- El #71: esta migracion la corre `postgres` —las tablas viejas son suyas— y
-- eso hace que las tablas NUEVAS nazcan siendo de postgres, con el usuario del
-- CRM sin poder ni leerlas. Se le da acceso al que exista en esta instalacion.
DO $$
DECLARE rol TEXT; tab TEXT;
BEGIN
  FOREACH rol IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
      FOREACH tab IN ARRAY ARRAY['wa_etiquetas', 'wa_conversacion_etiquetas'] LOOP
        IF to_regclass('public.' || tab) IS NOT NULL THEN
          EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', tab, rol);
          IF to_regclass('public.' || tab || '_id_seq') IS NOT NULL THEN
            EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO %I', tab || '_id_seq', rol);
          END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;
