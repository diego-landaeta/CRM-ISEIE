-- Diplomas revertidos antes de enviarlos al alumno (#351).
-- (Nació como 300; renumerada a 301 al fusionar: en staging la 300 es la de las disputas de Stripe.)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ
--
-- Diego, 03/11/2026, en el CRM de producción, sobre un diploma de «Emitidos, falta
-- enviarlos al alumno» (CEDIA-2026-000011-B5HQ, emitido «con lo de Moodle»): «que en
-- esta sección se puedan revertir, porque este, por ejemplo, tiene los módulos malos;
-- reviértelo para que lo modifiquen».
--
-- Revertir lo hace Certifex (POST /api/crm/v1/revertir, su migración 0045): el número
-- se ANULA (no se borra ni se reutiliza, deja de valer en la verificación y su PDF no
-- se sirve) y la matrícula vuelve a «aprobada sin diploma»; al volver a emitir sale
-- otro número. Certifex guarda quién, cuándo y por qué. La issue pide que quede
-- también en el CRM: esto.
--
-- Una tabla de HISTORIAL y no columnas en `certifex_solicitudes`, porque una misma
-- matrícula se puede revertir más de una vez (se reemite y algo vuelve a estar mal), y
-- porque no toda matrícula tiene fila en `certifex_solicitudes` (solo las que pidió el
-- alumno o se editaron).
--
--   · `nexpediente`: el número anulado. Único: un número solo se anula una vez.
--   · `matricula_id`: la matrícula de Certifex a la que pertenecía (la busca el
--     servidor en Certifex, no la dice el navegador). NULL si no se encontró.
--   · `revertido_por`: el usuario del CRM con sesión; `revertido_por_email`, su correo
--     tal cual se mandó a Certifex (queda aunque se borre el usuario).
--   · `revertido_en`: cuándo lo anuló Certifex (su hora, no la del apunte).
--
-- Se apunta DESPUÉS de que Certifex acepte, nunca antes: lo que está aquí pasó.
--
-- Reaplicable: todo va con IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS certifex_reversiones (
  id                   SERIAL PRIMARY KEY,
  nexpediente          TEXT NOT NULL UNIQUE,
  matricula_id         BIGINT,
  centro               TEXT NOT NULL,
  alumno               TEXT,
  titulacion           TEXT,
  motivo               TEXT NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 1 AND 500),
  revertido_por        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  revertido_por_email  TEXT NOT NULL,
  revertido_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  apuntado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- «Aprobados sin diploma» enseña la última reversión de cada matrícula.
CREATE INDEX IF NOT EXISTS idx_certifex_reversiones_matricula
  ON certifex_reversiones (matricula_id, revertido_en DESC);

-- Las migraciones se pasan como `postgres` (docs/README.md): sin esto el CRM no podría
-- apuntar las reversiones. Lo mismo que las demás tablas nuevas (p. ej. la 274).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON certifex_reversiones TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE certifex_reversiones_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;
