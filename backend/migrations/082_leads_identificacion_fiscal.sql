-- 082 — Campo opcional de identificación fiscal en leads (para facturas).
-- Acepta NIF, CIF, NIE, cédula, RFC, RUC, etc. Solo se usa al emitir factura;
-- no afecta lógica de duplicados ni de matriculas. Idempotente.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS identificacion_fiscal VARCHAR(50);

COMMENT ON COLUMN leads.identificacion_fiscal IS
  'Documento fiscal del cliente (NIF/CIF/NIE/cédula/RFC/etc) — opcional, solo se usa al emitir factura.';
