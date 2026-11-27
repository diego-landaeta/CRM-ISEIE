-- Conectar un portfolio de Meta (Business Manager) entero: las cuentas publicitarias
-- nuevas que se creen dentro aparecen solas en una bandeja, sin conectarlas a mano (#198, gemela de CRM#212).

CREATE TABLE IF NOT EXISTS meta_business_portfolios (
  id                    SERIAL PRIMARY KEY,
  business_id           VARCHAR(50) NOT NULL UNIQUE,            -- id del portfolio en Meta
  nombre                VARCHAR(255),                           -- cacheado para mostrar en UI
  -- Token cifrado AES-256-GCM. Formato: '<iv_hex>:<tag_hex>:<ciphertext_hex>'.
  access_token_enc      TEXT NOT NULL,
  last_synced_at        TIMESTAMPTZ,
  last_sync_status      VARCHAR(20),                            -- 'ok' | 'error' | 'in_progress'
  last_sync_error       TEXT,
  created_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cada cuenta que aparece al listar el portfolio: ya asignada, nueva, ignorada o sin acceso.
CREATE TABLE IF NOT EXISTS meta_portfolio_discovered_accounts (
  id                    SERIAL PRIMARY KEY,
  portfolio_id          INTEGER NOT NULL REFERENCES meta_business_portfolios(id) ON DELETE CASCADE,
  ad_account_id         VARCHAR(50) NOT NULL,                   -- ej. 'act_1234567890'
  nombre                VARCHAR(255),                           -- nombre de la cuenta en Meta
  estado                VARCHAR(20) NOT NULL DEFAULT 'nueva'
                          CHECK (estado IN ('nueva', 'asignada', 'ignorada', 'sin_acceso')),
  campus_sugerido_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  meta_ad_account_id    INTEGER REFERENCES meta_ad_accounts(id) ON DELETE SET NULL, -- al asignarla
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (portfolio_id, ad_account_id)
);
CREATE INDEX IF NOT EXISTS idx_mpda_portfolio ON meta_portfolio_discovered_accounts(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_mpda_estado ON meta_portfolio_discovered_accounts(estado);

DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['meta_business_portfolios', 'meta_portfolio_discovered_accounts'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', t, r);
      END LOOP;
      FOREACH t IN ARRAY ARRAY['meta_business_portfolios_id_seq', 'meta_portfolio_discovered_accounts_id_seq'] LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;