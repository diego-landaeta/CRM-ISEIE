-- ─────────────────────────────────────────────────────────────────────────────
-- 308 · El alumno confirma sus datos antes de emitir el diploma
--       (gemela de diego-landaeta/CRM#847; en el 360 es la 291)
--
-- Automatizaciones 5/9 (Manuel, 13/11/2026). Antes de emitir, el CRM le manda al
-- alumno un enlace con los datos que saldrán en el diploma (nombre completo,
-- documento, curso, horas y fecha) para que los confirme o corrija él mismo.
-- Plazo, 7 días; sin respuesta, se emite con los datos que hay (eso está decidido).
--
--   diploma_confirmaciones      una fila viva por matrícula de Certifex.
--     matricula_id / centro     la matrícula y su campus en Certifex.
--     token_hash                sha256 del enlace. El enlace en claro NO se guarda:
--                               solo viaja en el correo.
--     estado                    pendiente  → enlace mandado, esperando
--                               confirmado → el alumno dice que todo está bien
--                               corregido  → el alumno cambió nombre o documento
--                               vencido    → 7 días sin respuesta: vale lo que hay
--                               anulado    → se pidió otra vez o se descartó
--     *_propuesto, curso_nombre, horas, fecha_diploma
--                               lo que se le enseñó al alumno.
--     *_confirmado, comentario  lo que contestó.
--     aplicado_at / aplicar_error
--                               el nombre y el documento corregidos se pasan a
--                               Certifex (que es quien imprime). Sin esto, no se
--                               emite: saldría lo de antes.
--     nexpediente, emitido_at, datos_emision, diploma_enviado_at
--                               con qué datos salió el diploma y cuándo se envió:
--                               lo que pide la issue para reenviarlo o comprobarlo
--                               después sin depender de los 90 días de Brevo.
--
-- El documento se guarda aquí porque la issue pide guardar en el CRM con qué datos
-- se emitió cada diploma. Sigue viviendo en Certifex; esto es el registro.
--
-- Todo detrás de DIPLOMA_CONFIRMACION_ACTIVA (apagado de serie): sin el interruptor
-- esta tabla se queda vacía y la emisión no cambia.
--
-- Se puede pasar dos veces (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS diploma_confirmaciones (
  id                    SERIAL PRIMARY KEY,
  matricula_id          BIGINT NOT NULL,
  centro                TEXT NOT NULL,
  project_id            INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  lead_id               INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  token_hash            CHAR(64),
  estado                VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  caduca_at             TIMESTAMPTZ NOT NULL,
  intentos              INTEGER NOT NULL DEFAULT 0,
  -- Lo que se le enseña al alumno.
  nombre_propuesto      TEXT,
  documento_propuesto   TEXT,
  curso_nombre          TEXT,
  horas                 INTEGER,
  fecha_diploma         DATE,
  -- Lo que contesta.
  nombre_confirmado     TEXT,
  documento_confirmado  TEXT,
  comentario            TEXT,
  respondido_at         TIMESTAMPTZ,
  respondido_ip         VARCHAR(64),
  -- Lo corregido, pasado a Certifex.
  aplicado_at           TIMESTAMPTZ,
  aplicar_error         TEXT,
  -- El correo con el enlace.
  enviado_a             TEXT,
  enviado_at            TIMESTAMPTZ,
  envio_error           TEXT,
  envio_simulado        BOOLEAN NOT NULL DEFAULT false,
  -- El diploma que salió con estos datos.
  nexpediente           TEXT,
  emitido_at            TIMESTAMPTZ,
  datos_emision         JSONB,
  diploma_enviado_at    TIMESTAMPTZ,
  pedido_por            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diploma_confirmaciones_estado_ck') THEN
    ALTER TABLE diploma_confirmaciones ADD CONSTRAINT diploma_confirmaciones_estado_ck
      CHECK (estado IN ('pendiente', 'confirmado', 'corregido', 'vencido', 'anulado'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diploma_confirmaciones_datos_emision_ck') THEN
    ALTER TABLE diploma_confirmaciones ADD CONSTRAINT diploma_confirmaciones_datos_emision_ck
      CHECK (datos_emision IS NULL OR jsonb_typeof(datos_emision) = 'object');
  END IF;
END $$;

-- Una confirmación viva por matrícula.
CREATE UNIQUE INDEX IF NOT EXISTS uq_diploma_confirmaciones_matricula
  ON diploma_confirmaciones (matricula_id) WHERE estado <> 'anulado';
CREATE UNIQUE INDEX IF NOT EXISTS uq_diploma_confirmaciones_token
  ON diploma_confirmaciones (token_hash) WHERE token_hash IS NOT NULL;
-- El vigilante del día 7 solo mira las pendientes.
CREATE INDEX IF NOT EXISTS idx_diploma_confirmaciones_pendientes
  ON diploma_confirmaciones (caduca_at) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_diploma_confirmaciones_nexpediente
  ON diploma_confirmaciones (nexpediente) WHERE nexpediente IS NOT NULL;

COMMENT ON TABLE diploma_confirmaciones IS
  'El alumno confirma o corrige los datos de su diploma antes de emitirlo (#768), y con qué datos salió.';

-- La tabla es del usuario de la app, no de quien aplica la migración (como en la 199).
DO $$
DECLARE dueno text;
BEGIN
  SELECT tableowner INTO dueno FROM pg_tables WHERE schemaname = 'public' AND tablename = 'leads';
  IF dueno IS NOT NULL THEN
    EXECUTE format('ALTER TABLE diploma_confirmaciones OWNER TO %I', dueno);
    EXECUTE format('ALTER SEQUENCE diploma_confirmaciones_id_seq OWNER TO %I', dueno);
  END IF;
END $$;

-- Y los permisos del usuario de la app, por si la tabla la crea otro (como en la 230).
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON diploma_confirmaciones TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE diploma_confirmaciones_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;
