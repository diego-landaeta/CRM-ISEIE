-- 107_invoice_per_payment.sql
-- Facturación por pago (spec owner 2026-07-16): cada pago (abono) de una
-- conversión genera su PROPIA factura por el monto abonado; el resto queda
-- pendiente. Un programa pagado en 5 abonos → 5 facturas correlativas.
--
-- Enlazamos cada factura con el pago que la originó (conversion_payments.id).
-- Esto reemplaza el modelo anterior de "1 factura por conversión al importe
-- total". Las facturas antiguas quedan con payment_id = NULL (no se tocan).

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS payment_id INTEGER REFERENCES conversion_payments(id) ON DELETE SET NULL;

-- Un pago no puede tener dos facturas vivas. Índice único parcial (ignora
-- canceladas y las facturas sin pago asociado).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_payment_activo
  ON invoices(payment_id)
  WHERE payment_id IS NOT NULL AND estado <> 'cancelada';

CREATE INDEX IF NOT EXISTS idx_invoices_payment_id ON invoices(payment_id);

COMMENT ON COLUMN invoices.payment_id IS 'Pago (conversion_payments) que originó la factura. Cada abono lleva su factura por el monto pagado.';
