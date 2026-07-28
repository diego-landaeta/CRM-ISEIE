-- Comisión y neto liquidado por Stripe en cada cobro.
--
-- La factura del ALUMNO va por el importe BRUTO (lo que él pagó), pero para gestión
-- interna hace falta el NETO (lo que Stripe ingresa de verdad tras su comisión).
-- Stripe ya devuelve ambos en balance_transaction (fee/net); solo faltaba guardarlos.
-- Se rellenan en la siguiente sincronización; los cobros antiguos quedan a NULL y la
-- copia de gestión avisa de que no consta la comisión.
ALTER TABLE stripe_payments ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(12,2);
ALTER TABLE stripe_payments ADD COLUMN IF NOT EXISTS net_amount NUMERIC(12,2);
