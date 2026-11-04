-- 272 · Facturas de colaboradores: «No lo he recibido» (04/11/2026)
--
-- Diego, 04/11, al ver el correo de «Factura pagada»: junto a «He recibido el
-- pago y lo confirmo», otro botón, «No lo he recibido». Al pulsarlo se apunta
-- aquí (con un comentario opcional del colaborador, p. ej. «me llegó otra
-- cantidad») y sale un aviso al correo de facturación de la empresa. Si después
-- confirma que sí lo recibió, queda confirmado y el aviso se da por cerrado
-- (la fecha se queda como historia; la lista solo lo enseña sin confirmar).
-- Al deshacer el pago se borra, como la confirmación (queda en el registro).
--
-- Se puede pasar dos veces.

BEGIN;

ALTER TABLE facturas_colaborador
  ADD COLUMN IF NOT EXISTS pago_no_recibido_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pago_no_recibido_comentario TEXT;

COMMENT ON COLUMN facturas_colaborador.pago_no_recibido_at IS
  'Cuando el colaborador dijo, desde el correo de «Factura pagada», que no ha recibido el pago (272).';

COMMIT;
