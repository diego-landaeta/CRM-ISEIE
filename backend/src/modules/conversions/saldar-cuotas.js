/*
  CADA COBRO SALDA SU CUOTA, EN ORDEN Y CON SU FECHA (CRM#888, gemela CRM-ISEIE#559).

  18/11/2026: alumnos con los pagos hechos y facturados que salían con cuotas
  «pendientes». En las dos bases había ventas con un cobro que no saldaba
  ninguna cuota y, a la vez, cuotas por cobrar. Tres caminos lo provocaban:

    1. El pago inicial de una venta cuyo plan YA lo incluía como cuota 1
       (registrar venta con el plan completo): el pago se guardaba al crear la
       venta y las cuotas después, todas pendientes. Nadie las unía.
    2. El abono saldaba la cuota más antigua solo si llegaba para la cuota
       ENTERA: un cobro de unos céntimos menos (redondeo, divisa) o un pago en
       dos partes se quedaba suelto.
    3. Por (1), el cobro de septiembre saldaba la cuota 1 —la «más antigua
       pendiente»— y la 2 se quedaba pendiente aunque estaba pagada y facturada.

  La regla, ahora en un solo sitio: los cobros de la venta que no saldan
  ninguna cuota, por fecha, saldan las cuotas pendientes por número.

    - Lo que no está en el plan (la matrícula o el pago inicial cuando el plan
      es «lo que queda»): el plan suma menos que el total. Esa diferencia la
      cubren los primeros cobros sueltos que caben enteros en ella, y esos no
      saldan cuotas. Una diferencia de un euro o menos es redondeo, no matrícula.
    - Un cobro que llega para la cuota (con un euro de margen) la salda con
      SU importe y SU fecha, no con lo previsto.
    - Un cobro que paga más de una cuota salda las que cubre.
    - Un cobro que no llega para la cuota la salda EN PARTE: la cuota se parte
      en lo cobrado (saldado) y el resto (pendiente, con el mismo vencimiento
      y una nota que lo explica). Nada se inventa: lo cobrado es lo que entró y
      lo que falta sigue a la vista.

  `planificar` es la decisión, sin base de datos (se prueba sola). `saldarCuotas`
  la aplica dentro de la transacción de quien registra el cobro.
*/

/** Margen de redondeo: el mismo euro que usa «Asociar» con Stripe. */
export const MARGEN = 1.0;

const r2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Qué hacer con los cobros sueltos de una venta.
 *
 * @param {object} p
 * @param {number} p.total          importe total de la venta
 * @param {Array}  p.cuotas         TODAS las cuotas {id, numero, importe_previsto, fecha_cobro}
 * @param {Array}  p.sueltos        cobros que no saldan ninguna cuota {id, importe, fecha, metodo}
 * @returns {{ fuera: number[], acciones: Array }} ids de cobros fuera del plan y
 *   acciones `{ tipo: 'saldar' | 'partir', cuotaId, numero, paymentId, fecha, metodo, cobrado, resto? }`
 */
export function planificar({ total, cuotas, sueltos }) {
  const todas = [...(cuotas || [])].sort((a, b) => a.numero - b.numero);
  const sumaPlan = r2(todas.reduce((s, c) => s + Number(c.importe_previsto), 0));
  let fueraRestante = r2(Number(total) - sumaPlan);
  if (fueraRestante <= MARGEN) fueraRestante = 0;

  const orden = [...(sueltos || [])]
    .filter((p) => Number(p.importe) > 0)
    .sort((a, b) => String(a.fecha).slice(0, 10).localeCompare(String(b.fecha).slice(0, 10)) || a.id - b.id);

  // Fuera del plan: los primeros sueltos que caben ENTEROS en lo que el plan no
  // cubre. El primero que no cabe ya es del plan (y los de después también).
  const fuera = [];
  const delPlan = [];
  for (const p of orden) {
    const imp = r2(p.importe);
    if (delPlan.length === 0 && fueraRestante > 0 && imp <= fueraRestante + MARGEN) {
      fuera.push(p.id);
      fueraRestante = Math.max(0, r2(fueraRestante - imp));
    } else {
      delPlan.push(p);
    }
  }

  const pendientes = todas.filter((c) => !c.fecha_cobro).map((c) => ({ ...c, prev: r2(c.importe_previsto) }));
  const acciones = [];
  let i = 0;
  for (const p of delPlan) {
    let restante = r2(p.importe);
    let deEste = 0; // cuotas que lleva saldadas este cobro
    while (restante > 0.004 && i < pendientes.length) {
      const c = pendientes[i];
      const base = { cuotaId: c.id, numero: c.numero, paymentId: p.id, fecha: p.fecha, metodo: p.metodo ?? null };
      // Los céntimos que sobran de un cobro que pagó varias cuotas (redondeos
      // del plan: 478 € por dos cuotas de 238,33) se quedan en su última cuota,
      // no parten la siguiente.
      if (deEste > 0 && restante <= MARGEN * deEste && restante < c.prev - MARGEN) {
        const ult = acciones[acciones.length - 1];
        ult.cobrado = r2(ult.cobrado + restante);
        restante = 0;
        break;
      }
      deEste += 1;
      if (restante >= c.prev - MARGEN) {
        // Llega para la cuota. Si es lo último del cobro y está dentro del
        // margen, la cuota se queda con lo que entró de verdad.
        const ultimo = restante <= c.prev + MARGEN;
        const cobrado = ultimo ? restante : c.prev;
        acciones.push({ tipo: 'saldar', ...base, cobrado });
        restante = ultimo ? 0 : r2(restante - c.prev);
        i += 1;
      } else {
        // No llega: se salda en parte y el resto sigue pendiente.
        const resto = r2(c.prev - restante);
        acciones.push({ tipo: 'partir', ...base, cobrado: restante, resto });
        // La cuota que queda pendiente es el resto, en el mismo sitio de la
        // cola; las de detrás corren un número, como harán en la base.
        pendientes[i] = { ...c, id: null, prev: resto, numero: c.numero + 1 };
        for (let k = i + 1; k < pendientes.length; k++) {
          pendientes[k] = { ...pendientes[k], numero: pendientes[k].numero + 1 };
        }
        restante = 0;
      }
    }
  }
  return { fuera, acciones };
}

/**
 * Salda las cuotas pendientes de la venta con sus cobros sueltos. `client` es
 * el de una transacción abierta (BEGIN hecho); no hace COMMIT. Devuelve las
 * acciones aplicadas.
 */
export async function saldarCuotas(client, conversionId) {
  const { rows: conv } = await client.query('SELECT importe_total FROM conversions WHERE id = $1', [conversionId]);
  if (!conv[0]) return [];
  const { rows: cuotas } = await client.query(
    `SELECT id, numero, importe_previsto, fecha_vencimiento, fecha_cobro, concepto, enviar_email
       FROM conversion_installments WHERE conversion_id = $1 ORDER BY numero FOR UPDATE`,
    [conversionId],
  );
  if (!cuotas.length) return [];
  const { rows: sueltos } = await client.query(
    `SELECT cp.id, cp.importe, cp.fecha::text AS fecha, cp.metodo
       FROM conversion_payments cp
      WHERE cp.conversion_id = $1
        AND NOT EXISTS (SELECT 1 FROM conversion_installments ci WHERE ci.payment_id = cp.id)
      ORDER BY cp.fecha, cp.id`,
    [conversionId],
  );
  if (!sueltos.length) return [];

  const { acciones } = planificar({ total: conv[0].importe_total, cuotas, sueltos });
  // La cuota «resto» de una partición aún no tiene id: se crea al partir y la
  // siguiente acción sobre ella (si la hay) la recibe por número.
  for (const a of acciones) {
    let cuotaId = a.cuotaId;
    if (!cuotaId) {
      const { rows } = await client.query(
        'SELECT id FROM conversion_installments WHERE conversion_id = $1 AND numero = $2',
        [conversionId, a.numero],
      );
      cuotaId = rows[0]?.id;
      if (!cuotaId) throw new Error(`saldarCuotas: no está la cuota ${a.numero} de la venta ${conversionId}`);
    }
    if (a.tipo === 'saldar') {
      await client.query(
        `UPDATE conversion_installments
            SET fecha_cobro = $1, importe_cobrado = $2, payment_id = $3, metodo = $4, updated_at = NOW()
          WHERE id = $5 AND fecha_cobro IS NULL`,
        [a.fecha, a.cobrado, a.paymentId, a.metodo, cuotaId],
      );
      continue;
    }
    // Partir: lo cobrado queda en esta cuota y el resto pasa a una nueva, justo
    // detrás, con el mismo vencimiento. Las de detrás corren un número (en dos
    // pasos: la unicidad de (venta, número) se comprueba fila a fila).
    const { rows: [c] } = await client.query('SELECT * FROM conversion_installments WHERE id = $1', [cuotaId]);
    if (c.numero !== a.numero) throw new Error(`saldarCuotas: la cuota ${a.numero} de la venta ${conversionId} se ha movido`);
    await client.query(
      `UPDATE conversion_installments SET numero = -numero
        WHERE conversion_id = $1 AND numero > $2`,
      [conversionId, c.numero],
    );
    await client.query(
      `UPDATE conversion_installments SET numero = -numero + 1
        WHERE conversion_id = $1 AND numero < 0`,
      [conversionId],
    );
    await client.query(
      `UPDATE conversion_installments
          SET importe_previsto = $1, fecha_cobro = $2, importe_cobrado = $1, payment_id = $3, metodo = $4,
              notas = concat_ws(' · ', NULLIF(notas, ''), $5::text), updated_at = NOW()
        WHERE id = $6`,
      [a.cobrado, a.fecha, a.paymentId, a.metodo,
       `Cobrada en parte: ${a.cobrado.toFixed(2)} de ${r2(a.cobrado + a.resto).toFixed(2)} €`, cuotaId],
    );
    await client.query(
      `INSERT INTO conversion_installments
         (conversion_id, numero, importe_previsto, fecha_vencimiento, concepto, enviar_email, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [conversionId, c.numero + 1, a.resto, c.fecha_vencimiento, c.concepto, c.enviar_email,
       `Resto de la cuota ${c.numero}: faltan ${a.resto.toFixed(2)} €`],
    );
  }
  return acciones;
}

/**
 * Cargos de Stripe cobrados y sin cobro en el CRM que parecen de esta venta:
 * enlazados a ella o a su cliente, o con su correo, del mismo campus. Sirve
 * para avisar antes de apuntar a mano un cobro que ya entró por Stripe, y para
 * ofrecer enlazarlo desde la ficha de la venta (CRM#888).
 */
export async function cargosStripeSueltos(exec, conversionId, { importe = null } = {}) {
  const { rows } = await exec(
    `SELECT sp.id, sp.stripe_id, sp.amount::float8 AS importe, sp.stripe_created_at::date::text AS fecha,
            sp.customer_email, sp.description
       FROM conversions c
       JOIN leads l ON l.id = c.lead_id
       JOIN stripe_payments sp ON sp.project_id = c.project_id
      WHERE c.id = $1
        AND sp.status = 'succeeded'
        AND sp.conversion_payment_id IS NULL
        AND COALESCE(sp.refunded, false) = false
        AND (sp.conversion_id = c.id OR sp.lead_id = c.lead_id
             OR (NULLIF(btrim(l.email), '') IS NOT NULL AND lower(btrim(sp.customer_email)) = lower(btrim(l.email))))
        AND ($2::numeric IS NULL OR ABS(sp.amount - $2::numeric) <= ${MARGEN})
      ORDER BY sp.stripe_created_at DESC, sp.id DESC
      LIMIT 20`,
    [conversionId, importe],
  );
  return rows;
}
