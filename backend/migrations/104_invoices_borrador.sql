-- ============================================================
-- Migracion 104: Facturas en BORRADOR (preliminares)
-- - Nuevo estado 'borrador': factura creada al convertir aunque falten
--   datos fiscales. NO consume numero fiscal (numero/codigo NULL) hasta
--   que se valida y emite ("Validar y emitir" -> estado 'emitida').
-- - numero/codigo pasan a NULLABLE (solo los borradores los dejan vacios;
--   la emision los exige siempre).
-- ============================================================

BEGIN;

-- 1) numero y codigo aceptan NULL (borradores sin numeracion fiscal).
ALTER TABLE invoices ALTER COLUMN numero DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN codigo DROP NOT NULL;

-- 2) CHECK de estado: aniadir 'borrador'. El nombre del constraint puede
--    variar entre entornos -> DO block que dropea cualquier CHECK sobre estado.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    WHERE c.relname = 'invoices'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%estado%'
  LOOP
    EXECUTE format('ALTER TABLE invoices DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_estado_check
  CHECK (estado IN ('borrador','emitida','enviada','pagada','cancelada'));

-- 3) Garantia: toda factura NO borrador debe tener numeracion.
ALTER TABLE invoices
  ADD CONSTRAINT invoices_numeracion_emitida_check
  CHECK (estado = 'borrador' OR (numero IS NOT NULL AND codigo IS NOT NULL));

COMMIT;
