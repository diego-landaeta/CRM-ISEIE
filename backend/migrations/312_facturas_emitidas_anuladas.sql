-- 312 · Facturas emitidas: no se borran ni se cambian; se anulan con su motivo (ISEIE#478, gemela de CRM#793, 18/11/2026)
--
-- Decisión de Diego del 18/11: una factura emitida no se puede borrar ni
-- cambiar (ni el importe, ni el número, ni el cliente, ni la fecha). Si hay que
-- dejarla sin efecto se ANULA indicando el motivo: queda apuntado quién y por
-- qué, y sale su rectificativa (abono) por el cauce de siempre
-- (`rectifica_id`, `motivo_rectificacion`).
--
-- La anulada NO cambia de estado: sigue contando, y su abono la deja a cero.
-- Si se pasara a 'cancelada', el resto del CRM (informes, caja, cuadre) dejaría
-- de sumarla y el abono restaría dos veces.
--
--   · anulada_at        cuándo se anuló.
--   · anulada_por       quién la anuló.
--   · motivo_anulacion  por qué (obligatorio al anular).
--   · anulada_abono_id  el abono que salió al anularla (si quedaba algo por abonar).
--
-- Se puede pasar dos veces.

BEGIN;

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS anulada_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS anulada_por      INTEGER,
    ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT,
    ADD COLUMN IF NOT EXISTS anulada_abono_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_inv_anulada_por') THEN
    ALTER TABLE invoices
      ADD CONSTRAINT fk_inv_anulada_por FOREIGN KEY (anulada_por) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_inv_anulada_abono') THEN
    ALTER TABLE invoices
      ADD CONSTRAINT fk_inv_anulada_abono FOREIGN KEY (anulada_abono_id) REFERENCES invoices(id) ON DELETE SET NULL;
  END IF;
  -- Anulada siempre con su motivo.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_inv_anulada_con_motivo') THEN
    ALTER TABLE invoices
      ADD CONSTRAINT chk_inv_anulada_con_motivo
      CHECK (anulada_at IS NULL OR NULLIF(btrim(motivo_anulacion), '') IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_anuladas ON invoices (ano, serie) WHERE anulada_at IS NOT NULL;

COMMENT ON COLUMN invoices.anulada_at IS
  'Cuándo se anuló la factura emitida (312, gemela de CRM#793). Sigue contando: su abono la deja a cero.';
COMMENT ON COLUMN invoices.motivo_anulacion IS
  'Por qué se anuló (obligatorio). También en el motivo_rectificacion de su abono.';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
