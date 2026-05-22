-- ============================================================
-- Migracion 004: Campo reincidente en leads
-- Alinea con PDF spec: si lead duplicado es en mismo proyecto
-- Y mismo producto, se marca como reincidente (prioridad alta)
-- ============================================================

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS reincidente BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_leads_reincidente
  ON leads (project_id, reincidente)
  WHERE reincidente = true;

COMMIT;
