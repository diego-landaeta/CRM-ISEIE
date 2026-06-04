-- Etapa 3: AdSets y Ads. Misma forma que campaigns (snapshot + daily).
-- Permite drill-down Campaign → AdSet → Ad en el panel Meta Ads.

CREATE TABLE IF NOT EXISTS meta_adsets (
  adset_id              VARCHAR(50) PRIMARY KEY,
  campaign_id           VARCHAR(50) NOT NULL REFERENCES meta_campaigns(campaign_id) ON DELETE CASCADE,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nombre                VARCHAR(500) NOT NULL,
  status                VARCHAR(20),
  effective_status      VARCHAR(50),
  optimization_goal     VARCHAR(50),                            -- LEAD_GENERATION, PURCHASES, etc.
  billing_event         VARCHAR(30),                            -- IMPRESSIONS, LINK_CLICKS
  daily_budget          NUMERIC(12,2),
  lifetime_budget       NUMERIC(12,2),
  start_time            TIMESTAMPTZ,
  end_time              TIMESTAMPTZ,
  total_spend           NUMERIC(12,2) DEFAULT 0,
  total_impressions     BIGINT DEFAULT 0,
  total_reach           BIGINT DEFAULT 0,
  total_clicks          BIGINT DEFAULT 0,
  total_leads           INTEGER DEFAULT 0,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meta_adsets_campaign ON meta_adsets(campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_adsets_project ON meta_adsets(project_id);

CREATE TABLE IF NOT EXISTS meta_adsets_daily (
  id                    SERIAL PRIMARY KEY,
  adset_id              VARCHAR(50) NOT NULL REFERENCES meta_adsets(adset_id) ON DELETE CASCADE,
  campaign_id           VARCHAR(50) NOT NULL,
  project_id            INTEGER NOT NULL,
  date                  DATE NOT NULL,
  spend                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions           BIGINT NOT NULL DEFAULT 0,
  reach                 BIGINT NOT NULL DEFAULT 0,
  clicks                BIGINT NOT NULL DEFAULT 0,
  leads                 INTEGER NOT NULL DEFAULT 0,
  ctr                   NUMERIC(8,4),
  cpc                   NUMERIC(10,4),
  cpm                   NUMERIC(10,4),
  cpl                   NUMERIC(10,4),
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (adset_id, date)
);
CREATE INDEX IF NOT EXISTS idx_meta_adsets_daily_adset ON meta_adsets_daily(adset_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_adsets_daily_project ON meta_adsets_daily(project_id, date DESC);

CREATE TABLE IF NOT EXISTS meta_ads (
  ad_id                 VARCHAR(50) PRIMARY KEY,
  adset_id              VARCHAR(50) NOT NULL REFERENCES meta_adsets(adset_id) ON DELETE CASCADE,
  campaign_id           VARCHAR(50) NOT NULL,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nombre                VARCHAR(500) NOT NULL,
  status                VARCHAR(20),
  effective_status      VARCHAR(50),
  creative_id           VARCHAR(50),
  created_time          TIMESTAMPTZ,
  total_spend           NUMERIC(12,2) DEFAULT 0,
  total_impressions     BIGINT DEFAULT 0,
  total_reach           BIGINT DEFAULT 0,
  total_clicks          BIGINT DEFAULT 0,
  total_leads           INTEGER DEFAULT 0,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meta_ads_adset ON meta_ads(adset_id);
CREATE INDEX IF NOT EXISTS idx_meta_ads_campaign ON meta_ads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_ads_project ON meta_ads(project_id);

CREATE TABLE IF NOT EXISTS meta_ads_daily (
  id                    SERIAL PRIMARY KEY,
  ad_id                 VARCHAR(50) NOT NULL REFERENCES meta_ads(ad_id) ON DELETE CASCADE,
  adset_id              VARCHAR(50) NOT NULL,
  campaign_id           VARCHAR(50) NOT NULL,
  project_id            INTEGER NOT NULL,
  date                  DATE NOT NULL,
  spend                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions           BIGINT NOT NULL DEFAULT 0,
  reach                 BIGINT NOT NULL DEFAULT 0,
  clicks                BIGINT NOT NULL DEFAULT 0,
  leads                 INTEGER NOT NULL DEFAULT 0,
  ctr                   NUMERIC(8,4),
  cpc                   NUMERIC(10,4),
  cpm                   NUMERIC(10,4),
  cpl                   NUMERIC(10,4),
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ad_id, date)
);
CREATE INDEX IF NOT EXISTS idx_meta_ads_daily_ad ON meta_ads_daily(ad_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_ads_daily_project ON meta_ads_daily(project_id, date DESC);
