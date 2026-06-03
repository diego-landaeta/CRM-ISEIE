-- Cola de revisión de duplicados.
-- El webhook NO se detiene — Make recibe 200 OK al instante. Si hay duplicado,
-- el lead se persiste igual + se añade una entrada aquí para que admin decida.
--
-- Estados:
--   'pending'   → recién llegado, admin no ha decidido
--   'approved'  → admin valida, el lead duplicado se queda activo
--   'merged'    → admin fusionó (usar endpoint /merge), el loser ya está soft-deleted
--   'rejected'  → admin descartó, el lead duplicado se soft-deleted con motivo

CREATE TABLE IF NOT EXISTS lead_duplicate_review_queue (
  id                    SERIAL PRIMARY KEY,
  lead_id               INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  original_lead_id      INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  match_by_email        BOOLEAN NOT NULL DEFAULT FALSE,
  match_by_phone        BOOLEAN NOT NULL DEFAULT FALSE,
  source                VARCHAR(20) NOT NULL DEFAULT 'webhook', -- 'webhook' | 'manual' | 'wc'
  status                VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|approved|merged|rejected
  decided_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at            TIMESTAMPTZ,
  notas                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id)  -- un lead solo puede tener una entrada en la cola
);

CREATE INDEX IF NOT EXISTS idx_dup_queue_status ON lead_duplicate_review_queue(status, project_id);
CREATE INDEX IF NOT EXISTS idx_dup_queue_created ON lead_duplicate_review_queue(created_at DESC);
