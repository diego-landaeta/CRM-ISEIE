-- Egresos: categorías auto-generadas + comprobante + origen automático.
-- Porta a ISEIE lo que ISEIH ya tenía (su migración 082), que es lo que hacía que
-- la pantalla de Egresos de ISEIE ni siquiera abriera.
--
-- Los ALTER TYPE van FUERA de transacción a propósito: PostgreSQL no permite usar
-- un valor de enum recién añadido dentro de la misma transacción en que se crea.
-- Cada bloque es idempotente, así que relanzarla no rompe nada.

ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'comision_pasarela_pago';
ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'comision_gestor';
ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'nomina';

BEGIN;

-- Comprobante del gasto (PDF o imagen).
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS comprobante_url TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS comprobante_key VARCHAR(500);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS comprobante_mime VARCHAR(50);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS comprobante_size_bytes INTEGER;

-- Origen automático. El UNIQUE evita duplicar el gasto si el hook se dispara dos veces.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source_payable_id INTEGER;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source_stripe_payout_id VARCHAR(100);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_source_payable_unique') THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_source_payable_unique UNIQUE (source_payable_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_source_stripe_payout_unique') THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_source_stripe_payout_unique UNIQUE (source_stripe_payout_id);
  END IF;
END $$;

COMMIT;
