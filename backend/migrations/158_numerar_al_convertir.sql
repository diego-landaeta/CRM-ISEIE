-- Quien puede poner el numero de factura EN EL MOMENTO de registrar la venta.
--
-- Diego, 15/09/2026: «que salga al convertir, puedas colocar el numero de
-- factura; solo es para unos y para otros. En este caso CEDIA y ICTESS SI lo
-- pueden hacer, porque esas gestoras llevan facturacion aun. O sea, que salga
-- asignar numero de factura de una vez, o llevarlo a cola de facturacion».
--
-- Va en la EMPRESA y no en el proyecto porque es una forma de trabajar del
-- equipo que factura, no de un campus: CEDIA lleva siete proyectos y en los
-- siete decide la misma gente.
--
-- Por defecto NO. El freno del 14/09 sigue siendo la regla: la venta pasa a la
-- cola y la factura se emite a mano desde alli. Esto es la excepcion para
-- quienes ya lo llevaban asi antes del freno.

ALTER TABLE invoice_issuers
  ADD COLUMN IF NOT EXISTS numera_al_convertir BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN invoice_issuers.numera_al_convertir IS
  'Sus gestoras pueden asignar el numero de factura al registrar la venta, sin pasar por la cola.';

-- Las dos que lo llevan hoy. Por serie, que es lo estable: el nombre cambia.
UPDATE invoice_issuers SET numera_al_convertir = true WHERE serie IN ('CEDIA', 'ICTESS');
