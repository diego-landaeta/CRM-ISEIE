-- Quien acepto enlazar un numero, y cuando.
--
-- Enlazar por esta via no es la forma oficial de WhatsApp: el numero puede
-- acabar bloqueado, y quien lo pone es una persona con su telefono, no la
-- empresa. La pantalla obliga a marcar una casilla antes de ensenar el codigo,
-- pero una casilla sin registro no vale nada el dia que alguien diga «a mi
-- nadie me aviso».
--
-- Cierra el punto 1 de la tarea #45.

CREATE TABLE IF NOT EXISTS wa_consentimientos (
  id            SERIAL PRIMARY KEY,

  -- DE QUIEN es la linea que se enlaza.
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- QUIEN pulso. Casi siempre el mismo, pero no siempre: un administrador puede
  -- enlazar el numero de una gestora que tiene al lado con el movil en la mano.
  -- Y esa diferencia es justo lo que hay que poder ver despues, porque entonces
  -- la duena de la linea NO leyo el aviso: lo leyo quien pulso por ella.
  aceptado_por  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- La sesion: crm-u7, crm-u12... Va aparte del user_id porque es el nombre que
  -- aparece en los registros del servicio de WhatsApp, y asi se pueden cruzar.
  instancia     VARCHAR(60) NOT NULL,

  -- Version del aviso aceptado. Al cambiar el texto se sube este numero: hay que
  -- poder saber QUE leyo cada persona, no solo que acepto algo alguna vez.
  version_aviso INTEGER NOT NULL DEFAULT 1,

  -- Desde donde. Distingue un «no me avisaron» de verdad de uno de memoria.
  ip            VARCHAR(60),
  navegador     TEXT,

  aceptado_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Para responder «¿acepto esta persona, y cuando fue la ultima vez?».
CREATE INDEX IF NOT EXISTS idx_wa_consent_user
  ON wa_consentimientos (user_id, aceptado_at DESC);

-- NO se pone unico por usuario a proposito: cada emparejamiento deja su linea.
-- Si alguien desvincula y vuelve a enlazar seis meses despues, son dos
-- decisiones distintas y las dos tienen que quedar escritas.

-- El duenno de las tablas.
--
-- Sin esto, la migracion 122 fallo en el servidor con «permission denied»: las
-- tablas quedaban a nombre de quien lanzo el script y la aplicacion, que entra
-- con otro usuario, no podia ni leerlas.
DO $$
DECLARE
  duenno TEXT;
BEGIN
  SELECT tableowner INTO duenno FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'users';
  IF duenno IS NOT NULL AND duenno <> '' THEN
    EXECUTE format('ALTER TABLE wa_consentimientos OWNER TO %I', duenno);
    EXECUTE format('ALTER SEQUENCE wa_consentimientos_id_seq OWNER TO %I', duenno);
  END IF;
END $$;
