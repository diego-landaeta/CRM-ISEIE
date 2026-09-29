-- 171 · Las novedades de cada versión: cuándo y a quién se mandaron
--
-- Diego, 28/09: «esta es la versión 2.0.0… a todos por la app y por correo…
-- primero me lo mandas a mí y luego, al subirlo, se mandará».
--
-- El contenido NO vive aquí: está en `modules/novedades/versiones.js`, con el
-- código de esa versión. Aquí solo se apunta cada envío. El índice único hace
-- que el envío al EQUIPO salga una sola vez por versión aunque la API arranque
-- dos veces a la vez; las pruebas se pueden repetir.

BEGIN;

CREATE TABLE IF NOT EXISTS novedades_envios (
  id           SERIAL PRIMARY KEY,
  version      VARCHAR(20)  NOT NULL,
  alcance      VARCHAR(10)  NOT NULL CHECK (alcance IN ('prueba', 'equipo')),
  enviado_por  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  personas     INTEGER      NOT NULL DEFAULT 0,
  correos      INTEGER      NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS novedades_envios_al_equipo_una_vez
  ON novedades_envios (version) WHERE alcance = 'equipo';

-- Se corre como postgres: el usuario del CRM necesita permiso para usarla.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON novedades_envios TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE novedades_envios_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
