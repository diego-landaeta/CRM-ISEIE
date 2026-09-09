/*
  Que es una factura, para las DOS pantallas.

  Diego: «necesito que Ventas use los datos de Facturacion». La unica forma de
  que dos pantallas digan lo mismo es que lean la misma regla del mismo sitio.
  Antes esta CASE vivia solo en el listado de facturas y Ventas contaba por su
  cuenta --por fecha de cobro, no de factura-- y no coincidian nunca.

  Espera la factura con el alias `i`. Devuelve:

    venta   la factura del primer cobro de una venta: se vendio algo
    cuota   un cobro posterior de una venta anterior
    parte   OTRA factura de una venta ya facturada, sin cobro propio: la misma
            venta partida en varios papeles. Ni venta nueva ni cuota.
    suelta  no cuelga de ninguna venta
*/
export const CLASE_FACTURA = `CASE
  WHEN i.conversion_id IS NULL THEN 'suelta'
  WHEN i.payment_id IS NULL AND EXISTS (
    SELECT 1 FROM invoices x
     WHERE x.conversion_id = i.conversion_id
       AND x.id <> i.id
       AND x.tipo <> 'proforma' AND x.estado <> 'cancelada'
       AND (x.fecha_emision < i.fecha_emision
            OR (x.fecha_emision = i.fecha_emision AND x.numero < i.numero))
  ) THEN 'parte'
  WHEN i.payment_id IS NULL THEN 'venta'
  WHEN NOT EXISTS (
    SELECT 1 FROM conversion_payments p0
     JOIN conversion_payments pi ON pi.id = i.payment_id
     WHERE p0.conversion_id = pi.conversion_id
       AND (p0.fecha < pi.fecha OR (p0.fecha = pi.fecha AND p0.id < pi.id))
  ) THEN 'venta'
  ELSE 'cuota'
END`;

/*
  ¿REPETIDA? Sin cobro propio, marcada como PAGADA, y la venta tiene mas
  facturado que cobrado: el dinero de esta factura no existe.

  Diego, señalando la 2026/0102: «¿esa es repetida?». Si: la venta de Flavia
  Gerez vale 251, en Stripe hay UN cargo de 125,50, y hay DOS facturas de 125,50
  marcadas como pagadas; la segunda se creo 33 segundos despues de la primera,
  por el mismo usuario. Una segunda cuota facturada a proposito no estaria
  marcada como pagada.

  El medio euro de tolerancia es por los redondeos de las cuotas: 1.294,40
  facturado contra 1.294,00 cobrado no es una factura de mas.
*/
export const SOSPECHA_DUPLICADA = `(i.payment_id IS NULL AND i.estado = 'pagada' AND i.conversion_id IS NOT NULL
  AND (SELECT COALESCE(SUM(x.total), 0) FROM invoices x
        WHERE x.conversion_id = i.conversion_id
          AND x.tipo <> 'proforma' AND x.estado <> 'cancelada')
    > (SELECT COALESCE(SUM(cp.importe), 0) FROM conversion_payments cp
        WHERE cp.conversion_id = i.conversion_id) + 0.5)`;

/* Solo las facturas de verdad: ni proformas --son presupuestos-- ni anuladas. */
export const FACTURA_REAL = `i.tipo <> 'proforma' AND i.estado <> 'cancelada'`;
