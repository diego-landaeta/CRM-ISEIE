-- ============================================================
-- 030: Bundles de instalacion (CRM-302). Singleton id=1.
-- Owner ajustado a crm_iseie_user (en hermano: crm_user).
-- ============================================================

CREATE TABLE IF NOT EXISTS installation_bundles (
  id SERIAL PRIMARY KEY,
  active_bundles TEXT[] NOT NULL DEFAULT ARRAY['core', 'leads', 'comercial', 'accounting', 'payroll', 'ia', 'marketing', 'ecommerce'],
  license_type VARCHAR(40) NOT NULL DEFAULT 'all-in',
  license_key TEXT,
  expires_at TIMESTAMPTZ,
  customer_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT installation_bundles_singleton CHECK (id = 1)
);

INSERT INTO installation_bundles (id, license_type, customer_name)
VALUES (1, 'all-in', 'Default installation')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE installation_bundles OWNER TO crm_iseie_user;
ALTER SEQUENCE installation_bundles_id_seq OWNER TO crm_iseie_user;
