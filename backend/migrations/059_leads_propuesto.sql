-- ============================================================
-- Migración 059: flag "propuesto" (cross-sell)
-- Nuestro 001 consolidado creó `leads.propuesto BOOLEAN`. El hermano
-- usa `es_propuesto`. Renombramos para paridad de schema + añadimos
-- `propuesto_de` (FK a lead original) que faltaba.
-- ============================================================

BEGIN;

DO $$
BEGIN
  -- Caso 1: si NO existe es_propuesto y SÍ existe propuesto → rename
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='leads' AND column_name='es_propuesto')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='leads' AND column_name='propuesto') THEN
    EXECUTE 'ALTER TABLE leads RENAME COLUMN propuesto TO es_propuesto';
  -- Caso 2: instalación limpia (ninguna existe) → crear es_propuesto
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='leads' AND column_name='es_propuesto') THEN
    EXECUTE 'ALTER TABLE leads ADD COLUMN es_propuesto BOOLEAN NOT NULL DEFAULT false';
  END IF;
END$$;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS propuesto_de INTEGER REFERENCES leads(id) ON DELETE SET NULL;

COMMENT ON COLUMN leads.es_propuesto IS 'true si el email ya pertenece a un cliente convertido y ahora pregunta por otro producto (cross-sell).';
COMMENT ON COLUMN leads.propuesto_de IS 'Id del lead original (convertido) del que viene la propuesta.';

-- Drop index viejo (basado en columna propuesto) y crear el nuevo
DROP INDEX IF EXISTS idx_leads_propuesto;
CREATE INDEX IF NOT EXISTS idx_leads_propuesto ON leads(project_id, es_propuesto) WHERE es_propuesto = true;

COMMIT;
