-- ============================================================
-- CRM-ISEIE — Migración 001: Schema inicial consolidado
-- Motor: PostgreSQL 15+
-- Ejecutar: psql -U crm_iseie_user -d crm_iseie -f 001_initial_schema.sql
-- ============================================================
--
-- Esta migración consolida en un solo archivo:
--   • El schema 001 original del CRM hermano (esos2dev-oss/CRM)
--   • Las ALTER TABLE críticas posteriores que arreglaron/extendieron
--     entidades núcleo (auth + users + projects):
--       003 → user_refresh_tokens
--       014 → users.avatar_url / avatar_key
--       015 → projects.modules JSONB
--       026 → user_role += 'soporte'
--       029 → user_views (preferencias por usuario)
--       033 → custom_roles + user_permission_overrides + users.custom_role_id
--       040 → custom_roles.default_view JSONB
--       044 → projects.sidebar_labels JSONB
--       045 → projects.theme_color
--       057 → users.is_available + user_availability_blocks + leads.idempotency_key
--       058 → leads.deleted_at (soft-delete)
--       059 → leads.es_propuesto (cross-sell) — la 059 añade propuesto_de FK además
--
-- Las migraciones puramente de features (matrículas, payroll, woocommerce,
-- email-sequences, dossiers, audiencies, ia-reports, etc.) NO se incluyen aquí.
-- Se añadirán como 002+, en su propio archivo, cuando se replique cada módulo
-- desde el CRM hermano (ver documentacion/00-baseline-desde-crm.md §11).
-- ============================================================

BEGIN;

-- ============================================================
-- TIPOS ENUM
-- ============================================================

CREATE TYPE user_role AS ENUM ('superadmin', 'admin', 'gestor', 'soporte');
CREATE TYPE project_type AS ENUM ('crm', 'ia');
CREATE TYPE lead_status AS ENUM ('nuevo', 'por_contactar', 'contactado', 'en_seguimiento', 'convertido', 'no_interesado');
CREATE TYPE interaction_type AS ENUM ('llamada', 'email', 'whatsapp', 'nota');
CREATE TYPE payment_method AS ENUM ('transferencia', 'tarjeta', 'efectivo', 'fraccionado');
CREATE TYPE utm_channel AS ENUM ('meta_ads', 'google_ads', 'tiktok_ads', 'organico', 'chatgpt_ia', 'directo', 'referido', 'whatsapp');
CREATE TYPE api_service AS ENUM ('meta', 'google_ads', 'gsc', 'stripe', 'claude', 'brevo');

-- ============================================================
-- 1. CUSTOM_ROLES (antes que users para FK)
-- ============================================================

CREATE TABLE custom_roles (
    id           SERIAL        PRIMARY KEY,
    label        VARCHAR(100)  NOT NULL,
    description  TEXT,
    base_role    VARCHAR(30)   NOT NULL DEFAULT 'gestor',
    permissions  JSONB         NOT NULL DEFAULT '{}'::jsonb,
    default_view JSONB         NOT NULL DEFAULT '{}'::jsonb,
    active       BOOLEAN       NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN custom_roles.permissions IS
  'Overrides de permisos. Ej: { "leads.delete": true, "leads.export": false }';
COMMENT ON COLUMN custom_roles.default_view IS
  'Vista por defecto del rol: { default_route, hidden_sidebar_items[], dashboard_widgets[], compact_sidebar }';

-- ============================================================
-- 2. USERS
-- ============================================================

CREATE TABLE users (
    id                    SERIAL        PRIMARY KEY,
    nombre                VARCHAR(200)  NOT NULL,
    email                 VARCHAR(255)  NOT NULL UNIQUE,
    password_hash         VARCHAR(255)  NOT NULL,
    role                  user_role     NOT NULL DEFAULT 'gestor',
    custom_role_id        INTEGER       REFERENCES custom_roles(id) ON DELETE SET NULL,
    active                BOOLEAN       NOT NULL DEFAULT true,
    is_available          BOOLEAN       NOT NULL DEFAULT true,
    unavailable_reason    TEXT,
    unavailable_since     TIMESTAMPTZ,
    avatar_url            VARCHAR(500),
    avatar_key            VARCHAR(500),
    set_password_token    VARCHAR(255),
    set_password_expires  TIMESTAMPTZ,
    last_login_at         TIMESTAMPTZ,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN users.is_available IS
  'Toggle on/off para round-robin. false = no recibe nuevos leads aunque siga active.';
COMMENT ON COLUMN users.avatar_url IS
  'Path público del avatar (ej: /api/users/:id/avatar?v=...)';
COMMENT ON COLUMN users.avatar_key IS
  'Key interno en disco/R2 para servir/borrar el avatar';

-- ============================================================
-- 3. USER_REFRESH_TOKENS (auth)
-- ============================================================

CREATE TABLE user_refresh_tokens (
    id          SERIAL       PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ  NOT NULL,
    revoked     BOOLEAN      NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id ON user_refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_hash    ON user_refresh_tokens (token_hash) WHERE revoked = false;

-- ============================================================
-- 4. USER_PERMISSION_OVERRIDES (RBAC fino por usuario)
-- ============================================================

CREATE TABLE user_permission_overrides (
    id         SERIAL       PRIMARY KEY,
    user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource   VARCHAR(60)  NOT NULL,
    action     VARCHAR(30)  NOT NULL,
    allowed    BOOLEAN      NOT NULL,
    UNIQUE (user_id, resource, action)
);

-- ============================================================
-- 5. USER_AVAILABILITY_BLOCKS (vacaciones, ausencias programadas)
-- ============================================================

CREATE TABLE user_availability_blocks (
    id            SERIAL       PRIMARY KEY,
    user_id       INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fecha_inicio  DATE         NOT NULL,
    fecha_fin     DATE         NOT NULL,
    motivo        TEXT,
    created_by    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX idx_user_availability_blocks_user_dates
    ON user_availability_blocks (user_id, fecha_inicio, fecha_fin);

COMMENT ON TABLE user_availability_blocks IS
  'Bloques programados de ausencia. Round-robin los salta cuando CURRENT_DATE está dentro del rango.';

-- ============================================================
-- 6. PROJECTS
-- ============================================================

CREATE TABLE projects (
    id                       SERIAL         PRIMARY KEY,
    nombre                   VARCHAR(200)   NOT NULL,
    slug                     VARCHAR(100)   NOT NULL UNIQUE,
    type                     project_type   NOT NULL DEFAULT 'crm',
    emoji                    VARCHAR(10),
    theme_color              VARCHAR(7),
    sidebar_labels           JSONB          NOT NULL DEFAULT '{}'::jsonb,
    modules                  JSONB          NOT NULL DEFAULT '{}'::jsonb,
    meta_account_id          VARCHAR(100),
    google_account_id        VARCHAR(100),
    gsc_property             VARCHAR(255),
    webhook_api_key          VARCHAR(255)   NOT NULL,
    dias_alerta_inactividad  INTEGER        NOT NULL DEFAULT 3,
    active                   BOOLEAN        NOT NULL DEFAULT true,
    created_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN projects.theme_color IS
  'Hex de 7 chars (ej "#3b82f6"). NULL = default de index.css. Frontend lo convierte a HSL para inyectar --primary.';
COMMENT ON COLUMN projects.sidebar_labels IS
  'Renombrado custom de items del sidebar. Forma: { "<label_original>": "<label_override>" }';
COMMENT ON COLUMN projects.modules IS
  'Toggles de módulos activos por proyecto. Sidebar y endpoints respetan estos flags.';

-- ============================================================
-- 7. USER_PROJECTS (M:N + orden cola round-robin)
-- ============================================================

CREATE TABLE user_projects (
    id          SERIAL       PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id  INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    orden_cola  INTEGER      NOT NULL DEFAULT 0,
    active      BOOLEAN      NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_projects_user_project UNIQUE (user_id, project_id)
);

CREATE INDEX idx_user_projects_project ON user_projects (project_id) WHERE active = true;

-- ============================================================
-- 8. USER_VIEWS (preferencias de UI por usuario, opcionalmente por proyecto)
-- ============================================================

CREATE TABLE user_views (
    id                       SERIAL        PRIMARY KEY,
    user_id                  INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id               INTEGER       REFERENCES projects(id) ON DELETE CASCADE,
    hidden_sidebar_items     TEXT[]        DEFAULT '{}',
    lead_columns_override    JSONB,
    client_columns_override  JSONB,
    dashboard_widgets        JSONB         DEFAULT '[]'::jsonb,
    saved_filters            JSONB         DEFAULT '[]'::jsonb,
    table_density            VARCHAR(10)   NOT NULL DEFAULT 'comfortable'
                             CHECK (table_density IN ('compact', 'comfortable')),
    theme_preference         VARCHAR(10),
    language                 VARCHAR(5)    NOT NULL DEFAULT 'es',
    notes                    JSONB,
    created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Una preferencia global (project_id NULL) + opcionalmente una por proyecto
CREATE UNIQUE INDEX uq_user_views_user_project
    ON user_views (user_id, COALESCE(project_id, 0));

COMMENT ON COLUMN user_views.project_id IS
  'NULL = preferencia global del usuario. Si hay row con project_id concreto, gana sobre la global.';

-- ============================================================
-- 9. PROJECT_QUEUE_STATE (round-robin)
-- ============================================================

CREATE TABLE project_queue_state (
    id                     SERIAL       PRIMARY KEY,
    project_id             INTEGER      NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    last_assigned_user_id  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    last_assigned_index    INTEGER      NOT NULL DEFAULT 0,
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 10. PRODUCTS
-- ============================================================

CREATE TABLE products (
    id           SERIAL        PRIMARY KEY,
    project_id   INTEGER       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    nombre       VARCHAR(200)  NOT NULL,
    descripcion  TEXT,
    active       BOOLEAN       NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 11. DOSSIERS
-- ============================================================

CREATE TABLE dossiers (
    id                 SERIAL        PRIMARY KEY,
    product_id         INTEGER       NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    s3_key             VARCHAR(500)  NOT NULL,
    filename_original  VARCHAR(255)  NOT NULL,
    version            INTEGER       NOT NULL DEFAULT 1,
    active             BOOLEAN       NOT NULL DEFAULT true,
    size_bytes         BIGINT,
    subido_por         INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 12. LEADS
-- ============================================================

CREATE TABLE leads (
    id                   SERIAL         PRIMARY KEY,
    project_id           INTEGER        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    nombre               VARCHAR(200)   NOT NULL,
    email                VARCHAR(255),
    telefono             VARCHAR(50),
    producto_interes_id  INTEGER        REFERENCES products(id) ON DELETE SET NULL,
    status               lead_status    NOT NULL DEFAULT 'nuevo',
    responsable_id       INTEGER        REFERENCES users(id) ON DELETE SET NULL,
    dossier_enviado      BOOLEAN        NOT NULL DEFAULT false,
    dossier_enviado_at   TIMESTAMPTZ,
    notas                TEXT,
    lead_duplicado_de    INTEGER        REFERENCES leads(id) ON DELETE SET NULL,
    landing_url          TEXT,
    idempotency_key      VARCHAR(200),
    es_propuesto         BOOLEAN        NOT NULL DEFAULT false,
    deleted_at           TIMESTAMPTZ,
    fecha_solicitud      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_email              ON leads (email);
CREATE INDEX idx_leads_project_id         ON leads (project_id);
CREATE INDEX idx_leads_responsable_status ON leads (responsable_id, status);
CREATE INDEX idx_leads_project_status     ON leads (project_id, status);
CREATE INDEX idx_leads_fecha_solicitud    ON leads (fecha_solicitud);
CREATE INDEX idx_leads_deleted_at         ON leads (deleted_at) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_leads_idempotency_key
    ON leads (project_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN leads.idempotency_key IS
  'Clave única por proyecto que Make/integraciones envían para evitar duplicados en reintentos.';
COMMENT ON COLUMN leads.es_propuesto IS
  'true si el email ya pertenece a un cliente convertido y ahora pregunta por otro producto (cross-sell). Migración 059 añade además propuesto_de FK.';
COMMENT ON COLUMN leads.deleted_at IS
  'Soft-delete. Las queries activas deben filtrar deleted_at IS NULL.';

-- ============================================================
-- 13. LEAD_UTMS (1:1 con leads)
-- ============================================================

CREATE TABLE lead_utms (
    id               SERIAL         PRIMARY KEY,
    lead_id          INTEGER        NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
    utm_source       VARCHAR(100),
    utm_medium       VARCHAR(100),
    utm_campaign     VARCHAR(255),
    utm_content      VARCHAR(255),
    utm_term         VARCHAR(255),
    landing_url      TEXT,
    canal_detectado  utm_channel,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 14. LEAD_STATUS_HISTORY
-- ============================================================

CREATE TABLE lead_status_history (
    id               SERIAL       PRIMARY KEY,
    lead_id          INTEGER      NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    status_anterior  lead_status  NOT NULL,
    status_nuevo     lead_status  NOT NULL,
    changed_by       INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    changed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_status_history_lead_id ON lead_status_history (lead_id);

-- ============================================================
-- 15. LEAD_INTERACTIONS
-- ============================================================

CREATE TABLE lead_interactions (
    id          SERIAL            PRIMARY KEY,
    lead_id     INTEGER           NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    tipo        interaction_type  NOT NULL,
    nota        TEXT,
    fecha       TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    created_by  INTEGER           REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_interactions_lead_id ON lead_interactions (lead_id);

-- ============================================================
-- 16. LEAD_REMINDERS
-- ============================================================

CREATE TABLE lead_reminders (
    id                  SERIAL       PRIMARY KEY,
    lead_id             INTEGER      NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    fecha_recordatorio  DATE         NOT NULL,
    nota                TEXT,
    completado          BOOLEAN      NOT NULL DEFAULT false,
    created_by          INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_reminders_lead_fecha ON lead_reminders (lead_id, fecha_recordatorio);

-- ============================================================
-- 17. CONVERSIONS
-- ============================================================

CREATE TABLE conversions (
    id                     SERIAL          PRIMARY KEY,
    lead_id                INTEGER         NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    project_id             INTEGER         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    producto_contratado    VARCHAR(255)    NOT NULL,
    importe_total          DECIMAL(10,2)   NOT NULL,
    importe_pagado         DECIMAL(10,2)   NOT NULL DEFAULT 0,
    fecha_compromiso_pago  DATE,
    metodo_pago            payment_method,
    notas_pago             TEXT,
    fecha_conversion       DATE            NOT NULL DEFAULT CURRENT_DATE,
    created_at             TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversions_project_fecha ON conversions (project_id, fecha_conversion);
CREATE INDEX idx_conversions_lead          ON conversions (lead_id);

-- ============================================================
-- 18. CONVERSION_PAYMENTS (abonos parciales)
-- ============================================================

CREATE TABLE conversion_payments (
    id             SERIAL         PRIMARY KEY,
    conversion_id  INTEGER        NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,
    importe        DECIMAL(10,2)  NOT NULL,
    fecha          DATE           NOT NULL DEFAULT CURRENT_DATE,
    notas          TEXT,
    created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversion_payments_conversion ON conversion_payments (conversion_id);

-- ============================================================
-- 19. USER_ACTIVITY_LOG (auditoría)
-- ============================================================

CREATE TABLE user_activity_log (
    id          SERIAL        PRIMARY KEY,
    user_id     INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action      VARCHAR(100)  NOT NULL,
    details     JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_activity_log_user_created ON user_activity_log (user_id, created_at);

-- ============================================================
-- TRIGGER: updated_at automático
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'updated_at'
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I '
            'FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            t, t
        );
    END LOOP;
END$$;

COMMIT;

-- ============================================================
-- FIN 001_initial_schema.sql
-- Próximas migraciones (cuando se repliquen los módulos correspondientes
-- desde el CRM hermano):
--   002_product_categories.sql        — árbol de categorías
--   003_api_credentials.sql           — credenciales encriptadas AES-256
--   004_email_templates.sql           — plantillas Brevo
--   005_email_sequences.sql           — automatizaciones
--   006_forms.sql                     — forms públicos + field-aliases
--   007_field_definitions.sql         — campos custom por proyecto
--   008_accounting.sql                — gastos + cuentas por pagar
--   009_commissions.sql               — comisiones
--   010_payroll.sql                   — nóminas
--   011_matriculas.sql                — matrículas
--   012_documents.sql                 — gestor docs genérico
--   013_woocommerce.sql               — importer WC
--   014_make_webhooks.sql             — Make.com integration
--   015_audiences.sql                 — Meta Custom Audiences
--   016_ia_reports_and_chat.sql       — Claude reports + chat
--   017_platform_users.sql            — usuarios IA (modo type='ia')
--   018_external_panels.sql           — paneles externos por proyecto
--   019_project_connectors.sql        — adapters de conectores
--   020_status.sql                    — healthcheck DB-backed
-- ============================================================
