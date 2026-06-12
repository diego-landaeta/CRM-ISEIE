-- EPIC B — Egresos / Gastos
-- Añade categorías auto-generadas (B0 Stripe / F nóminas) + columnas para
-- comprobante PDF/imagen + claves de origen automático (anti-duplicación).
--
-- Idempotente: usa IF NOT EXISTS y ADD VALUE IF NOT EXISTS (PG 12+).

BEGIN;

-- 1) Categorías nuevas en el enum `expense_category`.
--    En PostgreSQL ALTER TYPE ADD VALUE NO se puede hacer dentro de transacción
--    si la siguiente operación los necesita, así que las añadimos primero y
--    cerramos parcialmente. Para máxima compatibilidad las hago una por una.
COMMIT;

-- ADD VALUE no admite transacción explícita en algunos backends.
ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'comision_pasarela_pago';
ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'comision_gestor';
ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'nomina';

BEGIN;

-- 2) Columnas para comprobante (archivo)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS comprobante_url TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS comprobante_key VARCHAR(500);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS comprobante_mime VARCHAR(50);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS comprobante_size_bytes INTEGER;

-- 3) Columnas para origen automático (anti-duplicación)
--    source_payable_id: hook C → cuando se completa pago de accounts_payable
--    source_stripe_payout_id: hook B0 → fee de Stripe payout
--    UNIQUE para que si el hook se dispara 2 veces no duplique el expense.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source_payable_id INTEGER;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source_stripe_payout_id VARCHAR(100);

-- UNIQUE solo si no existen ya las constraints (idempotente)
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

-- ROLLBACK:
--   ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_source_payable_unique;
--   ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_source_stripe_payout_unique;
--   ALTER TABLE expenses DROP COLUMN IF EXISTS comprobante_url;
--   ALTER TABLE expenses DROP COLUMN IF EXISTS comprobante_key;
--   ALTER TABLE expenses DROP COLUMN IF EXISTS comprobante_mime;
--   ALTER TABLE expenses DROP COLUMN IF EXISTS comprobante_size_bytes;
--   ALTER TABLE expenses DROP COLUMN IF EXISTS source_payable_id;
--   ALTER TABLE expenses DROP COLUMN IF EXISTS source_stripe_payout_id;
--   -- Los valores enum no se pueden quitar fácilmente sin recrear el tipo.
--   -- Si necesitas revertir limpiamente, eliminar y recrear el enum es OK
--   -- mientras la tabla expenses esté vacía o haya filas con valores antiguos.
