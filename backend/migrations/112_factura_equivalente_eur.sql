-- Doble moneda MANUAL en facturas y pagos.
--
-- Regla: el importe en EUROS es siempre la base contable y NO se toca — es lo que
-- suman los reportes, cuentas por cobrar, comisiones y el importe_pagado de la venta.
-- La divisa internacional es solo presentación: se guarda aparte y se muestra junto
-- al euro -> "1.000,00 USD (920,00 €)".
--
-- Los dos importes se teclean a mano: el tipo de cambio real lo pone la pasarela o el
-- banco en cada cobro, no una tabla de conversión.
-- Si moneda = 'EUR' no aplica nada de esto y todo funciona como siempre.

-- Se retiran las columnas de la primera versión (nombres al revés, sin datos aún).
ALTER TABLE invoices DROP COLUMN IF EXISTS total_equivalente;
ALTER TABLE invoices DROP COLUMN IF EXISTS moneda_equivalente;

-- invoices.moneda ya existe: pasa a significar la divisa internacional mostrada.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_divisa NUMERIC(14,2);

-- Un cobro puede llegar en otra divisa: se guarda su importe original, pero el que
-- cuenta (conversion_payments.importe) sigue siendo el de euros.
ALTER TABLE conversion_payments ADD COLUMN IF NOT EXISTS importe_divisa NUMERIC(14,2);
ALTER TABLE conversion_payments ADD COLUMN IF NOT EXISTS moneda VARCHAR(3);
