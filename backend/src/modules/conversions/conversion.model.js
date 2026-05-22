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
      fecha_compromiso_pago,
      fecha_conversion,
      notas_pago,
    } = data;

    // INSERT conversion
    const { rows: convRows } = await client.query(
      `INSERT INTO conversions
        (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado,
         metodo_pago, fecha_compromiso_pago, fecha_conversion, notas_pago)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, CURRENT_DATE), $10)
       RETURNING *`,
      [lead_id, project_id, producto_contratado, producto_contratado_id || null,
       importe_total, importe_pagado, metodo_pago, fecha_compromiso_pago, fecha_conversion, notas_pago]
    );
    const conversion = convRows[0];

    // Si hay importe_pagado > 0, crear primer payment
    if (Number(importe_pagado) > 0) {
      await client.query(
        `INSERT INTO conversion_payments (conversion_id, importe, fecha, notas)
         VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4)`,
        [conversion.id, importe_pagado, fecha_conversion, 'Pago inicial']
      );
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

  const { rows: payments } = await query(
    `SELECT id, importe, fecha, notas, created_at
     FROM conversion_payments
     WHERE conversion_id = $1
     ORDER BY fecha DESC, id DESC`,
    [id]
  );
  conversion.payments = payments;
  return conversion;
}

export async function findByLead(leadId) {
  // Devuelve payments y refunds embebidos (json_agg) para evitar N+1 desde el front.
  const { rows } = await query(
    `SELECT c.*,
            (c.importe_total - c.importe_pagado) AS importe_pendiente,
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

export async function findAll({ projectId, leadId, pendiente, vencido, from, to, page, limit }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (projectId) { conditions.push(`c.project_id = $${idx++}`); params.push(projectId); }
  if (leadId) { conditions.push(`c.lead_id = $${idx++}`); params.push(leadId); }
  if (pendiente === 'true') { conditions.push(`c.importe_pagado < c.importe_total`); }
  if (pendiente === 'false') { conditions.push(`c.importe_pagado >= c.importe_total`); }
  if (vencido === 'true') {
    conditions.push(`c.fecha_compromiso_pago IS NOT NULL AND c.fecha_compromiso_pago < CURRENT_DATE AND c.importe_pagado < c.importe_total`);
  }
  if (from) { conditions.push(`c.fecha_conversion >= $${idx++}`); params.push(from); }
  if (to) { conditions.push(`c.fecha_conversion <= $${idx++}`); params.push(to); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (page - 1) * limit;

  const { rows: countRows } = await query(`SELECT COUNT(*) FROM conversions c ${where}`, params);
  const total = parseInt(countRows[0].count);

  const { rows } = await query(
    `SELECT c.id, c.lead_id, c.project_id, c.producto_contratado,
            c.importe_total, c.importe_pagado,
            (c.importe_total - c.importe_pagado) AS importe_pendiente,
            c.fecha_compromiso_pago, c.metodo_pago,
            c.fecha_conversion, c.created_at,
            l.nombre as lead_nombre, l.email as lead_email,
            p.nombre as proyecto_nombre
     FROM conversions c
     LEFT JOIN leads l ON l.id = c.lead_id
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

export async function addPayment(conversionId, { importe, fecha, notas }) {
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
    if (nuevoTotal > Number(convRows[0].importe_total)) {
      await client.query('ROLLBACK');
      return { error: 'OVERPAY' };
    }

    // INSERT payment
    const { rows: payRows } = await client.query(
      `INSERT INTO conversion_payments (conversion_id, importe, fecha, notas)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4)
       RETURNING *`,
      [conversionId, importe, fecha, notas]
    );

    // UPDATE conversion.importe_pagado
    await client.query(
      `UPDATE conversions SET importe_pagado = $1, updated_at = NOW() WHERE id = $2`,
      [nuevoTotal, conversionId]
    );

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
