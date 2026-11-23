-- 318 · Instagram con IA y datos de atribución de Meta: las tablas
--       (gemela de diego-landaeta/CRM#845; en el 360 es la 284, #465, épica #464)
--
-- Se fusionó como la 317, el mismo número que `317_ventas_repetidas_forzadas`
-- (#577). El contenido no cambia, y se puede pasar dos veces: donde ya se
-- aplicó como 317, aplicar la 318 no hace nada (todo va con IF NOT EXISTS) y
-- solo queda apuntarla con su nombre nuevo.
--
-- Fase 1 de la épica: solo prepara el terreno. No hay código que use nada de
-- esto todavía; lo usan #466 (webhook), #467 (conectar cuenta), #468 (DM),
-- #473 (comentarios) y #474 (captura de fbc/fbp/IP/navegador).
--
-- QUÉ CREA
--
--   · `ig_accounts`, `ig_bot_config`, `ig_conversations`, `ig_messages`,
--     `ig_comments`: el canal Instagram (una cuenta por proyecto, su «cerebro»,
--     sus conversaciones y comentarios).
--   · `webhook_events`: lo que entra por un webhook, guardado antes de
--     procesarlo y sin duplicados (Meta reintenta).
--   · En `lead_utms` (la tabla 1:1 de «de dónde vino» el prospecto):
--     `meta_lead_id`, `meta_form_id`, `fbc`, `fbp`, `client_ip`, `user_agent`,
--     `igsid`, `ig_account_id`.
--   · En `leads`: `lifetime_value`.
--   · El valor `instagram` en el enum `utm_channel`.
--
-- QUÉ NO CREA, Y POR QUÉ (lo pedía la issue con otro nombre)
--
--   · `ai_usage`: ya existe `ia_gasto` (migración 249 en ISEIE, 145 en el 360) con proyecto, modelo,
--     tokens de entrada y salida, caché, coste y fallo, y el tope mensual lee de
--     ahí. Una segunda tabla partiría el tope en dos. El bot apunta en `ia_gasto`
--     con `origen = 'instagram'`.
--   · `leads.source_channel`: es `lead_utms.canal_detectado`, que decide
--     `leads/canal.js` (la regla en un solo sitio, #48). Se añade `instagram`.
--   · `leads.landing_url`: ya existe (y también `lead_utms.landing_url`).
--   · `meta_ad_id`: lo crea la puerta 8 del conector (CRM#806; en ISEIE, la 297) en
--     `lead_utms.meta_ad_id`, junto a `meta_adset_id` y `meta_campaign_id`. Por
--     eso el resto de identificadores de Meta van en `lead_utms` y no en `leads`.
--   · `ig_messages` NO reutiliza `wa_mensajes`: esa tabla cuelga de
--     `wa_conversaciones` (instancia, jid y teléfono obligatorios) y lleva columnas
--     propias de WhatsApp (estados de entrega, reintentos de adjuntos). No es una
--     tabla común por canal, y generalizarla tocaría el módulo de WhatsApp entero.
--   · `meta_datasets`, `meta_stage_map`, `meta_events_outbox`: son de #475/#476.
--
-- DATOS PERSONALES: `client_ip`, `user_agent`, el texto de los DM y los
-- `payload` de `webhook_events` lo son. Cuánto se guardan está por decidir
-- (pregunta abierta en la #465); aquí solo se crean las columnas.
--
-- Solo crea y añade; no cambia ni borra nada. Se puede pasar dos veces.
--
-- Para deshacerlo (no hay datos que perder mientras no haya código que escriba):
--   DROP TABLE ig_comments, ig_messages, ig_conversations, ig_bot_config, webhook_events CASCADE;
--   ALTER TABLE lead_utms DROP COLUMN meta_lead_id, DROP COLUMN meta_form_id, DROP COLUMN fbc,
--     DROP COLUMN fbp, DROP COLUMN client_ip, DROP COLUMN user_agent, DROP COLUMN igsid,
--     DROP COLUMN ig_account_id;
--   DROP TABLE ig_accounts;
--   ALTER TABLE leads DROP COLUMN lifetime_value;
--   (el valor `instagram` del enum no se puede quitar sin rehacer el tipo; se deja)

-- El valor nuevo del enum va fuera de la transacción: en una transacción no se
-- puede usar hasta el COMMIT, y así no hay sorpresas si alguien añade algo abajo.
ALTER TYPE utm_channel ADD VALUE IF NOT EXISTS 'instagram';

BEGIN;

-- ─── 1. Cuentas de Instagram ────────────────────────────────────────────────
-- Una app de Meta para todas las cuentas: el webhook trae `entry.id`
-- (= `ig_user_id`) y con eso se sabe la cuenta y el proyecto.
CREATE TABLE IF NOT EXISTS ig_accounts (
    id                    SERIAL        PRIMARY KEY,
    project_id            INTEGER       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ig_user_id            VARCHAR(64)   NOT NULL,
    username              VARCHAR(100),
    -- Token largo (60 días), cifrado AES-256-GCM con shared/utils/crypto.js,
    -- en el formato '<iv_hex>:<tag_hex>:<ciphertext_hex>' (como meta_ad_accounts).
    -- Nunca en claro: por eso el nombre lo dice.
    access_token_cifrado  TEXT,
    token_expires_at      TIMESTAMPTZ,
    token_refreshed_at    TIMESTAMPTZ,
    -- Si la renovación diaria falla, qué dijo Meta (para avisar al admin).
    token_error           TEXT,
    -- Nace apagada: no responde hasta que el admin rellena el cerebro.
    active                BOOLEAN       NOT NULL DEFAULT false,
    connected_by          INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ig_accounts_ig_user UNIQUE (ig_user_id)
);

CREATE INDEX IF NOT EXISTS idx_ig_accounts_project ON ig_accounts (project_id);
-- El job de renovación busca tokens de más de 20 días.
CREATE INDEX IF NOT EXISTS idx_ig_accounts_renovar ON ig_accounts (token_refreshed_at)
    WHERE access_token_cifrado IS NOT NULL;

COMMENT ON TABLE ig_accounts IS
  'Cuentas de Instagram conectadas, una por fila y vinculada a un proyecto (#465). Token cifrado.';

-- ─── 2. El cerebro de cada cuenta ───────────────────────────────────────────
-- 1:1 con la cuenta. Las reglas comunes del prompt no van aquí: van en el código
-- y no se editan por proyecto.
CREATE TABLE IF NOT EXISTS ig_bot_config (
    ig_account_id      INTEGER       PRIMARY KEY REFERENCES ig_accounts(id) ON DELETE CASCADE,
    -- NULL = IG_DEFAULT_MODEL del .env.
    model              VARCHAR(80),
    system_prompt      TEXT,
    knowledge          TEXT,
    comment_mode       VARCHAR(10)   NOT NULL DEFAULT 'off',
    handoff_message    TEXT,
    human_pause_hours  INTEGER       NOT NULL DEFAULT 24,
    debounce_seconds   INTEGER       NOT NULL DEFAULT 10,
    max_history        INTEGER       NOT NULL DEFAULT 20,
    updated_by         INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT ig_bot_config_comment_mode CHECK (comment_mode IN ('off', 'public', 'private', 'both')),
    CONSTRAINT ig_bot_config_pausa CHECK (human_pause_hours >= 0),
    CONSTRAINT ig_bot_config_debounce CHECK (debounce_seconds BETWEEN 0 AND 300),
    CONSTRAINT ig_bot_config_historial CHECK (max_history BETWEEN 1 AND 200)
);

COMMENT ON TABLE ig_bot_config IS
  'El «cerebro» de cada cuenta de Instagram: modelo, instrucciones, información de referencia y tiempos (#465).';

-- ─── 3. Conversaciones (una por cuenta y persona) ───────────────────────────
-- `lead_id` es el «prospect_id» de la especificación: en el CRM se llama así.
-- `project_id` se repite (también está en la cuenta) para listar y filtrar por
-- campus sin unir tablas, como `wa_conversaciones`. Si una cuenta cambia de
-- proyecto, el código tiene que mover también sus conversaciones.
CREATE TABLE IF NOT EXISTS ig_conversations (
    id                 SERIAL        PRIMARY KEY,
    ig_account_id      INTEGER       NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
    project_id         INTEGER       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    lead_id            INTEGER       REFERENCES leads(id) ON DELETE SET NULL,
    -- Instagram-scoped ID: el id de la persona para ESTA cuenta.
    igsid              VARCHAR(64)   NOT NULL,
    username           VARCHAR(100),
    nombre             VARCHAR(200),
    -- Bot callado hasta esta hora (paso a una persona, eco desde la app, respuesta
    -- desde el CRM). NULL o pasada = el bot contesta.
    paused_until       TIMESTAMPTZ,
    pause_reason       VARCHAR(20),
    -- La ventana de 24 h de Meta se cuenta desde el último mensaje de la persona.
    last_incoming_at   TIMESTAMPTZ,
    last_outgoing_at   TIMESTAMPTZ,
    assigned_user_id   INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ig_conversations_cuenta_igsid UNIQUE (ig_account_id, igsid),
    CONSTRAINT ig_conversations_pause_reason CHECK (
      pause_reason IS NULL OR pause_reason IN ('handoff', 'eco', 'humano_crm', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_ig_conversations_lead ON ig_conversations (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ig_conversations_recientes ON ig_conversations (project_id, last_incoming_at DESC);
-- La cola del día: «Instagram: piden una persona».
CREATE INDEX IF NOT EXISTS idx_ig_conversations_pausadas ON ig_conversations (project_id, paused_until)
    WHERE paused_until IS NOT NULL;

COMMENT ON TABLE ig_conversations IS
  'Conversación de Instagram entre una cuenta y una persona (IGSID), atada a su prospecto (#465).';

-- ─── 4. Mensajes ────────────────────────────────────────────────────────────
-- role: 'user' (la persona), 'assistant' (el bot), 'human' (alguien del equipo,
-- desde el CRM o desde la app de Instagram).
-- La fila del bot se guarda ANTES de enviar (estado 'pendiente', sin `mid`) para
-- reconocer su eco aunque llegue antes que la respuesta de la API.
CREATE TABLE IF NOT EXISTS ig_messages (
    id                 BIGSERIAL     PRIMARY KEY,
    conversation_id    INTEGER       NOT NULL REFERENCES ig_conversations(id) ON DELETE CASCADE,
    role               VARCHAR(10)   NOT NULL,
    text               TEXT,
    -- Id del mensaje en Meta. Se deduplica por él (Meta reintenta).
    mid                VARCHAR(512),
    sent_by_user_id    INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    -- Solo para lo que sale: NULL en lo que entra.
    status             VARCHAR(12),
    error              TEXT,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT ig_messages_role CHECK (role IN ('user', 'assistant', 'human')),
    CONSTRAINT ig_messages_status CHECK (status IS NULL OR status IN ('pendiente', 'enviado', 'fallido'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ig_messages_mid ON ig_messages (mid) WHERE mid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ig_messages_conv ON ig_messages (conversation_id, created_at);

COMMENT ON TABLE ig_messages IS
  'Mensajes de Instagram de cada conversación (#465). Tabla propia: wa_mensajes es solo de WhatsApp.';

-- ─── 5. Comentarios ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ig_comments (
    id                 SERIAL        PRIMARY KEY,
    ig_account_id      INTEGER       NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
    project_id         INTEGER       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    comment_id         VARCHAR(64)   NOT NULL,
    media_id           VARCHAR(64),
    -- Si es respuesta a otro comentario.
    parent_comment_id  VARCHAR(64),
    from_id            VARCHAR(64),
    from_username      VARCHAR(100),
    text               TEXT,
    lead_id            INTEGER       REFERENCES leads(id) ON DELETE SET NULL,
    -- Lo que decidió Claude: ignorar, respuesta pública y/o privada.
    ignored            BOOLEAN       NOT NULL DEFAULT false,
    public_reply       TEXT,
    public_reply_id    VARCHAR(64),
    private_reply      TEXT,
    replied_at         TIMESTAMPTZ,
    error              TEXT,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ig_comments_comment UNIQUE (comment_id)
);

CREATE INDEX IF NOT EXISTS idx_ig_comments_cuenta ON ig_comments (ig_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ig_comments_project ON ig_comments (project_id, created_at DESC);

COMMENT ON TABLE ig_comments IS
  'Comentarios de Instagram recibidos y lo que se respondió (#465).';

-- ─── 6. Eventos de webhook ──────────────────────────────────────────────────
-- Genérica: hoy Instagram, mañana lo que haga falta. Se guarda con 200 inmediato
-- y se procesa en segundo plano. El único es por (fuente, id): el `mid` de un DM
-- o el id de un comentario.
CREATE TABLE IF NOT EXISTS webhook_events (
    id                 BIGSERIAL     PRIMARY KEY,
    source             VARCHAR(30)   NOT NULL,
    event_id           VARCHAR(512)  NOT NULL,
    -- Se sabe al cargar la cuenta; puede no saberse al recibir.
    project_id         INTEGER       REFERENCES projects(id) ON DELETE SET NULL,
    payload            JSONB         NOT NULL,
    received_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    processed_at       TIMESTAMPTZ,
    attempts           INTEGER       NOT NULL DEFAULT 0,
    error              TEXT,
    CONSTRAINT uq_webhook_events_source_event UNIQUE (source, event_id)
);

-- La cola: lo que falta por procesar, por orden de llegada.
CREATE INDEX IF NOT EXISTS idx_webhook_events_pendientes ON webhook_events (received_at)
    WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_project ON webhook_events (project_id, received_at DESC)
    WHERE project_id IS NOT NULL;

COMMENT ON TABLE webhook_events IS
  'Eventos recibidos por webhook, sin duplicados por (source, event_id), procesados en segundo plano (#465).';

-- ─── 7. De dónde vino el prospecto: identificadores de Meta e Instagram ─────
-- En `lead_utms`, junto a las UTM, el referrer, el canal y los ids de campaña,
-- conjunto y anuncio de la puerta 8. OJO (#474): hoy esa fila solo se crea si
-- llega alguna UTM, canal, landing_url o referrer; quien escriba estos campos
-- tiene que crearla si no está (ON CONFLICT (lead_id)).
--
-- `client_ip` es texto y no INET a propósito: un X-Forwarded-For mal formado no
-- puede hacer que se pierda un prospecto. Se valida en el código.
ALTER TABLE lead_utms
  ADD COLUMN IF NOT EXISTS meta_lead_id   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS meta_form_id   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS fbc            TEXT,
  ADD COLUMN IF NOT EXISTS fbp            VARCHAR(255),
  ADD COLUMN IF NOT EXISTS client_ip      VARCHAR(45),
  ADD COLUMN IF NOT EXISTS user_agent     TEXT,
  ADD COLUMN IF NOT EXISTS igsid          VARCHAR(64),
  ADD COLUMN IF NOT EXISTS ig_account_id  INTEGER REFERENCES ig_accounts(id) ON DELETE SET NULL;

-- Un Lead Ad repetido (Make reintenta) se busca por su leadgen_id.
CREATE INDEX IF NOT EXISTS idx_lead_utms_meta_lead ON lead_utms (meta_lead_id) WHERE meta_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_utms_ig ON lead_utms (ig_account_id, igsid) WHERE igsid IS NOT NULL;

COMMENT ON COLUMN lead_utms.meta_lead_id IS
  'leadgen_id del formulario instantáneo de Meta. Identificador de Conversion Leads (#465).';
COMMENT ON COLUMN lead_utms.meta_form_id IS 'form_id del formulario instantáneo de Meta (#465).';
COMMENT ON COLUMN lead_utms.fbc IS 'Cookie _fbc o fb.1.{ms}.{fbclid} sacado de la URL (#465, #474).';
COMMENT ON COLUMN lead_utms.fbp IS 'Cookie _fbp del navegador (#465, #474).';
COMMENT ON COLUMN lead_utms.client_ip IS 'IP del alta (dato personal; retención por decidir) (#465).';
COMMENT ON COLUMN lead_utms.user_agent IS 'Navegador del alta (dato personal; retención por decidir) (#465).';
COMMENT ON COLUMN lead_utms.igsid IS 'IGSID con el que entró por Instagram, para la cuenta ig_account_id (#465).';
COMMENT ON COLUMN lead_utms.ig_account_id IS 'Cuenta de Instagram por la que entró (#465).';

-- ─── 8. Valor del cliente ───────────────────────────────────────────────────
-- Copia calculada (en EUR) de lo cobrado a esta persona, para los públicos
-- basados en valor (fase 3). La verdad son los cobros: esto se recalcula.
-- NULL = sin calcular.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lifetime_value NUMERIC(12,2);
COMMENT ON COLUMN leads.lifetime_value IS
  'Lo cobrado a este prospecto en EUR, calculado desde los cobros (fase 3 de #464). NULL = sin calcular.';

-- ─── 9. Permisos (#71) ──────────────────────────────────────────────────────
-- Esta migración la corre `postgres`: sin esto el usuario del CRM no ve las tablas.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ig_accounts, ig_bot_config, ig_conversations, ig_messages, ig_comments, webhook_events TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE ig_accounts_id_seq, ig_conversations_id_seq, ig_messages_id_seq, ig_comments_id_seq, webhook_events_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
