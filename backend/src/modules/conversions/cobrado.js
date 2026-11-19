/*
  LO COBRADO DE UNA VENTA ES LA SUMA DE SUS PAGOS (#692).

  `conversions.importe_pagado` es un acumulado: cada sitio que tocaba un cobro
  le sumaba o le restaba su parte por su cuenta. Siete sitios, con reglas
  distintas: Stripe lo topaba en el total (`LEAST`), borrar lo dejaba en 0 como
  mínimo (`GREATEST`), corregir una factura sumaba la diferencia con el total
  de la FACTURA y no con el del cobro... y un abono partía del acumulado, así
  que un desfase de antes se arrastraba para siempre. Resultado: ventas que
  decían «Cobrado 430 €» con «Pagos registrados (0)», y Análisis (que suma los
  pagos) con más cobrado que vendido.

  A partir de aquí hay una sola regla:
    · al escribir, tras cualquier cambio en `conversion_payments`, el campo se
      RECALCULA desde los pagos (`recalcularCobrado`), nunca se suma a ojo;
    · al leer, las pantallas de Ventas suman los pagos (`COBRADO_DE`), como ya
      hacían Análisis y el ranking.

  Lo que ya está guardado mal no se toca desde aquí: se mira venta a venta
  (`scripts/datos-que-no-cuadran.mjs`, «Cobrado guardado distinto de sus pagos»).
*/

import { activa as matriculaMoodleActiva } from '../matricula-moodle/matricula-moodle.config.js';

/** Subconsulta: lo cobrado de la venta con alias `a` (suma de sus pagos). */
export const COBRADO_DE = (a = 'c') =>
  `(SELECT COALESCE(SUM(cp.importe), 0) FROM conversion_payments cp WHERE cp.conversion_id = ${a}.id)`;

/**
 * Deja `importe_pagado` igual a la suma de los pagos de la venta.
 * `db` es el cliente de la transacción en curso (o cualquier cosa con `.query`).
 * Devuelve lo cobrado, ya como número.
 */
export async function recalcularCobrado(db, conversionId) {
  // Matrícula en Moodle (#767): hace falta saber si ANTES había algo cobrado
  // («con el primer pago»). Solo se pregunta con el interruptor encendido;
  // apagado, esta función hace exactamente la misma consulta que antes.
  // `antes` es el campo guardado: si una venta vieja lo tenía descuadrado por
  // arriba (#692), su primer pago real no programa nada. Mejor una matrícula
  // de menos, que se ve, que matricular otra vez a un alumno antiguo.
  const conMatricula = matriculaMoodleActiva();
  let antes = null;
  if (conMatricula) {
    const { rows: previo } = await db.query(
      'SELECT importe_pagado FROM conversions WHERE id = $1', [conversionId]
    );
    antes = previo[0] ? Number(previo[0].importe_pagado) : null;
  }

  const { rows } = await db.query(
    `UPDATE conversions c
        SET importe_pagado = ${COBRADO_DE('c')}, updated_at = NOW()
      WHERE c.id = $1
      RETURNING c.importe_pagado`,
    [conversionId]
  );
  const ahora = rows[0] ? Number(rows[0].importe_pagado) : null;

  // En la MISMA transacción que el cobro: si el cobro se deshace, esto también.
  if (conMatricula && ahora !== null) {
    const { alCambiarElCobro } = await import('../matricula-moodle/matricula-moodle.service.js');
    await alCambiarElCobro(db, conversionId, { antes, ahora });
  }
  return ahora;
}
