-- 243 · Asignación de leads por actividad (Carlos y Diego, 27/10/2026; CRM#513)
--
-- «Una gestora está activa si ha hecho al menos una acción válida en los
-- últimos 15 minutos.» Con alguna activa, el CRM crea el lead con ella y lo
-- manda al ESCENARIO 2 de Make (sin la rotación por HTTP); sin ninguna, lo
-- manda al ESCENARIO 1 (el de siempre, que lo crea como hoy).
--
--  · asignacion_destinos: por campus, empresa o todas (como el webhook de
--    transferencias, 206). El destino de cada escenario puede ser un mailhook
--    (una dirección de correo de Make) o un webhook (una URL), cifrado. La
--    entrada de Make llama al CRM con su clave (en la base, solo la huella).
--  · asignacion_decisiones: cada formulario que entra, a quién y por qué, y el
--    envío al escenario con sus reintentos. Único por campus y uid del
--    formulario: si Make reintenta, no se decide ni se crea dos veces.
--  · actividad_crm: lo que hace una gestora y no guarda quién lo hizo (crear un
--    lead, una venta, un cobro, una matrícula, una factura…). Lo demás se lee
--    de sus propias tablas (interacciones, estados, recordatorios, pasos,
--    ediciones, WhatsApp).
--
-- Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS asignacion_destinos (
    id                SERIAL       PRIMARY KEY,
    nombre            VARCHAR(150) NOT NULL,
    activo            BOOLEAN      NOT NULL DEFAULT true,
    ambito            VARCHAR(10)  NOT NULL DEFAULT 'campus',
    issuer_id         INTEGER      REFERENCES invoice_issuers(id) ON DELETE CASCADE,
    project_id        INTEGER      REFERENCES projects(id) ON DELETE CASCADE,
    ventana_min       SMALLINT     NOT NULL DEFAULT 15,
    -- Escenario 1 (el de siempre) y escenario 2 (el nuevo, con la gestora).
    destino1_tipo     VARCHAR(8)   NOT NULL,
    destino1_cifrado  TEXT         NOT NULL,
    destino1_iv       VARCHAR(32)  NOT NULL,
    destino1_tag      VARCHAR(32)  NOT NULL,
    destino1_cola     VARCHAR(12),
    destino2_tipo     VARCHAR(8)   NOT NULL,
    destino2_cifrado  TEXT         NOT NULL,
    destino2_iv       VARCHAR(32)  NOT NULL,
    destino2_tag      VARCHAR(32)  NOT NULL,
    destino2_cola     VARCHAR(12),
    -- La clave con la que llama la entrada de Make: solo su huella (sha256).
    clave_hash        VARCHAR(64)  NOT NULL,
    clave_cola        VARCHAR(8),
    creado_por        INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    actualizado_por   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT asignacion_destinos_ambito CHECK (ambito IN ('todas', 'empresa', 'campus')),
    CONSTRAINT asignacion_destinos_ambito_coherente CHECK (
         (ambito = 'todas'   AND issuer_id IS NULL     AND project_id IS NULL)
      OR (ambito = 'empresa' AND issuer_id IS NOT NULL AND project_id IS NULL)
      OR (ambito = 'campus'  AND project_id IS NOT NULL AND issuer_id IS NULL)
    ),
    CONSTRAINT asignacion_destinos_tipos CHECK (destino1_tipo IN ('mailhook', 'webhook') AND destino2_tipo IN ('mailhook', 'webhook')),
    CONSTRAINT asignacion_destinos_ventana CHECK (ventana_min BETWEEN 1 AND 240)
);

-- Un campus, una empresa y «todas» tienen como mucho una configuración.
CREATE UNIQUE INDEX IF NOT EXISTS uq_asignacion_destinos_campus ON asignacion_destinos (project_id) WHERE ambito = 'campus';
CREATE UNIQUE INDEX IF NOT EXISTS uq_asignacion_destinos_empresa ON asignacion_destinos (issuer_id) WHERE ambito = 'empresa';
CREATE UNIQUE INDEX IF NOT EXISTS uq_asignacion_destinos_todas ON asignacion_destinos ((true)) WHERE ambito = 'todas';
CREATE UNIQUE INDEX IF NOT EXISTS uq_asignacion_destinos_clave ON asignacion_destinos (clave_hash);

CREATE TABLE IF NOT EXISTS asignacion_decisiones (
    id                  SERIAL       PRIMARY KEY,
    destino_id          INTEGER      REFERENCES asignacion_destinos(id) ON DELETE SET NULL,
    project_id          INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    uid                 VARCHAR(200) NOT NULL,
    prueba              BOOLEAN      NOT NULL DEFAULT false,
    escenario           SMALLINT     NOT NULL,
    responsable_id      INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    lead_id             INTEGER      REFERENCES leads(id) ON DELETE SET NULL,
    -- Por qué: quiénes entraban, quiénes estaban activas y sus cuentas.
    motivo              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- Lo que llegó de la entrada, tal cual (es lo que se reenvía al escenario).
    datos               JSONB        NOT NULL,
    -- El envío al escenario y sus reintentos (1, 5 y 15 min).
    estado              VARCHAR(12)  NOT NULL DEFAULT 'pendiente',
    destino_tipo        VARCHAR(8),
    intentos            SMALLINT     NOT NULL DEFAULT 0,
    http_status         INTEGER,
    respuesta           TEXT,
    error               TEXT,
    proximo_intento_at  TIMESTAMPTZ,
    ultimo_intento_at   TIMESTAMPTZ,
    enviado_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT asignacion_decisiones_uid UNIQUE (project_id, uid),
    CONSTRAINT asignacion_decisiones_escenario CHECK (escenario IN (1, 2)),
    CONSTRAINT asignacion_decisiones_estado CHECK (estado IN ('pendiente', 'enviando', 'enviado', 'fallido'))
);

CREATE INDEX IF NOT EXISTS idx_asig_dec_pendientes ON asignacion_decisiones (proximo_intento_at)
  WHERE estado IN ('pendiente', 'enviando');
CREATE INDEX IF NOT EXISTS idx_asig_dec_fecha ON asignacion_decisiones (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asig_dec_proyecto ON asignacion_decisiones (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS actividad_crm (
    id          BIGSERIAL    PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    accion      VARCHAR(40)  NOT NULL,
    ruta        VARCHAR(200),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_actividad_crm_user_fecha ON actividad_crm (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actividad_crm_fecha ON actividad_crm (created_at);

-- Lo que miran «activa en los últimos 15 min» y «asignados hoy».
CREATE INDEX IF NOT EXISTS idx_lead_interactions_autor_fecha ON lead_interactions (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_status_history_autor_fecha ON lead_status_history (changed_by, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_reminders_autor_fecha ON lead_reminders (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_responsable_fecha ON leads (responsable_id, created_at DESC);

COMMENT ON TABLE asignacion_destinos IS
  'Asignacion de leads por actividad (230, CRM#513): destinos de los escenarios 1 (de siempre) y 2 (con gestora) de Make, por campus, empresa o todas; ventana de actividad y huella de la clave de la entrada.';
COMMENT ON TABLE asignacion_decisiones IS
  'Cada formulario que entra por la asignacion (230): a quien, por que, a que escenario, y el envio con sus reintentos. Unico por campus y uid.';
COMMENT ON TABLE actividad_crm IS
  'Acciones de una gestora que no guardan su autor (crear lead, venta, cobro, matricula, factura). Para «activa en los ultimos N min» (230). Se purga a los 30 dias.';

DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON asignacion_destinos, asignacion_decisiones, actividad_crm TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE asignacion_destinos_id_seq, asignacion_decisiones_id_seq, actividad_crm_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
