-- ============================================================
-- Migración 103: Proformas / presupuestos
-- Una proforma es un documento NO fiscal (presupuesto). Reutiliza la tabla
-- invoices con tipo='proforma', su propia serie (issuer.serie_proforma, def 'PRO')
-- y un contador separado — NO consume el correlativo fiscal 'A'.
-- Ver docs/10-facturacion.md (spec REQ-NUM-05).
-- Aditiva e idempotente.
-- ============================================================

BEGIN;

-- Extiende el CHECK de invoices.tipo para admitir 'proforma'.
-- Elimina cualquier CHECK existente sobre la columna `tipo` (nombre auto-generado
-- puede variar entre instancias) y lo recrea con el valor añadido. Idempotente.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel  ON rel.oid = con.conrelid
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
     WHERE rel.relname = 'invoices' AND con.contype = 'c' AND att.attname = 'tipo'
  LOOP
    EXECUTE format('ALTER TABLE invoices DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE invoices ADD CONSTRAINT invoices_tipo_check
  CHECK (tipo IN ('normal', 'rectificativa', 'proforma'));

-- Enlace opcional: cuando una proforma se convierte en factura real (Fase C),
-- la proforma guarda el id de la factura emitida (trazabilidad, sin duplicar).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS convertida_factura_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_invoice_tipo_proforma ON invoices (project_id, tipo)
  WHERE tipo = 'proforma';

COMMENT ON COLUMN invoices.convertida_factura_id IS 'Si esta proforma se convirtió en factura, id de la factura emitida';

COMMIT;
