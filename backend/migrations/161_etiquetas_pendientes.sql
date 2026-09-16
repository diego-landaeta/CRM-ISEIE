-- Portada desde MultiCRM el 16/09/2026. Alli es la 169; aqui la serie va
-- por otro numero. Diego: «en ISEIE nadie esta usando el whatsapp,
-- tampoco en 360 porque estamos haciendo pruebas ahi, asi que adelante,
-- dejalo a la par».

-- Las etiquetas que llegan ANTES que su conversacion (#128, #138).
--
-- Al enlazar, WhatsApp manda las cosas en este orden: primero la sincronizacion
-- del estado —donde van las etiquetas y en que chat esta cada una— y despues el
-- historial, que es lo que crea las conversaciones en el CRM.
--
-- O sea que cuando llega «la etiqueta 12 va en el chat de Marta», el chat de
-- Marta todavia NO EXISTE aqui. Hasta ahora eso se tiraba con un «esa
-- conversacion no esta en el CRM», y el aviso no se repite: la etiqueta se
-- perdia para siempre.
--
-- Y no hay forma de recuperarla preguntando. Comprobado en el codigo de
-- Evolution 2.3.7: guarda las etiquetas de cada chat en su columna
-- `Chat.labels`, pero NINGUN endpoint las devuelve — `findLabels` da el
-- catalogo y `findChats` no incluye esa columna en su SELECT. La unica fuente
-- son los avisos en vivo, y solo pasan una vez.
--
-- Con una cuenta normal esto no se nota: no hay etiquetas que traer. Con una de
-- WhatsApp Business —que es donde el #138 tiene sentido— se perderia el trabajo
-- de clasificacion de la gestora entero, en silencio, justo al enlazar.
--
-- Asi que se guardan aqui y se aplican cuando su conversacion aparece.

BEGIN;

CREATE TABLE IF NOT EXISTS wa_etiquetas_pendientes (
  id         SERIAL       PRIMARY KEY,

  instancia  VARCHAR(60)  NOT NULL,
  -- El jid y no la conversacion, que es justo lo que todavia no hay.
  jid        VARCHAR(120) NOT NULL,
  -- El id de la etiqueta en WhatsApp. Puede que tampoco se conozca aun: se
  -- resuelve al aplicarla.
  wa_id      VARCHAR(60)  NOT NULL,

  -- Si lo que quedo pendiente era ponerla o quitarla. Llega poco, pero llega:
  -- entre el aviso y la conversacion puede haber un «quitar» que anule al
  -- «poner» anterior, y aplicar solo el primero dejaria una etiqueta que la
  -- gestora ya habia retirado.
  poner      BOOLEAN      NOT NULL DEFAULT TRUE,

  creada_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Lo ultimo que se dijo de esa etiqueta en ese chat es lo que vale.
  CONSTRAINT uq_wa_etiqueta_pendiente UNIQUE (instancia, jid, wa_id)
);

-- Se consulta al nacer una conversacion, por su jid.
CREATE INDEX IF NOT EXISTS idx_wa_etiq_pendientes_jid
  ON wa_etiquetas_pendientes (instancia, jid);

COMMIT;

-- El #71: esta migracion la corre `postgres` —las tablas viejas son suyas— y
-- eso hace que la tabla NUEVA nazca siendo de postgres, con el usuario del CRM
-- sin poder ni leerla. Se le da acceso al que exista en esta instalacion.
DO $$
DECLARE rol TEXT; tab TEXT;
BEGIN
  FOREACH rol IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
      FOREACH tab IN ARRAY ARRAY['wa_etiquetas_pendientes'] LOOP
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
