-- 083 — Campo opcional de dirección fiscal en leads (para facturas).
-- Texto libre: calle, número, piso, código postal, ciudad, provincia, país.
-- No afecta lógica de duplicados ni de matriculas. Idempotente.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS direccion_fiscal TEXT;

COMMENT ON COLUMN leads.direccion_fiscal IS
  'Dirección fiscal del cliente (texto libre) — opcional, solo se usa al emitir factura.';
