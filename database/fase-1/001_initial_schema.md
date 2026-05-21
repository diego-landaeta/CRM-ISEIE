# Migracion 001 - Schema Inicial

> **Archivo fuente:** `backend/migrations/001_initial_schema.sql`
> **Stories Jira:** CRM-31, CRM-33, CRM-44, CRM-51, CRM-58, CRM-62, CRM-73

---

## Resumen

Esta migracion crea toda la estructura de base de datos de la Fase 1 del CRM:
- 7 tipos ENUM para roles, status, canales, etc.
- 14 tablas con todas sus relaciones (foreign keys)
- 9 indices optimizados para las queries mas frecuentes

Todo se ejecuta dentro de una transaccion (BEGIN/COMMIT) para que si algo falla, no quede a medias.

---

## Tablas creadas (14)

| # | Tabla | Proposito | Campos clave |
|---|-------|-----------|-------------|
| 1 | users | Usuarios del CRM | email (UNIQUE), role (enum), password_hash, active |
| 2 | projects | Proyectos educativos e IA | slug (UNIQUE), webhook_api_key, type (crm/ia) |
| 3 | user_projects | Relacion N:M usuarios-proyectos | user_id + project_id (UNIQUE), orden_cola para round-robin |
| 4 | products | Cursos/productos por proyecto | project_id (FK), nombre, descripcion, active |
| 5 | dossiers | PDFs versionados en Cloudflare R2 | product_id (FK), s3_key, version, active, subido_por |
| 6 | leads | Leads con pipeline de ventas | project_id, email, status (enum), responsable_id, lead_duplicado_de |
| 7 | lead_utms | UTMs y canal detectado (1:1 con leads) | lead_id (UNIQUE FK), utm_source/medium/campaign, canal_detectado |
| 8 | lead_status_history | Historial de cambios de status | lead_id, status_anterior, status_nuevo, changed_by |
| 9 | lead_interactions | Llamadas, emails, whatsapps, notas | lead_id, tipo (enum), nota, created_by |
| 10 | lead_reminders | Recordatorios con fecha | lead_id, fecha_recordatorio, completado, created_by |
| 11 | conversions | Ventas/matriculaciones | lead_id, project_id, importe_total, importe_pagado, metodo_pago |
| 12 | conversion_payments | Abonos parciales a una conversion | conversion_id, importe, fecha |
| 13 | project_queue_state | Estado del round-robin por proyecto | project_id (UNIQUE), last_assigned_user_id, last_assigned_index |
| 14 | user_activity_log | Log de actividad (login, logout) | user_id, action, details (JSONB), ip_address |

## Tipos ENUM (7)

| Enum | Valores | Usado en |
|------|---------|----------|
| user_role | superadmin, admin, gestor | users.role |
| project_type | crm, ia | projects.type |
| lead_status | nuevo, por_contactar, contactado, en_seguimiento, convertido, no_interesado | leads.status |
| interaction_type | llamada, email, whatsapp, nota | lead_interactions.tipo |
| payment_method | transferencia, tarjeta, efectivo, fraccionado | conversions.metodo_pago |
| utm_channel | meta_ads, google_ads, tiktok_ads, organico, chatgpt_ia, directo, referido | lead_utms.canal_detectado |
| api_service | meta, google_ads, gsc, stripe, claude, brevo | Para Fase 2 (api_credentials) |

## Indices (9)

| Indice | Tabla | Columnas | Para que |
|--------|-------|----------|----------|
| idx_leads_email | leads | email | Busqueda de duplicados |
| idx_leads_project_id | leads | project_id | Filtrar leads por proyecto |
| idx_leads_responsable_status | leads | responsable_id, status | Leads de un gestor por status |
| idx_leads_project_status | leads | project_id, status | Pipeline por proyecto |
| idx_leads_fecha_solicitud | leads | fecha_solicitud | Ordenar por fecha |
| idx_lead_status_history_lead_id | lead_status_history | lead_id | Historial de un lead |
| idx_lead_interactions_lead_id | lead_interactions | lead_id | Interacciones de un lead |
| idx_conversions_project_fecha | conversions | project_id, fecha_conversion | Dashboard ingresos |
| idx_user_activity_log_user_created | user_activity_log | user_id, created_at | Log de actividad por usuario |

---

## SQL Ejecutado

```sql
-- ============================================================
-- CRM MultiProyecto — Migracion 001: Schema inicial
-- Motor: PostgreSQL 15+
-- Ejecutar: psql -U crm_user -d crm_db -f 001_initial_schema.sql
-- ============================================================

BEGIN;

-- ============================================================
-- TIPOS ENUM
-- ============================================================

CREATE TYPE user_role AS ENUM ('superadmin', 'admin', 'gestor');
CREATE TYPE project_type AS ENUM ('crm', 'ia');
CREATE TYPE lead_status AS ENUM ('nuevo', 'por_contactar', 'contactado', 'en_seguimiento', 'convertido', 'no_interesado');
CREATE TYPE interaction_type AS ENUM ('llamada', 'email', 'whatsapp', 'nota');
CREATE TYPE payment_method AS ENUM ('transferencia', 'tarjeta', 'efectivo', 'fraccionado');
CREATE TYPE utm_channel AS ENUM ('meta_ads', 'google_ads', 'tiktok_ads', 'organico', 'chatgpt_ia', 'directo', 'referido');
CREATE TYPE api_service AS ENUM ('meta', 'google_ads', 'gsc', 'stripe', 'claude', 'brevo');

-- ============================================================
-- 1. USERS
-- ============================================================

CREATE TABLE users (
    id                    SERIAL        PRIMARY KEY,
    nombre                VARCHAR(200)  NOT NULL,
    email                 VARCHAR(255)  NOT NULL UNIQUE,
    password_hash         VARCHAR(255)  NOT NULL,
    role                  user_role     NOT NULL DEFAULT 'gestor',
    active                BOOLEAN       NOT NULL DEFAULT true,
    set_password_token    VARCHAR(255),
    set_password_expires  TIMESTAMPTZ,
    last_login_at         TIMESTAMPTZ,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. PROJECTS
-- ============================================================

CREATE TABLE projects (
    id                       SERIAL         PRIMARY KEY,
    nombre                   VARCHAR(200)   NOT NULL,
    slug                     VARCHAR(100)   NOT NULL UNIQUE,
    type                     project_type   NOT NULL DEFAULT 'crm',
    emoji                    VARCHAR(10),
    meta_account_id          VARCHAR(100),
    google_account_id        VARCHAR(100),
    gsc_property             VARCHAR(255),
    webhook_api_key          VARCHAR(255)   NOT NULL,
    dias_alerta_inactividad  INTEGER        NOT NULL DEFAULT 3,
    active                   BOOLEAN        NOT NULL DEFAULT true,
    created_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. USER_PROJECTS (relacion muchos-a-muchos + orden cola round-robin)
-- ============================================================

CREATE TABLE user_projects (
    id          SERIAL       PRIMARY KEY,
    user_id     INTEGER      NOT NULL,
    project_id  INTEGER      NOT NULL,
    orden_cola  INTEGER      NOT NULL DEFAULT 0,
    active      BOOLEAN      NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_user_projects_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_projects_project
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT uq_user_projects_user_project
        UNIQUE (user_id, project_id)
);

-- ============================================================
-- 4. PRODUCTS
-- ============================================================

CREATE TABLE products (
    id           SERIAL        PRIMARY KEY,
    project_id   INTEGER       NOT NULL,
    nombre       VARCHAR(200)  NOT NULL,
    descripcion  TEXT,
    active       BOOLEAN       NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_products_project
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ============================================================
-- 5. DOSSIERS
-- ============================================================

CREATE TABLE dossiers (
    id                 SERIAL        PRIMARY KEY,
    product_id         INTEGER       NOT NULL,
    s3_key             VARCHAR(500)  NOT NULL,
    filename_original  VARCHAR(255)  NOT NULL,
    version            INTEGER       NOT NULL DEFAULT 1,
    active             BOOLEAN       NOT NULL DEFAULT true,
    size_bytes         BIGINT,
    subido_por         INTEGER       NOT NULL,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_dossiers_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_dossiers_subido_por
        FOREIGN KEY (subido_por) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================
-- 6. LEADS
-- ============================================================

CREATE TABLE leads (
    id                   SERIAL         PRIMARY KEY,
    project_id           INTEGER        NOT NULL,
    nombre               VARCHAR(200)   NOT NULL,
    email                VARCHAR(255)   NOT NULL,
    telefono             VARCHAR(50),
    producto_interes_id  INTEGER,
    status               lead_status    NOT NULL DEFAULT 'nuevo',
    responsable_id       INTEGER,
    dossier_enviado      BOOLEAN        NOT NULL DEFAULT false,
    dossier_enviado_at   TIMESTAMPTZ,
    notas                TEXT,
    lead_duplicado_de    INTEGER,
    landing_url          TEXT,
    fecha_solicitud      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_leads_project
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_leads_producto_interes
        FOREIGN KEY (producto_interes_id) REFERENCES products(id) ON DELETE SET NULL,
    CONSTRAINT fk_leads_responsable
        FOREIGN KEY (responsable_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_leads_duplicado
        FOREIGN KEY (lead_duplicado_de) REFERENCES leads(id) ON DELETE SET NULL
);

CREATE INDEX idx_leads_email              ON leads (email);
CREATE INDEX idx_leads_project_id         ON leads (project_id);
CREATE INDEX idx_leads_responsable_status ON leads (responsable_id, status);
CREATE INDEX idx_leads_project_status     ON leads (project_id, status);
CREATE INDEX idx_leads_fecha_solicitud    ON leads (fecha_solicitud);

-- ============================================================
-- 7. LEAD_UTMS (1:1 con leads)
-- ============================================================

CREATE TABLE lead_utms (
    id               SERIAL         PRIMARY KEY,
    lead_id          INTEGER        NOT NULL UNIQUE,
    utm_source       VARCHAR(100),
    utm_medium       VARCHAR(100),
    utm_campaign     VARCHAR(255),
    utm_content      VARCHAR(255),
    utm_term         VARCHAR(255),
    landing_url      TEXT,
    canal_detectado  utm_channel,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_lead_utms_lead
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

-- ============================================================
-- 8. LEAD_STATUS_HISTORY
-- ============================================================

CREATE TABLE lead_status_history (
    id               SERIAL       PRIMARY KEY,
    lead_id          INTEGER      NOT NULL,
    status_anterior  lead_status  NOT NULL,
    status_nuevo     lead_status  NOT NULL,
    changed_by       INTEGER      NOT NULL,
    changed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_lead_status_history_lead
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    CONSTRAINT fk_lead_status_history_user
        FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_lead_status_history_lead_id ON lead_status_history (lead_id);

-- ============================================================
-- 9. LEAD_INTERACTIONS
-- ============================================================

CREATE TABLE lead_interactions (
    id          SERIAL            PRIMARY KEY,
    lead_id     INTEGER           NOT NULL,
    tipo        interaction_type  NOT NULL,
    nota        TEXT,
    fecha       TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    created_by  INTEGER           NOT NULL,
    created_at  TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_lead_interactions_lead
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    CONSTRAINT fk_lead_interactions_user
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_lead_interactions_lead_id ON lead_interactions (lead_id);

-- ============================================================
-- 10. LEAD_REMINDERS
-- ============================================================

CREATE TABLE lead_reminders (
    id                  SERIAL       PRIMARY KEY,
    lead_id             INTEGER      NOT NULL,
    fecha_recordatorio  DATE         NOT NULL,
    nota                TEXT,
    completado          BOOLEAN      NOT NULL DEFAULT false,
    created_by          INTEGER      NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_lead_reminders_lead
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    CONSTRAINT fk_lead_reminders_user
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================
-- 11. CONVERSIONS
-- ============================================================

CREATE TABLE conversions (
    id                     SERIAL          PRIMARY KEY,
    lead_id                INTEGER         NOT NULL,
    project_id             INTEGER         NOT NULL,
    producto_contratado    VARCHAR(255)    NOT NULL,
    importe_total          DECIMAL(10,2)   NOT NULL,
    importe_pagado         DECIMAL(10,2)   NOT NULL DEFAULT 0,
    fecha_compromiso_pago  DATE,
    metodo_pago            payment_method,
    notas_pago             TEXT,
    fecha_conversion       DATE            NOT NULL DEFAULT CURRENT_DATE,
    created_at             TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_conversions_lead
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    CONSTRAINT fk_conversions_project
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_conversions_project_fecha ON conversions (project_id, fecha_conversion);

-- ============================================================
-- 12. CONVERSION_PAYMENTS
-- ============================================================

CREATE TABLE conversion_payments (
    id             SERIAL         PRIMARY KEY,
    conversion_id  INTEGER        NOT NULL,
    importe        DECIMAL(10,2)  NOT NULL,
    fecha          DATE           NOT NULL DEFAULT CURRENT_DATE,
    notas          TEXT,
    created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_conversion_payments_conversion
        FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE CASCADE
);

-- ============================================================
-- 13. PROJECT_QUEUE_STATE (round-robin)
-- ============================================================

CREATE TABLE project_queue_state (
    id                     SERIAL       PRIMARY KEY,
    project_id             INTEGER      NOT NULL UNIQUE,
    last_assigned_user_id  INTEGER,
    last_assigned_index    INTEGER      NOT NULL DEFAULT 0,
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_project_queue_state_project
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_project_queue_state_user
        FOREIGN KEY (last_assigned_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================
-- 14. USER_ACTIVITY_LOG
-- ============================================================

CREATE TABLE user_activity_log (
    id          SERIAL        PRIMARY KEY,
    user_id     INTEGER       NOT NULL,
    action      VARCHAR(100)  NOT NULL,
    details     JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_user_activity_log_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_user_activity_log_user_created ON user_activity_log (user_id, created_at);

COMMIT;
```

---

## Seed: 001_seed_initial.sql

**Archivo fuente:** `backend/seeds/001_seed_initial.sql`

Datos iniciales para que el sistema funcione desde el primer momento.

### Datos insertados

| Tabla | Registros | Detalle |
|-------|-----------|---------|
| users | 3 | Manuel (superadmin), Diego (admin), Angel (admin) |
| projects | 6 | Psiko Aprende, ISEIH, Fono Aprende + 3 IAs |
| products | 12 | Cursos y planes por proyecto |
| user_projects | 10 | Manuel=todos, Diego=Psiko+ISEIH, Angel=Psiko+Fono |
| project_queue_state | 3 | Round-robin inicializado para los 3 proyectos CRM |

### SQL Ejecutado

```sql
-- ============================================================
-- CRM MultiProyecto — Seed inicial
-- Ejecutar despues de 001_initial_schema.sql
-- password_hash = bcrypt('<SEED_TEMP_PASSWORD>', cost=12)
-- El plaintext y los hashes reales viven en fase-1/CREDENCIALES-PRIVADO.md (no versionado).
-- Los usuarios deben cambiar su contrasena en el primer login.
-- ============================================================

BEGIN;

-- USUARIOS (password temporal: ver CREDENCIALES-PRIVADO.md)
INSERT INTO users (nombre, email, password_hash, role) VALUES
  ('Manuel Casas', 'manuel@empresa.com', '<BCRYPT_HASH>', 'superadmin'),
  ('Diego R.',     'diego@empresa.com',  '<BCRYPT_HASH>', 'admin'),
  ('Angel M.',     'angel@empresa.com',  '<BCRYPT_HASH>', 'admin');

-- PROYECTOS (webhook_api_key generada con UUID aleatorio)
INSERT INTO projects (nombre, slug, type, emoji, webhook_api_key) VALUES
  ('Psiko Aprende',    'psiko-aprende',    'crm', '🧠', 'whk_psiko_' || gen_random_uuid()),
  ('ISEIH',            'iseih',            'crm', '🎓', 'whk_iseih_' || gen_random_uuid()),
  ('Fono Aprende',     'fono-aprende',     'crm', '🗣️', 'whk_fono_' || gen_random_uuid()),
  ('Psicologo IA',     'psicologo-ia',     'ia',  '🤖', 'whk_psicoia_' || gen_random_uuid()),
  ('Nutricionista IA', 'nutricionista-ia', 'ia',  '🥗', 'whk_nutria_' || gen_random_uuid()),
  ('Tarot IA',         'tarot-ia',         'ia',  '🔮', 'whk_tarotia_' || gen_random_uuid());

-- ASIGNACION USUARIOS A PROYECTOS
-- Manuel (superadmin) tiene acceso a todos
INSERT INTO user_projects (user_id, project_id, orden_cola)
SELECT 1, id, 0 FROM projects;

-- Diego: Psiko Aprende, ISEIH
INSERT INTO user_projects (user_id, project_id, orden_cola) VALUES
  (2, 1, 1),
  (2, 2, 1);

-- Angel: Psiko Aprende, Fono Aprende
INSERT INTO user_projects (user_id, project_id, orden_cola) VALUES
  (3, 1, 2),
  (3, 3, 1);

-- PRODUCTOS INICIALES
INSERT INTO products (project_id, nombre, descripcion) VALUES
  (1, 'Curso Psicologia Infantil', 'Formacion intensiva en psicologia infantil y adolescente — 6 meses'),
  (1, 'Master Neuroeducacion', 'Master oficial en neuroeducacion aplicada — 12 meses'),
  (1, 'Taller Mindfulness Educativo', 'Taller practico de mindfulness para docentes — 3 meses'),
  (2, 'Grado Superior Educacion Infantil', 'Ciclo formativo oficial de 2 anos'),
  (2, 'Curso Atencion Temprana', 'Especializacion en atencion temprana 0-6 anos'),
  (3, 'Taller Logopedia Infantil', 'Taller practico de logopedia para ninos'),
  (3, 'Curso Dislexia y Lectoescritura', 'Intervencion en dificultades de lectoescritura'),
  (3, 'Master Terapia Miofuncional', 'Master en terapia miofuncional orofacial'),
  (4, 'Plan Basico', 'Acceso a chatbot IA con 50 consultas/mes'),
  (4, 'Plan Premium', 'Consultas ilimitadas + seguimiento semanal'),
  (5, 'Plan Mensual', 'Plan nutricional personalizado por IA'),
  (6, 'Lectura Completa', 'Lectura de tarot completa con IA');

-- ESTADO COLA ROUND-ROBIN (inicializar para proyectos CRM)
INSERT INTO project_queue_state (project_id, last_assigned_index)
SELECT id, 0 FROM projects WHERE type = 'crm';

COMMIT;
```

---

## Ejecuciones

### crm_test_db (staging)
- **Fecha:** 2026-04-06
- **Ejecutado por:** Claude via SSH (`ssh claude@187.124.128.126`)
- **Comando:** `PGPASSWORD="<DB_PASSWORD>" psql -h localhost -U crm_user -d crm_test_db -f /tmp/001_initial_schema.sql`
- **Resultado:** OK - 14 tablas, 7 enums, 9 indices
- **Seed:** OK - 3 usuarios, 6 proyectos, 12 productos, 10 asignaciones, 3 queue states

### crm_db (produccion)
- **Fecha:** 2026-04-06
- **Ejecutado por:** Claude via SSH
- **Comando:** `PGPASSWORD="<DB_PASSWORD>" psql -h localhost -U crm_user -d crm_db -f /tmp/001_initial_schema.sql`
- **Resultado:** OK - 14 tablas, 7 enums, 9 indices
- **Seed:** OK - mismos datos que staging

### Verificacion post-ejecucion

```
users: 3
projects: 6
products: 12
user_projects: 10
queue_state: 3
```

### Notas

- La migracion 002_products_dossiers.sql NO se ejecuto porque es redundante (products y dossiers ya estan en la 001)
- Password temporal de los 3 usuarios: `<SEED_TEMP_PASSWORD>` (bcrypt cost 12) — ver `fase-1/CREDENCIALES-PRIVADO.md`
- Las webhook_api_key de cada proyecto son UUIDs unicos generados por `gen_random_uuid()`
