-- Migracion 121: conversion_payments.metodo
--
-- La columna existe en las dos bases de produccion desde hace meses, pero NO
-- la crea ninguna migracion: se aplico a mano y nadie la escribio. El codigo la
-- lee y la escribe en cinco sitios —conversion.model.js al crear la venta y al
-- añadir un cobro, installments.model.js al marcar una cuota pagada, y
-- report.model.js al listar—, asi que quien reconstruyera la base desde este
-- repositorio se encontraba media aplicacion rota sin entender por que.
--
-- Esta migracion no cambia nada en produccion (la columna ya esta): sirve para
-- que el repositorio vuelva a describir la realidad.
--
-- Sin CHECK a proposito. Los valores validos los comprueba Zod en
-- conversion.validation.js (PAYMENT_METHODS), y meter aqui una restriccion
-- sobre datos que ya existen es pedir un fallo el dia del despliegue. El enum
-- payment_method de Postgres es de conversions.metodo_pago, otra columna: no
-- se reutiliza aqui porque este campo admite valores que aquel no tiene.

ALTER TABLE conversion_payments
  ADD COLUMN IF NOT EXISTS metodo VARCHAR(30);

COMMENT ON COLUMN conversion_payments.metodo IS
  'Como se cobro: tarjeta, tarjeta_stripe, transferencia, efectivo, bizum, paypal, fraccionado, otro. Nulo = no se anoto (la mayoria de los historicos).';
