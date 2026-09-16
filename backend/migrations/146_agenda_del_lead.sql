-- La agenda de cada prospecto: qué paso del proceso le toca y qué día.
--
-- Hasta ahora `commercial_steps` describía el proceso EN GENERAL —«el paso 2 es
-- al tercer día, por llamada»— pero el CRM no sabía que a María le toca el paso
-- 2 HOY. Eso es lo único que faltaba para que el proceso sirva de algo: sin
-- esto no hay cola del día (#90) ni «qué toca con este lead» en su ficha (#89).
--
-- Se escribe al entrar el prospecto, no se calcula al vuelo. Calcularlo valdría
-- para leer, pero no para trabajar: no deja ver la agenda por delante —«el
-- jueves tengo doce del paso 3»—, ni mover la fecha de una persona concreta,
-- ni saber por qué a alguien se le saltó uno.
--
-- LA FECHA SE CUENTA DESDE `fecha_solicitud`, NO DESDE `created_at`. En ISEIE
-- 11.664 de 17.384 prospectos (67 %) tienen la solicitud anterior al alta,
-- porque el CRM se cargó el 27/05 con histórico desde enero de 2025. Con
-- `created_at` miles de personas caerían en el paso equivocado el primer día.
--
-- QUÉ NO GUARDA ESTA TABLA: si el paso está hecho. Eso se deduce de los
-- contactos reales —el contacto nº N cierra el paso nº N—, que es la misma
-- regla que usa el embudo de Reportes. Un plan que hay que mantener a mano
-- acaba mintiendo, y de ahí no se vuelve. Aquí solo vive lo que una persona
-- decide a propósito: saltarse un paso o cambiarle la fecha.

CREATE TABLE IF NOT EXISTS lead_steps (
  id              SERIAL PRIMARY KEY,
  lead_id         INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  -- Se repite el proyecto aunque salga del lead: la cola del día filtra por
  -- proyecto y sin esto habría que cruzar con `leads` en cada consulta.
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- El paso del que salió. Si alguien lo borra de la configuración, la agenda
  -- ya escrita no se cae: se queda con su `clave` y su `orden`.
  step_id         INTEGER REFERENCES commercial_steps(id) ON DELETE SET NULL,
  clave           VARCHAR(50) NOT NULL,
  orden           SMALLINT NOT NULL,
  fecha_prevista  DATE NOT NULL,
  -- 'pendiente' es lo normal. 'saltado' lo pone una persona a propósito.
  -- «Hecho» NO está aquí a propósito: ver la nota de arriba.
  estado          VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  -- Por qué se movió o se saltó. Lo escribe quien lo hace.
  nota            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Por `clave` y no por `step_id`: la clave es estable aunque el paso se
  -- borre y se vuelva a crear, y así replanificar no duplica filas.
  CONSTRAINT lead_steps_unico UNIQUE (lead_id, clave)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_steps_estado_valido') THEN
    ALTER TABLE lead_steps ADD CONSTRAINT lead_steps_estado_valido
      CHECK (estado IN ('pendiente', 'saltado'));
  END IF;
END $$;

-- La consulta de la cola del día: «qué hay para hoy en este proyecto».
CREATE INDEX IF NOT EXISTS idx_lead_steps_cola
  ON lead_steps (project_id, fecha_prevista, estado);
-- Y la de la ficha: «qué le toca a esta persona», en orden.
CREATE INDEX IF NOT EXISTS idx_lead_steps_lead
  ON lead_steps (lead_id, orden);

-- Permisos (#71). En producción las tablas son de `postgres`, así que las
-- migraciones corren como postgres y lo que crean nace siendo suyo. Sin este
-- bloque el CRM se encuentra un «permission denied» sobre una tabla que acaba
-- de aparecer. Se comprueba SIEMPRE con el usuario del CRM, nunca con postgres,
-- que lo ve todo.
DO $$
DECLARE
  u TEXT;
BEGIN
  FOREACH u IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = u) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON lead_steps TO %I', u);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE lead_steps_id_seq TO %I', u);
    END IF;
  END LOOP;
END $$;
