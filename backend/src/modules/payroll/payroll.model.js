import { query, getClient } from '../../shared/config/db.js';

// ====== plans ======
export async function listPlans(projectId) {
  const { rows } = await query(
    `SELECT pp.*, u.nombre as user_nombre, u.email as user_email, u.role
       FROM payroll_plans pp JOIN users u ON u.id = pp.user_id
      WHERE pp.project_id = $1 ORDER BY u.nombre`, [projectId]);
  return rows;
}
export async function getPlan(projectId, userId) {
  const { rows } = await query(`SELECT * FROM payroll_plans WHERE project_id = $1 AND user_id = $2`, [projectId, userId]);
  return rows[0] || null;
}
export async function upsertPlan(data) {
  const { rows } = await query(
    `INSERT INTO payroll_plans (project_id, user_id, modo_fijo, modo_horas, modo_comisiones, active, notas)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (project_id, user_id) DO UPDATE
       SET modo_fijo = EXCLUDED.modo_fijo, modo_horas = EXCLUDED.modo_horas,
           modo_comisiones = EXCLUDED.modo_comisiones, active = EXCLUDED.active,
           notas = EXCLUDED.notas, updated_at = NOW()
     RETURNING *`,
    [data.project_id, data.user_id, data.modo_fijo ?? null, data.modo_horas ?? null,
     !!data.modo_comisiones, data.active !== false, data.notas || null]
  );
  return rows[0];
}
export async function deletePlan(id) { await query(`DELETE FROM payroll_plans WHERE id = $1`, [id]); }

// ====== work hours ======
export async function listHours({ projectId, userId, from, to }) {
  const c = ['project_id = $1']; const p = [projectId]; let i = 2;
  if (userId) { c.push(`user_id = $${i++}`); p.push(userId); }
  if (from) { c.push(`fecha >= $${i++}`); p.push(from); }
  if (to) { c.push(`fecha <= $${i++}`); p.push(to); }
  const { rows } = await query(`SELECT wh.*, u.nombre as user_nombre FROM work_hours wh LEFT JOIN users u ON u.id = wh.user_id WHERE ${c.join(' AND ')} ORDER BY wh.fecha DESC`, p);
  return rows;
}
export async function createHours(data) {
  const { rows } = await query(
    `INSERT INTO work_hours (project_id, user_id, fecha, horas, notas, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [data.project_id, data.user_id, data.fecha, data.horas, data.notas || null, data.created_by || null]);
  return rows[0];
}
export async function deleteHours(id) { await query(`DELETE FROM work_hours WHERE id = $1`, [id]); }

// ====== periods ======
export async function listPeriods({ projectId, userId, year, month }) {
  const c = ['pp.project_id = $1']; const p = [projectId]; let i = 2;
  if (userId) { c.push(`pp.user_id = $${i++}`); p.push(userId); }
  if (year) { c.push(`pp.periodo_year = $${i++}`); p.push(year); }
  if (month) { c.push(`pp.periodo_month = $${i++}`); p.push(month); }
  const { rows } = await query(
    `SELECT pp.*, u.nombre as user_nombre, u.email as user_email
       FROM payroll_periods pp JOIN users u ON u.id = pp.user_id
      WHERE ${c.join(' AND ')}
      ORDER BY pp.periodo_year DESC, pp.periodo_month DESC, u.nombre`, p);
  return rows;
}
export async function getPeriod(id) {
  const { rows } = await query(
    `SELECT pp.*, u.nombre as user_nombre, u.email as user_email
       FROM payroll_periods pp JOIN users u ON u.id = pp.user_id WHERE pp.id = $1`, [id]);
  if (!rows[0]) return null;
  const { rows: adj } = await query(`SELECT pa.*, u.nombre as created_by_nombre FROM payroll_adjustments pa LEFT JOIN users u ON u.id = pa.created_by WHERE pa.period_id = $1 ORDER BY pa.created_at`, [id]);
  return { ...rows[0], adjustments: adj };
}

// Calcula y crea/actualiza un periodo (idempotente). Solo si esta abierto.
export async function generatePeriod({ projectId, userId, year, month, calledBy }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const planRes = await client.query(`SELECT * FROM payroll_plans WHERE project_id = $1 AND user_id = $2 AND active = true`, [projectId, userId]);
    const plan = planRes.rows[0];
    if (!plan) {
      await client.query('ROLLBACK');
      return null;
    }
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);  // last day of month
    const fmt = (d) => d.toISOString().slice(0, 10);

    let horasTotal = 0;
    if (plan.modo_horas != null) {
      const hRes = await client.query(`SELECT COALESCE(SUM(horas),0) as h FROM work_hours WHERE project_id = $1 AND user_id = $2 AND fecha BETWEEN $3 AND $4`, [projectId, userId, fmt(monthStart), fmt(monthEnd)]);
      horasTotal = Number(hRes.rows[0].h);
    }
    let montoComisiones = 0;
    if (plan.modo_comisiones) {
      const cRes = await client.query(
        `SELECT COALESCE(SUM(c.importe_comision),0) as t
           FROM commissions c JOIN conversions cv ON cv.id = c.conversion_id
          WHERE cv.project_id = $1 AND c.user_id = $2
            AND cv.fecha_conversion BETWEEN $3 AND $4`,
        [projectId, userId, fmt(monthStart), fmt(monthEnd)]
      );
      montoComisiones = Number(cRes.rows[0].t);
    }
    const fijo = Number(plan.modo_fijo || 0);
    const precioHora = Number(plan.modo_horas || 0);
    const montoHoras = horasTotal * precioHora;

    const existing = await client.query(`SELECT id, estado FROM payroll_periods WHERE project_id = $1 AND user_id = $2 AND periodo_year = $3 AND periodo_month = $4`, [projectId, userId, year, month]);
    if (existing.rows[0] && existing.rows[0].estado !== 'abierto') {
      await client.query('ROLLBACK');
      throw new Error('Periodo ya cerrado');
    }
    let ajustes = 0;
    if (existing.rows[0]) {
      const aRes = await client.query(`SELECT COALESCE(SUM(importe),0) as t FROM payroll_adjustments WHERE period_id = $1`, [existing.rows[0].id]);
      ajustes = Number(aRes.rows[0].t);
    }
    const total = fijo + montoHoras + montoComisiones + ajustes;
    const detalle = { plan, horasTotal, precioHora, fijo, montoHoras, montoComisiones, ajustes, calculatedAt: new Date().toISOString() };

    let row;
    if (existing.rows[0]) {
      const r = await client.query(
        `UPDATE payroll_periods SET fijo=$1, horas_total=$2, precio_hora=$3, monto_horas=$4, monto_comisiones=$5, ajustes=$6, total=$7, detalle=$8, updated_at=NOW()
          WHERE id = $9 RETURNING *`,
        [fijo, horasTotal, precioHora || null, montoHoras, montoComisiones, ajustes, total, JSON.stringify(detalle), existing.rows[0].id]);
      row = r.rows[0];
    } else {
      const r = await client.query(
        `INSERT INTO payroll_periods (project_id, user_id, periodo_year, periodo_month, fijo, horas_total, precio_hora, monto_horas, monto_comisiones, ajustes, total, detalle)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [projectId, userId, year, month, fijo, horasTotal, precioHora || null, montoHoras, montoComisiones, 0, total, JSON.stringify(detalle)]);
      row = r.rows[0];
    }
    await client.query('COMMIT');
    return row;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally { client.release(); }
}

export async function closePeriod(id, userId) {
  const { rows } = await query(`UPDATE payroll_periods SET estado = 'cerrado', cerrado_por = $2, cerrado_at = NOW(), updated_at = NOW() WHERE id = $1 AND estado = 'abierto' RETURNING *`, [id, userId]);
  return rows[0] || null;
}
export async function payPeriod(id, fechaPago) {
  const { rows } = await query(`UPDATE payroll_periods SET estado = 'pagado', fecha_pago = $2, updated_at = NOW() WHERE id = $1 RETURNING *`, [id, fechaPago]);
  return rows[0] || null;
}

// ====== adjustments ======
export async function addAdjustment(data) {
  const { rows } = await query(
    `INSERT INTO payroll_adjustments (period_id, tipo, importe, concepto, doc_url, doc_key, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [data.period_id, data.tipo, data.importe, data.concepto, data.doc_url || null, data.doc_key || null, data.created_by || null]);
  return rows[0];
}
export async function deleteAdjustment(id) { await query(`DELETE FROM payroll_adjustments WHERE id = $1`, [id]); }
