import { query, getClient } from '../../shared/config/db.js';
import { recalcularCobrado } from './cobrado.js';

export async function listByConversion(conversionId) {
  // Se añade la factura emitida por el pago de cada cuota (por payment_id) para
  // poder verla desde el plan de cuotas. Y el método y la referencia de su
  // cobro, que es lo que enseña «Editar pago» (una cuota saldada con un abono
  // no siempre tiene su propio `metodo`).
  const { rows } = await query(
    `SELECT ci.*, f.id AS factura_id, f.codigo AS factura_codigo, f.estado AS factura_estado,
            cp.metodo AS pago_metodo, cp.referencia AS pago_referencia
       FROM conversion_installments ci
       LEFT JOIN invoices f ON f.payment_id = ci.payment_id AND f.tipo <> 'proforma' AND f.estado <> 'cancelada'
       LEFT JOIN conversion_payments cp ON cp.id = ci.payment_id
      WHERE ci.conversion_id = $1 ORDER BY ci.numero ASC`,
    [conversionId]
  );
  return rows;
}

export async function generateInstallments(conversionId, numCuotas, importeTotal, fechaInicio, customInstallments = null, concepto = null) {
  const conceptoVal = concepto && String(concepto).trim() ? String(concepto).trim().slice(0, 160) : null;
  // Si llega customInstallments, lo usa tal cual. Si no, distribuye N cuotas
  // iguales mensuales desde fechaInicio (comportamiento original).
  const c = await getClient();
  try {
    await c.query('BEGIN');
    // Borra anteriores no cobradas
    await c.query(`DELETE FROM conversion_installments WHERE conversion_id = $1 AND fecha_cobro IS NULL`, [conversionId]);

    if (Array.isArray(customInstallments) && customInstallments.length > 0) {
      for (let i = 0; i < customInstallments.length; i++) {
        const cuota = customInstallments[i];
        const importe = Number(cuota.importe_previsto);
        const fecha = cuota.fecha_vencimiento;
        if (!isFinite(importe) || importe <= 0) throw new Error(`Cuota ${i + 1}: importe inválido`);
        if (!fecha) throw new Error(`Cuota ${i + 1}: fecha de vencimiento requerida`);
        await c.query(
          `INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento, concepto)
           VALUES ($1, $2, $3, $4, $5)`,
          [conversionId, i + 1, importe, fecha, conceptoVal]
        );
      }
    } else {
      const importeCuota = Math.round((Number(importeTotal) / numCuotas) * 100) / 100;
      const start = new Date(fechaInicio);
      for (let i = 0; i < numCuotas; i++) {
        const venc = new Date(start);
        venc.setMonth(venc.getMonth() + i);
        const importe = i === numCuotas - 1
          // ultima cuota = total - sum(anteriores) para evitar redondeos
          ? Math.round((Number(importeTotal) - importeCuota * (numCuotas - 1)) * 100) / 100
          : importeCuota;
        await c.query(
          `INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento, concepto)
           VALUES ($1, $2, $3, $4, $5)`,
          [conversionId, i + 1, importe, venc.toISOString().slice(0, 10), conceptoVal]
        );
      }
    }
    await c.query('COMMIT');
    return await listByConversion(conversionId);
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

export async function update(id, data) {
  const allowed = ['fecha_vencimiento', 'importe_previsto', 'enviar_email', 'notas', 'concepto'];
  const sets = []; const params = []; let idx = 1;
  for (const k of allowed) {
    if (data[k] !== undefined) { sets.push(`${k} = $${idx++}`); params.push(data[k]); }
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await query(`UPDATE conversion_installments SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params);
  return rows[0];
}

// `referencia`: la del banco en una transferencia o un depósito (migración 206).
export async function markPaid(id, { fecha_cobro, importe_cobrado, metodo, notas, referencia }) {
  const c = await getClient();
  try {
    await c.query('BEGIN');
    const { rows: instRows } = await c.query(`SELECT * FROM conversion_installments WHERE id = $1 FOR UPDATE`, [id]);
    const inst = instRows[0];
    if (!inst) { await c.query('ROLLBACK'); return null; }
    if (inst.fecha_cobro) { await c.query('ROLLBACK'); throw new Error('Cuota ya cobrada'); }
    // Crear payment
    const { rows: payRows } = await c.query(
      `INSERT INTO conversion_payments (conversion_id, importe, fecha, notas, metodo, referencia)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [inst.conversion_id, importe_cobrado || inst.importe_previsto, fecha_cobro, notas || `Cuota ${inst.numero}`, metodo || null, referencia || null]
    );
    // importe_pagado = suma de los pagos, con el de esta cuota dentro (#692).
    await recalcularCobrado(c, inst.conversion_id);
    // Marcar cuota
    const { rows } = await c.query(
      `UPDATE conversion_installments
         SET fecha_cobro = $1, importe_cobrado = $2, metodo = $3, payment_id = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [fecha_cobro, importe_cobrado || inst.importe_previsto, metodo || null, payRows[0].id, id]
    );
    await c.query('COMMIT');
    return rows[0];
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

// Edita un pago YA registrado (fecha_cobro / importe_cobrado / metodo).
// Mantiene en sync el conversion_payment correspondiente y el importe_pagado
// de la conversión (suma/resta el diff de importe).
//
// EL MÉTODO TAMBIÉN (15/10). El diálogo «Editar pago» enseñaba el desplegable
// de la forma de pago, pero no se mandaba ni se guardaba: cambiarlo no hacía
// nada y nadie se enteraba. Ahora se guarda en la cuota y en su cobro, y se
// devuelve `metodo_antes` para que el webhook de transferencias (206) sepa si
// el cobro acaba de pasar A transferencia o depósito.
export async function editPaid(id, { fecha_cobro, importe_cobrado, metodo, referencia }) {
  const c = await getClient();
  try {
    await c.query('BEGIN');
    const { rows: instRows } = await c.query(`SELECT * FROM conversion_installments WHERE id = $1 FOR UPDATE`, [id]);
    const inst = instRows[0];
    if (!inst) { await c.query('ROLLBACK'); return null; }
    if (!inst.fecha_cobro) { await c.query('ROLLBACK'); throw new Error('Cuota no pagada'); }

    const newImporte = importe_cobrado !== undefined ? Number(importe_cobrado) : Number(inst.importe_cobrado);
    const newFecha = fecha_cobro || inst.fecha_cobro;
    const diff = newImporte - Number(inst.importe_cobrado);
    // El método que vale es el del COBRO: una cuota saldada con un abono tiene
    // `payment_id` pero no siempre su propio `metodo`.
    let metodoAntes = inst.metodo || null;
    if (inst.payment_id) {
      const { rows: pg } = await c.query('SELECT metodo FROM conversion_payments WHERE id = $1', [inst.payment_id]);
      metodoAntes = pg[0]?.metodo || metodoAntes;
    }
    const newMetodo = metodo !== undefined ? (metodo || null) : metodoAntes;

    // Actualizar conversion_payment vinculado
    if (inst.payment_id) {
      await c.query(
        `UPDATE conversion_payments
            SET importe = $1, fecha = $2, metodo = $4,
                referencia = CASE WHEN $5::boolean THEN $6 ELSE referencia END
          WHERE id = $3`,
        [newImporte, newFecha, inst.payment_id, newMetodo, referencia !== undefined, referencia || null]
      );
    }
    // Si cambió el monto, importe_pagado vuelve a ser la suma de los pagos (#692).
    if (diff !== 0) await recalcularCobrado(c, inst.conversion_id);
    // Actualizar cuota
    const { rows } = await c.query(
      `UPDATE conversion_installments
         SET fecha_cobro = $1, importe_cobrado = $2, metodo = $4, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [newFecha, newImporte, id, newMetodo]
    );
    await c.query('COMMIT');
    return { ...rows[0], metodo_antes: metodoAntes };
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally { c.release(); }
}

// Deshace el pago de una cuota: borra el conversion_payment, resta del
// importe_pagado de la conversión, y devuelve la cuota a estado "pendiente".
export async function unpay(id) {
  const c = await getClient();
  try {
    await c.query('BEGIN');
    const { rows: instRows } = await c.query(`SELECT * FROM conversion_installments WHERE id = $1 FOR UPDATE`, [id]);
    const inst = instRows[0];
    if (!inst) { await c.query('ROLLBACK'); return null; }
    if (!inst.fecha_cobro) { await c.query('ROLLBACK'); throw new Error('Cuota no estaba pagada'); }

    // Borrar payment (cascade pone payment_id de la cuota en NULL automaticamente)
    if (inst.payment_id) {
      await c.query(`DELETE FROM conversion_payments WHERE id = $1`, [inst.payment_id]);
    }
    // Lo que queda de los pagos (#692).
    await recalcularCobrado(c, inst.conversion_id);
    // Limpiar la cuota
    const { rows } = await c.query(
      `UPDATE conversion_installments
         SET fecha_cobro = NULL, importe_cobrado = NULL, metodo = NULL, payment_id = NULL, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );
    await c.query('COMMIT');
    return rows[0];
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally { c.release(); }
}

export async function remove(id) {
  // Permite borrar SOLO cuotas no cobradas (las pagadas hay que deshacer primero con unpay)
  await query(`DELETE FROM conversion_installments WHERE id = $1 AND fecha_cobro IS NULL`, [id]);
}
