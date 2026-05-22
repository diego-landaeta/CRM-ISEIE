-- ============================================================
-- Migración 037: Página de status del sistema. Owner crm_iseie_user.
-- ============================================================

CREATE TABLE IF NOT EXISTS status_components (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  slug       VARCHAR(60) NOT NULL UNIQUE,
  status     VARCHAR(30) NOT NULL DEFAULT 'operational',
  position   INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS status_incidents (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(300) NOT NULL,
  description TEXT,
  severity    VARCHAR(20) NOT NULL DEFAULT 'warning',
  status      VARCHAR(30) NOT NULL DEFAULT 'investigating',
  affects     TEXT[] NOT NULL DEFAULT '{}',
  resolved_at TIMESTAMPTZ,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS status_errors (
  id          SERIAL PRIMARY KEY,
  method      VARCHAR(10),
  path        VARCHAR(500),
  status_code INTEGER,
  message     TEXT,
  stack       TEXT,
  user_id     INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_status_incidents_status ON status_incidents(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_errors_created ON status_errors(created_at DESC);

INSERT INTO status_components (name, slug, position) VALUES
  ('API',            'api',     0),
  ('Base de datos',  'db',      1),
  ('Email (Brevo)',  'email',   2),
  ('Almacenamiento', 'storage', 3),
  ('IA (Claude)',    'ia',      4)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE status_components OWNER TO crm_iseie_user;
ALTER TABLE status_incidents OWNER TO crm_iseie_user;
ALTER TABLE status_errors OWNER TO crm_iseie_user;
ALTER SEQUENCE status_components_id_seq OWNER TO crm_iseie_user;
ALTER SEQUENCE status_incidents_id_seq OWNER TO crm_iseie_user;
ALTER SEQUENCE status_errors_id_seq OWNER TO crm_iseie_user;
