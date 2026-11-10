-- CRM-ISEIE 249 = MultiCRM 145 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- 145 · Lo que cuesta la IA, apuntado (#30, y sobre todo #22)
--
-- Hoy hay DOS sitios que llaman a Anthropic —el chat (`claude-chat`) y el
-- reporte mensual (`reports-ia`)— y ninguno de los dos lleva la cuenta de lo
-- que gasta. El chat incluso recibe los tokens de cada respuesta y los guarda
-- en la fila del mensaje, pero nadie los suma nunca. Asi que hoy la pregunta
-- «¿cuanto llevamos gastado este mes?» no tiene respuesta dentro del CRM: hay
-- que ir a mirar la factura.
--
-- El issue #22 lo dice tal cual: «Sin tope no se enciende: una consulta suelta
-- puede costar lo que nadie miro». Esta tabla es la mitad del tope. La otra
-- mitad es `shared/services/gastoIA.service.js`, que suma y corta.
--
-- SE APUNTA UNA FILA POR LLAMADA, TAMBIEN LAS QUE FALLAN A MEDIAS
--
-- Una respuesta cortada por un error de red ya gasto los tokens de entrada:
-- Anthropic los cobra igual. Si solo se apuntaran las que terminan bien, el
-- contador iria por debajo de la factura, y un tope que va por debajo de la
-- factura no es un tope — es una sensacion.
--
-- EL COSTE ES UNA ESTIMACION Y LA COLUMNA LO DICE
--
-- Los tokens son un hecho: los manda la API en `usage`. El dinero es una
-- cuenta que hacemos aqui con una tabla de precios que puede quedarse vieja o
-- no conocer un modelo nuevo. Por eso van separados, y por eso hay
-- `precio_incierto`: cuando el modelo no esta en la tabla se cobra al precio
-- del mas caro que conocemos y se marca. Preferimos frenar antes de tiempo a
-- pasarnos sin enterarnos.
--
-- EN DOLARES, NO EN EUROS
--
-- Anthropic factura en USD. Convertir aqui con un cambio fijo seria inventarse
-- un numero que ademas se mueve solo. El resto del CRM va en euros; esto no, y
-- las pantallas tienen que decirlo.

BEGIN;

CREATE TABLE IF NOT EXISTS ia_gasto (
  id            BIGSERIAL PRIMARY KEY,

  -- Nulo a proposito: hay llamadas que no son de ningun proyecto (el chat sin
  -- proyecto elegido). El tope de hoy es global, asi que esto es para poder
  -- mirar el desglose despues, no para filtrar el tope.
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- 'chat' | 'reporte' | 'analisis' — de donde salio la llamada. Sin esto,
  -- «nos hemos pasado» no se puede convertir en «el reporte mensual se esta
  -- comiendo el tope».
  origen        VARCHAR(30) NOT NULL,
  modelo        VARCHAR(80) NOT NULL,

  tokens_entrada           INTEGER NOT NULL DEFAULT 0,
  tokens_salida            INTEGER NOT NULL DEFAULT 0,
  -- La cache se cobra distinto (leer ~0.1x, escribir ~1.25x). Se guardan
  -- aparte para que la cuenta sea la de verdad y no una media.
  tokens_cache_lectura     INTEGER NOT NULL DEFAULT 0,
  tokens_cache_escritura   INTEGER NOT NULL DEFAULT 0,

  coste_usd        NUMERIC(12, 6) NOT NULL DEFAULT 0,
  precio_incierto  BOOLEAN NOT NULL DEFAULT FALSE,

  -- Si la llamada se corto, que paso. Nulo = termino bien.
  fallo         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- La consulta que se hace en CADA llamada antes de gastar es «suma del mes en
-- curso». Sin este indice, eso es un recorrido entero de la tabla justo en el
-- camino caliente del chat.
CREATE INDEX IF NOT EXISTS idx_ia_gasto_fecha ON ia_gasto (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ia_gasto_proyecto ON ia_gasto (project_id, created_at DESC);

COMMENT ON TABLE ia_gasto IS
  'Una fila por llamada a la API de IA. La suma del mes es el tope de #22. coste_usd es estimado; los tokens son el dato de verdad.';
COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- DESPUES DE APLICAR ESTO
--
-- El tope no se enciende solo. Hay que poner en el .env del servidor:
--
--     IA_TOPE_MENSUAL_USD=20
--
-- Sin esa variable el servicio usa 20 USD por defecto y lo dice en el arranque.
-- Con `IA_TOPE_MENSUAL_USD=0` no hay tope (se sigue apuntando el gasto).
--
-- MIENTRAS ESTA MIGRACION NO ESTE APLICADA el codigo NO falla: mira si la
-- tabla existe, avisa una vez en el log y deja pasar las llamadas. Es decir,
-- el CRM sigue igual que hoy —sin tope— hasta que esto corra. Se puede ver en
-- GET /api/ia/gasto, que contesta `instalado: false` para que no haya que
-- adivinarlo.
-- ─────────────────────────────────────────────────────────────────────────────

-- El #71: esta migracion la corre `postgres` —las tablas viejas son suyas— y
-- eso hace que la tabla NUEVA nazca siendo de postgres, con el usuario del CRM
-- sin poder ni leerla. Se le da acceso al que exista en esta instalacion.
DO $$
DECLARE rol TEXT; tab TEXT;
BEGIN
  FOREACH rol IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
      FOREACH tab IN ARRAY ARRAY['ia_gasto', 'ia_gasto_topes'] LOOP
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

-- Permisos del CRM sobre la tabla nueva (la migración se pasa como postgres).
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ia_gasto TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE ia_gasto_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;
