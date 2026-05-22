import { query, getClient } from '../../shared/config/db.js';

function buildFilters({ projectId, estado, from, to }) {
  const conds = [];
  const params = [];
  let idx = 1;
  if (projectId) { conds.push(`ap.project_id = $${idx++}`); params.push(projectId); }
  if (estado) { conds.push(`ap.estado = $${idx++}`); params.push(estado); }
  if (from) { conds.push(`ap.fecha_factura >= $${idx++}`); params.push(from); }
  if (to) { conds.push(`ap.fecha_factura <= $${idx++}`); params.push(to); }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

export async function list(filters) {
  const { where, params } = buildFilters(filters);
  const { rows } = await query(
    `SELECT ap.*, p.nombre as proyecto_nombre,
            (ap.importe_total - ap.importe_pagado) as importe_pendiente,
            (ap.fecha_compromiso_pago IS NOT NULL AND ap.fecha_compromiso_pago < CURRENT_DATE AND ap.estado IN ('pendiente','parcial')) as vencido
     FROM accounts_payable ap
     LEFT JOIN projects p ON p.id = ap.project_id
     ${where}
     ORDER BY ap.fecha_compromiso_pago ASC NULLS LAST, ap.created_at DESC`,
    params
  );
  return rows;
}

export async function getById(id) {
  const { rows } = await query(
    `SELECT ap.*, p.nombre as proyecto_nombre,
            (ap.importe_total - ap.importe_pagado) as importe_pendiente
     FROM accounts_payable ap LEFT JOIN projects p ON p.id = ap.project_id
     WHERE ap.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function getPayments(payableId) {
  const { rows } = await query(
    `SELECT app.*, u.nombre as registrado_por_nombre
     FROM accounts_payable_payments app
     LEFT JOIN users u ON u.id = app.registrado_por
     WHERE app.payable_id = $1 ORDER BY app.fecha_pago DESC, app.id DESC`,
    [payableId]
  );
  return rows;
}

export async function create(data, userId) {
  const { rows } = await query(
    `INSERT INTO accounts_payable
       (project_id, proveedor, concepto, categoria, importe_total, fecha_factura, fecha_compromiso_pago, notas, registrado_por)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6::date, CURRENT_DATE), $7, $8, $9)
     RETURNING *`,
    [data.project_id || null, data.proveedor, data.concepto, data.categoria || 'proveedores',
     data.importe_total, data.fecha_factura || null, data.fecha_compromiso_pago || null,
     data.notas || null, userId]
  );
  return rows[0];
}

export async function update(id, data) {
  const allowed = ['project_id', 'proveedor', 'concepto', 'categoria', 'importe_total', 'fecha_factura', 'fecha_compromiso_pago', 'notas'];
  const sets = [];
  const params = [];
  let idx = 1;
  for (const k of allowed) {
    if (data[k] !== undefined) { sets.push(`${k} = $${idx++}`); params.push(data[k]); }
  }
  if (!sets.length) return getById(id);
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await query(
    `UPDATE accounts_payable SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  return rows[0];
}

export async function remove(id) {
  await query(`DELETE FROM accounts_payable WHERE id = $1`, [id]);
}

export async function addPayment(payableId, data, userId) {
  const c = await getClient();
  try {
    await c.query('BEGIN');
    const { rows: pRows } = await c.query(
      `SELECT id, importe_total, importe_pagado FROM accounts_payable WHERE id = $1 FOR UPDATE`,
      [payableId]
    );
    if (!pRows[0]) { await c.query('ROLLBACK'); return null; }
    const current = pRows[0];
    const newPagado = Number(current.importe_pagado) + Number(data.importe);
    if (newPagado > Number(current.importe_total)) {
      await c.query('ROLLBACK');
      throw new Error('Pago excede el importe pendiente');
    }
    const { rows: pay } = await c.query(
      `INSERT INTO accounts_payable_payments (payable_id, importe, fecha_pago, metodo, referencia, notas, registrado_por)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7) RETURNING *`,
      [payableId, data.importe, data.fecha_pago || null, data.metodo || null, data.referencia || null, data.notas || null, userId]
    );
    const estado = newPagado >= Number(current.importe_total) ? 'pagado' : 'parcial';
    await c.query(
      `UPDATE accounts_payable SET importe_pagado = $1, estado = $2, updated_at = NOW() WHERE id = $3`,
      [newPagado, estado, payableId]
    );
    await c.query('COMMIT');
    return pay[0];
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

export async function getStats({ projectId, from, to }) {
  const conds = [];
  const params = [];
  let idx = 1;
  if (projectId) { conds.push(`project_id = $${idx++}`); params.push(projectId); }
  if (from) { conds.push(`fecha_factura >= $${idx++}`); params.push(from); }
  if (to) { conds.push(`fecha_factura <= $${idx++}`); params.push(to); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(importe_total), 0) as total_facturado,
       COALESCE(SUM(importe_pagado), 0) as total_pagado,
       COALESCE(SUM(importe_total - importe_pagado) FILTER (WHERE estado IN ('pendiente','parcial')), 0) as total_pendiente,
       COUNT(*) FILTER (WHERE estado IN ('pendiente','parcial') AND fecha_compromiso_pago IS NOT NULL AND fecha_compromiso_pago < CURRENT_DATE) as vencidas
     FROM accounts_payable ${where}`,
    params
  );
  return rows[0];
}
