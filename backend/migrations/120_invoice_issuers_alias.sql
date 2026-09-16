-- Un nombre corto para distinguir emisoras que comparten datos fiscales.
--
-- ICTESS emite algunas facturas con el logo de Solvenic. Es la misma sociedad
-- —mismo NIF, misma direccion, misma serie y el mismo correlativo—, lo unico
-- que cambia es el logo. Como el desplegable de «empresa que emite» muestra la
-- razon social, las dos entradas saldrian identicas y no habria forma de elegir.
--
-- El alias solo se usa para elegirla en pantalla. En la factura sigue saliendo
-- la razon social de verdad, que es lo que vale fiscalmente.

ALTER TABLE invoice_issuers
  ADD COLUMN IF NOT EXISTS alias VARCHAR(80);

COMMENT ON COLUMN invoice_issuers.alias IS
  'Nombre corto para el selector cuando dos emisoras comparten razon social (p. ej. Solvenic dentro de ICTESS). No se imprime en la factura.';
