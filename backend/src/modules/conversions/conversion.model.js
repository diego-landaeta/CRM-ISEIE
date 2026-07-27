import { query, getClient } from '../../shared/config/db.js';

const LEAD_EXISTS_SQL = `SELECT id, project_id FROM leads WHERE id = $1`;

export async function leadBelongsToProject(leadId, projectId) {
  const { rows } = await query(LEAD_EXISTS_SQL, [leadId]);
  if (!rows[0]) return false;
  return rows[0].project_id === projectId;
}

export async function create(data) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const {
      lead_id,
      project_id,
      producto_contratado,
      producto_contratado_id,
      importe_total,
      importe_pagado,
      metodo_pago,
      metodo_pago_inicial,   // método REAL del pago inicial (tarjeta, transferencia…)
      fecha_compromiso_pago,
      fecha_conversion,
      notas_pago,
      items,             // array opcional [{descripcion, cantidad, precio_unitario, product_id?}]
      iva_pct,           // default 21
      iva_incluido,      // default false (sumar IVA al subtotal)
      iva_exento,        // default false
      descuento_tipo,    // 'none' | 'pct' | 'monto'
      descuento_valor,   // % o monto fijo
      subtotal_bruto,    // precio base antes de descuento/IVA (modo simple)
    } = data;

    const ivaPctVal = Number(iva_pct ?? 21);
    const isExento = !!iva_exento;
    const isIncluido = !!iva_incluido;
    const descTipo = ['pct', 'monto'].includes(descuento_tipo) ? descuento_tipo : 'none';
    const descVal = Number(descuento_valor || 0);

    // 1) Subtotal bruto: suma de items, o el importe_total ingresado (modo simple)
    const hasItems = Array.isArray(items) && items.length > 0;
    const subtotalBruto = hasItems
      ? items.reduce((s, it) => s + Number(it.cantidad || 1) * Number(it.precio_unitario || 0), 0)
      : Number(subtotal_bruto ?? importe_total ?? 0);

    // 2) Descuento
    let descImporte = 0;
    if (descTipo === 'pct') descImporte = subtotalBruto * descVal / 100;
    else if (descTipo === 'monto') descImporte = Math.min(descVal, subtotalBruto);
    descImporte = Number(descImporte.toFixed(2));

    // 3) Neto tras descuento
    const neto = Number((subtotalBruto - descImporte).toFixed(2));

    // 4) Base + IVA + total
    let base, ivaImp, total;
    if (isExento) {
      base = neto; ivaImp = 0; total = neto;
    } else if (isIncluido) {
      total = neto;
      base = neto / (1 + ivaPctVal / 100);
      ivaImp = total - base;
    } else {
      base = neto;
      ivaImp = base * ivaPctVal / 100;
      total = base + ivaImp;
    }
    base = Number(base.toFixed(2)); ivaImp = Number(ivaImp.toFixed(2)); total = Number(total.toFixed(2));
    const finalImporte = total;

    // INSERT conversion (IVA + descuento)
    const { rows: convRows } = await client.query(
      `INSERT INTO conversions
        (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado,
         metodo_pago, fecha_compromiso_pago, fecha_conversion, notas_pago,
         iva_pct, iva_incluido, iva_exento, base_imponible, iva_importe,
         subtotal_bruto, descuento_tipo, descuento_valor, descuento_importe)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, CURRENT_DATE), $10,
               $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [lead_id, project_id, producto_contratado, producto_contratado_id || null,
       finalImporte, importe_pagado, metodo_pago, fecha_compromiso_pago, fecha_conversion, notas_pago,
       isExento ? 0 : ivaPctVal, isIncluido, isExento, base, ivaImp,
       Number(subtotalBruto.toFixed(2)), descTipo, descVal, descImporte]
    );
    const conversion = convRows[0];

    // INSERT items (si vienen)
    if (Array.isArray(items) && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const cant = Number(it.cantidad || 1);
        const precio = Number(it.precio_unitario || 0);
        const subt = Number((cant * precio).toFixed(2));
        await client.query(
          `INSERT INTO conversion_items
            (conversion_id, product_id, descripcion, cantidad, precio_unitario, subtotal, orden)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [conversion.id, it.product_id || null, it.descripcion || 'Item sin descripcion',
           cant, precio, subt, i]
        );
      }
    }

    // Si hay importe_pagado > 0, crear primer payment. Guardamos su id en la
    // conversión devuelta para que el servicio pueda facturar ESE abono inicial.
    if (Number(importe_pagado) > 0) {
      const { rows: firstPay } = await client.query(
        `INSERT INTO conversion_payments (conversion_id, importe, fecha, notas, metodo)
         VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5) RETURNING id, importe`,
        [conversion.id, importe_pagado, fecha_conversion, 'Pago inicial',
         (metodo_pago_inicial || (metodo_pago && metodo_pago !== 'fraccionado' ? metodo_pago : 'tarjeta'))]
      );
      conversion._initial_payment_id = firstPay[0].id;
      conversion._initial_payment_importe = Number(firstPay[0].importe);
    }

    // Cambiar status del lead a convertido
    await client.query(
      `UPDATE leads SET status = 'convertido', updated_at = NOW() WHERE id = $1`,
      [lead_id]
    );

    // Historial
    await client.query(
      `INSERT INTO lead_status_history (lead_id, status_anterior, status_nuevo, changed_by)
       SELECT $1, status, 'convertido', $2 FROM leads WHERE id = $1`,
      [lead_id, data.changed_by || null]
    );

    await client.query('COMMIT');
    return conversion;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT c.*,
            l.nombre as lead_nombre, l.email as lead_email,
            p.nombre as proyecto_nombre, p.slug as proyecto_slug,
            (c.importe_total - c.importe_pagado) AS importe_pendiente
     FROM conversions c
     LEFT JOIN leads l ON l.id = c.lead_id
     LEFT JOIN projects p ON p.id = c.project_id
     WHERE c.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const conversion = rows[0];

  // Items de la conversion (multi-product)
  const { rows: items } = await query(
    `SELECT id, product_id, descripcion, cantidad, precio_unitario, subtotal, orden
     FROM conversion_items
     WHERE conversion_id = $1
     ORDER BY orden ASC`,
    [id]
  );
  conversion.items = items;

  // Cada pago trae SU factura (una factura por pago). Enlazamos por payment_id
  // e incluimos los datos de cliente para que el front sepa si faltan datos.
  const { rows: payments } = await query(
    `SELECT cp.id, cp.importe, cp.fecha, cp.notas, cp.metodo, cp.created_at,
            ci.numero AS cuota_numero,
            (cp.metodo = 'tarjeta_stripe' OR EXISTS (
              SELECT 1 FROM stripe_payments sp
               WHERE sp.conversion_payment_id = cp.id AND sp.status = 'succeeded'
            )) AS pagado_por_stripe,
            i.id  AS factura_id, i.codigo AS factura_codigo, i.estado AS factura_estado,
            i.tipo AS factura_tipo, i.cliente_nif, i.cliente_direccion, i.cliente_ciudad,
            i.cliente_cp, i.cliente_pais, i.items AS factura_items
       FROM conversion_payments cp
       LEFT JOIN conversion_installments ci ON ci.payment_id = cp.id
       LEFT JOIN invoices i ON i.payment_id = cp.id AND i.estado <> 'cancelada'
      WHERE cp.conversion_id = $1
      ORDER BY cp.fecha DESC, cp.id DESC`,
    [id]
  );
  conversion.payments = payments;

  // Cuotas (plan de pago fraccionado) con la factura de la cuota ya cobrada.
  const { rows: installments } = await query(
    `SELECT ci.id, ci.numero, ci.importe_previsto, ci.fecha_vencimiento,
            ci.fecha_cobro, ci.importe_cobrado, ci.metodo, ci.payment_id,
            (ci.metodo = 'tarjeta_stripe' OR EXISTS (
              SELECT 1 FROM stripe_payments sp
               WHERE sp.conversion_payment_id = ci.payment_id AND sp.status = 'succeeded'
            )) AS pagado_por_stripe,
            i.id AS factura_id, i.codigo AS factura_codigo, i.estado AS factura_estado,
            i.tipo AS factura_tipo, i.cliente_nif, i.cliente_direccion, i.cliente_ciudad,
            i.cliente_cp, i.cliente_pais
       FROM conversion_installments ci
       LEFT JOIN invoices i ON i.payment_id = ci.payment_id AND i.estado <> 'cancelada'
      WHERE ci.conversion_id = $1
      ORDER BY ci.numero ASC`,
    [id]
  );
  conversion.installments = installments;
  return conversion;
}

export async function findByLead(leadId) {
  // Devuelve payments y refunds embebidos (json_agg) para evitar N+1 desde el front.
  const { rows } = await query(
    `SELECT c.*,
            (c.importe_total - c.importe_pagado) AS importe_pendiente,
            COALESCE((SELECT json_agg(ci_row ORDER BY ci_row.orden)
                      FROM (
                        SELECT id, product_id, descripcion, cantidad, precio_unitario, subtotal, orden
                          FROM conversion_items WHERE conversion_id = c.id
                      ) ci_row), '[]'::json) AS items,
            COALESCE((SELECT json_agg(cp_row ORDER BY cp_row.fecha DESC, cp_row.id DESC)
                      FROM (
                        SELECT id, importe, fecha, notas, created_at
                          FROM conversion_payments WHERE conversion_id = c.id
                      ) cp_row), '[]'::json) AS payments,
            (SELECT COUNT(*) FROM conversion_payments WHERE conversion_id = c.id) AS payments_count,
            COALESCE((SELECT json_agg(cr_row ORDER BY cr_row.fecha DESC, cr_row.id DESC)
                      FROM (
                        SELECT cr.id, cr.importe, cr.fecha, cr.motivo, cr.created_at,
                               u.nombre AS created_by_nombre
                          FROM conversion_refunds cr
                          LEFT JOIN users u ON u.id = cr.created_by
                         WHERE cr.conversion_id = c.id
                      ) cr_row), '[]'::json) AS refunds,
            COALESCE((SELECT SUM(importe) FROM conversion_refunds WHERE conversion_id = c.id), 0) AS refunds_total
     FROM conversions c
     WHERE c.lead_id = $1
     ORDER BY c.fecha_conversion DESC, c.id DESC`,
    [leadId]
  );
  return rows;
}

export async function findAll({ projectId, leadId, responsableId, pendiente, vencido, pendingBilling, from, to, page, limit }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (projectId) { conditions.push(`c.project_id = $${idx++}`); params.push(projectId); }
  if (leadId) { conditions.push(`c.lead_id = $${idx++}`); params.push(leadId); }
  if (responsableId) { conditions.push(`l.responsable_id = $${idx++}`); params.push(responsableId); }
  if (pendiente === 'true') { conditions.push(`c.importe_pagado < c.importe_total`); }
  if (pendiente === 'false') { conditions.push(`c.importe_pagado >= c.importe_total`); }
  if (vencido === 'true') {
    conditions.push(`c.fecha_compromiso_pago IS NOT NULL AND c.fecha_compromiso_pago < CURRENT_DATE AND c.importe_pagado < c.importe_total`);
  }
  // pendingBilling: conversion sin importe (backfill u otras a completar)
  if (pendingBilling === 'true') {
    conditions.push(`(c.importe_total = 0 OR c.notas_pago LIKE 'Backfill 2026-06-16%')`);
  }
  if (from) { conditions.push(`c.fecha_conversion >= $${idx++}`); params.push(from); }
  if (to) { conditions.push(`c.fecha_conversion <= $${idx++}`); params.push(to); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (page - 1) * limit;

  // JOIN a leads necesario si filtramos por l.responsable_id
  const countJoin = responsableId ? 'LEFT JOIN leads l ON l.id = c.lead_id' : '';
  const { rows: countRows } = await query(`SELECT COUNT(*) FROM conversions c ${countJoin} ${where}`, params);
  const total = parseInt(countRows[0].count);

  const { rows } = await query(
    `SELECT c.id, c.lead_id, c.project_id, c.producto_contratado,
            c.importe_total, c.importe_pagado,
            (c.importe_total - c.importe_pagado) AS importe_pendiente,
            c.fecha_compromiso_pago, c.metodo_pago,
            c.fecha_conversion, c.created_at,
            l.nombre as lead_nombre, l.email as lead_email,
            l.responsable_id, u.nombre as responsable_nombre,
            p.nombre as proyecto_nombre
     FROM conversions c
     LEFT JOIN leads l ON l.id = c.lead_id
     LEFT JOIN users u ON u.id = l.responsable_id
     LEFT JOIN projects p ON p.id = c.project_id
     ${where}
     ORDER BY c.fecha_conversion DESC, c.id DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  return { conversions: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function update(id, fields) {
  const allowed = ['producto_contratado', 'producto_contratado_id', 'importe_total', 'metodo_pago', 'fecha_compromiso_pago', 'fecha_conversion', 'notas_pago'];
  const sets = [];
  const params = [];
  let idx = 1;

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      params.push(fields[key]);
    }
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  params.push(id);

  const { rows } = await query(
    `UPDATE conversions SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  return rows[0];
}

// opts.allowOverpay: permite registrar un cobro que supere el importe_total de la venta.
// Lo usa el cobro automático de Stripe: el dinero entró de verdad, y cuando excede el total
// lo que suele estar mal es el total previsto, no el cobro. El flujo manual sigue bloqueado.
export async function addPayment(conversionId, { importe, fecha, notas, metodo }, opts = {}) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Verificar que la conversion existe y lock
    const { rows: convRows } = await client.query(
      `SELECT id, importe_total, importe_pagado FROM conversions WHERE id = $1 FOR UPDATE`,
      [conversionId]
    );
    if (!convRows[0]) {
      await client.query('ROLLBACK');
      return { error: 'NOT_FOUND' };
    }

    const nuevoTotal = Number(convRows[0].importe_pagado) + Number(importe);
    if (!opts.allowOverpay && nuevoTotal > Number(convRows[0].importe_total)) {
      await client.query('ROLLBACK');
      return { error: 'OVERPAY' };
    }

    // INSERT payment
    const { rows: payRows } = await client.query(
      `INSERT INTO conversion_payments (conversion_id, importe, fecha, notas, metodo)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5)
       RETURNING *`,
      [conversionId, importe, fecha, notas, metodo || null]
    );

    // UPDATE conversion.importe_pagado
    await client.query(
      `UPDATE conversions SET importe_pagado = $1, updated_at = NOW() WHERE id = $2`,
      [nuevoTotal, conversionId]
    );

    // Si la venta es fraccionada, el abono SALDA las cuotas pendientes más
    // antiguas (FIFO) — igual que "Registrar pago". Así "Abonar" y "Registrar
    // pago" son el MISMO proceso: el importe resta cuotas y deja de estar vencida.
    // El sobrante que no complete una cuota queda como abono a cuenta.
    const { rows: cuotas } = await client.query(
      `SELECT id, importe_previsto FROM conversion_installments
        WHERE conversion_id = $1 AND fecha_cobro IS NULL
        ORDER BY numero ASC FOR UPDATE`, [conversionId]);
    let restante = Number(importe);
    const fechaAbono = payRows[0].fecha;
    for (const q of cuotas) {
      const prev = Number(q.importe_previsto);
      if (restante + 0.001 < prev) break; // no alcanza para saldar esta cuota entera
      await client.query(
        `UPDATE conversion_installments
            SET fecha_cobro = $1, importe_cobrado = $2, payment_id = $3, updated_at = NOW()
          WHERE id = $4`,
        [fechaAbono, prev, payRows[0].id, q.id]);
      restante = Number((restante - prev).toFixed(2));
    }

    await client.query('COMMIT');
    return { payment: payRows[0], nuevoImportePagado: nuevoTotal };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Devuelve { conversion_id, lead_id, responsable_id } del pago para RBAC.
export async function getPaymentOwnership(paymentId) {
  const { query } = await import('../../shared/config/db.js');
  const { rows } = await query(
    `SELECT cp.id AS payment_id, cp.conversion_id, c.lead_id, l.responsable_id, l.project_id
     FROM conversion_payments cp
     JOIN conversions c ON c.id = cp.conversion_id
     JOIN leads l ON l.id = c.lead_id
     WHERE cp.id = $1`,
    [paymentId]
  );
  return rows[0] || null;
}

export async function deletePayment(paymentId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, conversion_id, importe FROM conversion_payments WHERE id = $1`,
      [paymentId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(`DELETE FROM conversion_payments WHERE id = $1`, [paymentId]);
    await client.query(
      `UPDATE conversions SET importe_pagado = importe_pagado - $1, updated_at = NOW() WHERE id = $2`,
      [rows[0].importe, rows[0].conversion_id]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteConversion(id) {
  await query(`DELETE FROM conversions WHERE id = $1`, [id]);
}
