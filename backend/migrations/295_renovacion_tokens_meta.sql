-- ============================================================
-- 295: estado de la renovación diaria de los tokens de Meta e Instagram (#471)
-- ============================================================
-- Épica #464 (Instagram con IA y señales a Meta). Una tarea diaria renueva los
-- tokens de larga duración (60 días) antes de que caduquen y avisa a los admins
-- si falla o si un token caduca en menos de 7 días. Ver
-- src/jobs/metaTokensScheduler.js.
--
-- Una fila por token vigilado:
--
--   tipo = 'meta_ads'   cuenta_id = meta_ad_accounts.id   (fb_exchange_token)
--   tipo = 'instagram'  cuenta_id = ig_accounts.id        (ig_refresh_token;
--                                                          la tabla la crea #465)
--
-- Va en una tabla aparte, y no en columnas de cada cuenta, para no tocar
-- meta_ad_accounts ni adelantarse a la forma de ig_accounts (#465): las dos
-- clases de cuenta comparten así la misma lógica de avisos.
--
--   expires_at         cuándo caduca, según Meta. NULL = no se sabe o no caduca.
--   sin_caducidad      Meta dice que no caduca (usuario del sistema): no se renueva.
--   renovado_at        última renovación buena.
--   estado             'ok' | 'sin_caducidad' | 'error'.
--   ultimo_error       el mensaje de Meta (nunca el token).
--   aviso_fallo_at     ya se avisó de ESTE fallo. Se vacía cuando vuelve a ir bien,
--                      para que el siguiente fallo avise otra vez.
--   aviso_caduca_para  la caducidad de la que ya se avisó. Un token renovado tiene
--                      otra fecha y, si vuelve a acercarse, avisa de nuevo.
--
-- Sin FK a la cuenta (la columna sirve a dos tablas): las filas de cuentas
-- desconectadas las borra la propia tarea en cada vuelta.
--
-- Mismo número (295) en los dos CRMs.

CREATE TABLE IF NOT EXISTS meta_tokens_renovacion (
  id                 SERIAL PRIMARY KEY,
  tipo               VARCHAR(20) NOT NULL CHECK (tipo IN ('meta_ads', 'instagram')),
  cuenta_id          INTEGER NOT NULL,
  project_id         INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  expires_at         TIMESTAMPTZ,
  sin_caducidad      BOOLEAN NOT NULL DEFAULT FALSE,
  renovado_at        TIMESTAMPTZ,
  revisado_at        TIMESTAMPTZ,
  estado             VARCHAR(20) NOT NULL DEFAULT 'ok' CHECK (estado IN ('ok', 'sin_caducidad', 'error')),
  ultimo_error       TEXT,
  aviso_fallo_at     TIMESTAMPTZ,
  aviso_caduca_para  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tipo, cuenta_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_tokens_renovacion_project ON meta_tokens_renovacion(project_id);

-- Que el CRM pueda usarla aunque la migración la pase postgres (como la 244).
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON meta_tokens_renovacion TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE meta_tokens_renovacion_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;
