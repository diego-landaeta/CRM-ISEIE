-- Corte de facturacion: hasta que dia esta la facturacion puesta al dia.
--
-- Por que hace falta: las facturas llevan numeracion correlativa y por fecha.
-- Si un cobro de Stripe emite su factura hoy mientras la persona que factura
-- todavia va por la semana pasada, la numeracion se descoloca y ya no hay forma
-- de arreglarla sin tocar numeros ya presentados.
--
-- Con esto, un cobro se asocia siempre, pero su factura solo se emite si la
-- fecha del cobro es anterior o igual al corte. Los que quedan por detras
-- esperan a que se mueva el corte hacia adelante.

BEGIN;

CREATE TABLE IF NOT EXISTS invoicing_status (
    project_id    INTEGER      PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    al_dia_hasta  DATE,
    updated_by    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  invoicing_status IS
  'Hasta que dia esta la facturacion al dia, por proyecto. Solo lo mueve quien tenga factura_manager.';
COMMENT ON COLUMN invoicing_status.al_dia_hasta IS
  'Los cobros con fecha posterior no emiten factura automatica: quedan esperando.';

-- Quien puede mover el corte. Ya existia la columna para el resto de permisos
-- de facturacion; aqui solo se documenta su nuevo uso.
COMMENT ON COLUMN users.factura_manager IS
  'Gestiona la facturacion: mueve el corte de "al dia hasta" y emite las facturas que estaban esperando.';

COMMIT;
