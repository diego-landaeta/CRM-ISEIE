-- 1) Hasta que fecha estan ya revisados los cobros de Stripe.
--    Los anteriores no vuelven a salir como pendientes de asociar: ya se
--    miraron uno a uno y lo que quedaba sin cliente se dejo asi a proposito.
--
-- 2) Las proformas que emite una gestora quedan pendientes de aprobacion:
--    se crean como borrador (sin numero) y no gastan correlativo hasta que
--    quien lleva la facturacion las aprueba.

BEGIN;

ALTER TABLE invoicing_status ADD COLUMN IF NOT EXISTS stripe_ok_hasta DATE;

COMMENT ON COLUMN invoicing_status.stripe_ok_hasta IS
  'Cobros de Stripe anteriores a esta fecha ya revisados: dejan de listarse como pendientes.';

COMMIT;
