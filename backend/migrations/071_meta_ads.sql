-- Integración Meta Marketing API (extracción de métricas, solo lectura).
-- 1:1 cuenta por proyecto.

CREATE TABLE IF NOT EXISTS meta_ad_accounts (
  id                    SERIAL PRIMARY KEY,
  project_id            INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  ad_account_id         VARCHAR(50) NOT NULL,                 -- ej. 'act_1234567890'
  -- Token cifrado AES-256-GCM. Formato: '<iv_hex>:<tag_hex>:<ciphertext_hex>'.
  access_token_enc      TEXT NOT NULL,
  ad_account_nombre     VARCHAR(255),                          -- cacheado para mostrar en UI
  currency              VARCHAR(10),
  timezone_name         VARCHAR(50),
  last_synced_at        TIMESTAMPTZ,
  last_sync_status      VARCHAR(20),                           -- 'ok' | 'error' | 'in_progress'
  last_sync_error       TEXT,
  backfill_done         BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Snapshot actual de cada campaña (estado, objetivo, presupuesto).
CREATE TABLE IF NOT EXISTS meta_campaigns (
  campaign_id           VARCHAR(50) PRIMARY KEY,               -- id de Meta
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ad_account_id         VARCHAR(50) NOT NULL,
  nombre                VARCHAR(500) NOT NULL,
  objective             VARCHAR(50),                            -- OUTCOME_LEADS, CONVERSIONS, etc
  status                VARCHAR(20),                            -- ACTIVE, PAUSED, DELETED, ARCHIVED
  effective_status      VARCHAR(50),
  daily_budget          NUMERIC(12,2),
  lifetime_budget       NUMERIC(12,2),
  start_time            TIMESTAMPTZ,
  stop_time             TIMESTAMPTZ,
  -- Totales agregados (re-calculados desde meta_campaigns_daily al sync)
  total_spend           NUMERIC(12,2) DEFAULT 0,
  total_impressions     BIGINT DEFAULT 0,
  total_reach           BIGINT DEFAULT 0,
  total_clicks          BIGINT DEFAULT 0,
  total_leads           INTEGER DEFAULT 0,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_project ON meta_campaigns(project_id);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_status ON meta_campaigns(project_id, status);

-- Métricas por día (granularidad para gráficas y comparativas temporales).
CREATE TABLE IF NOT EXISTS meta_campaigns_daily (
  id                    SERIAL PRIMARY KEY,
  campaign_id           VARCHAR(50) NOT NULL REFERENCES meta_campaigns(campaign_id) ON DELETE CASCADE,
  project_id            INTEGER NOT NULL,
  date                  DATE NOT NULL,
  spend                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions           BIGINT NOT NULL DEFAULT 0,
  reach                 BIGINT NOT NULL DEFAULT 0,
  clicks                BIGINT NOT NULL DEFAULT 0,
  leads                 INTEGER NOT NULL DEFAULT 0,             -- onsite_conversion.lead o action_type='lead'
  ctr                   NUMERIC(8,4),
  cpc                   NUMERIC(10,4),
  cpm                   NUMERIC(10,4),
  cpl                   NUMERIC(10,4),
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, date)
);
CREATE INDEX IF NOT EXISTS idx_meta_daily_project_date ON meta_campaigns_daily(project_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_daily_campaign_date ON meta_campaigns_daily(campaign_id, date DESC);

-- ROI manual: asociación de campaña ↔ producto(s). Admin marca qué productos
-- promociona cada campaña. Después se calcula: spend(campaña) vs facturado(productos asociados).
CREATE TABLE IF NOT EXISTS meta_campaign_products (
  id                    SERIAL PRIMARY KEY,
  campaign_id           VARCHAR(50) NOT NULL REFERENCES meta_campaigns(campaign_id) ON DELETE CASCADE,
  product_id            INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asociado_por_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notas                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_mcp_campaign ON meta_campaign_products(campaign_id);
CREATE INDEX IF NOT EXISTS idx_mcp_project ON meta_campaign_products(project_id);
