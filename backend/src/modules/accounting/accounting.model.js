import { query } from '../../shared/config/db.js';

// ============================================================
// EXPENSES (egresos)
// ============================================================

export async function createExpense(data, userId) {
  const { rows } = await query(
    `INSERT INTO expenses (project_id, concepto, importe, fecha, categoria, notas, registrado_por)
     VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6, $7)
     RETURNING *`,
    [data.project_id || null, data.concepto, data.importe, data.fecha, data.categoria, data.notas, userId]
  );
  return rows[0];
}

export async function findExpenseById(id) {
  const { rows } = await query(
    `SELECT e.*, p.nombre as proyecto_nombre, u.nombre as registrado_por_nombre
     FROM expenses e
     LEFT JOIN projects p ON p.id = e.project_id
     LEFT JOIN users u ON u.id = e.registrado_por
     WHERE e.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function listExpenses({ projectId, categoria, from, to, page, limit }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (projectId) { conditions.push(`e.project_id = $${idx++}`); params.push(projectId); }
  if (categoria) { conditions.push(`e.categoria = $${idx++}`); params.push(categoria); }
  if (from) { conditions.push(`e.fecha >= $${idx++}`); params.push(from); }
  if (to) { conditions.push(`e.fecha <= $${idx++}`); params.push(to); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (page - 1) * limit;

  const { rows: countRows } = await query(`SELECT COUNT(*) FROM expenses e ${where}`, params);
  const total = parseInt(countRows[0].count);

  const { rows } = await query(
    `SELECT e.*, p.nombre as proyecto_nombre, u.nombre as registrado_por_nombre
     FROM expenses e
     LEFT JOIN projects p ON p.id = e.project_id
     LEFT JOIN users u ON u.id = e.registrado_por
     ${where}
     ORDER BY e.fecha DESC, e.id DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  return { expenses: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function updateExpense(id, fields) {
  const allowed = ['project_id', 'concepto', 'importe', 'fecha', 'categoria', 'notas'];
  const sets = [];
  const params = [];
  let idx = 1;
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      sets.push(`${k} = $${idx++}`);
      params.push(fields[k]);
    }
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await query(`UPDATE expenses SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params);
  return rows[0];
}

export async function deleteExpense(id) {
  await query(`DELETE FROM expenses WHERE id = $1`, [id]);
}

// ============================================================
// DASHBOARD ACCOUNTING
// ============================================================

export async function getDashboardStats({ projectId, from, to }) {
  const projFilter = projectId ? 'AND c.project_id = $1' : '';
  const dateStart = from || '1970-01-01';
  const dateEnd = to || '2999-12-31';
  const params = projectId ? [projectId, dateStart, dateEnd] : [dateStart, dateEnd];
  const fromIdx = projectId ? 2 : 1;
  const toIdx = projectId ? 3 : 2;

  // Ingresos (via conversion_payments en rango)
  const paymentsProjFilter = projectId ? 'AND c.project_id = $1' : '';
  const { rows: ingresosRows } = await query(
    `SELECT
       COALESCE(SUM(cp.importe), 0) AS total_cobrado,
       COUNT(DISTINCT cp.id) AS num_pagos
     FROM conversion_payments cp
     JOIN conversions c ON c.id = cp.conversion_id
     WHERE cp.fecha BETWEEN $${fromIdx} AND $${toIdx} ${paymentsProjFilter}`,
    params
  );

  // Facturado (total conversions en rango)
  const convProjFilter = projectId ? 'AND c.project_id = $1' : '';
  const { rows: facturadoRows } = await query(
    `SELECT
       COALESCE(SUM(c.importe_total), 0) AS total_facturado,
       COALESCE(SUM(c.importe_total - c.importe_pagado), 0) AS total_pendiente,
       COUNT(*) AS num_conversiones
     FROM conversions c
     WHERE c.fecha_conversion BETWEEN $${fromIdx} AND $${toIdx} ${convProjFilter}`,
    params
  );

  // Egresos
  const expProjFilter = projectId ? 'AND (e.project_id = $1 OR e.project_id IS NULL)' : '';
  const { rows: egresosRows } = await query(
    `SELECT
       COALESCE(SUM(e.importe), 0) AS total_egresos,
       COUNT(*) AS num_egresos
     FROM expenses e
     WHERE e.fecha BETWEEN $${fromIdx} AND $${toIdx} ${expProjFilter}`,
    params
  );

  // Cuentas por cobrar (conversions con pendiente, ordenadas por vencimiento)
  const { rows: receivables } = await query(
    `SELECT c.id, c.lead_id, c.producto_contratado,
            c.importe_total, c.importe_pagado,
            (c.importe_total - c.importe_pagado) AS importe_pendiente,
            c.fecha_compromiso_pago,
            c.fecha_conversion,
            l.nombre as lead_nombre, l.email as lead_email,
            p.nombre as proyecto_nombre,
            CASE
              WHEN c.fecha_compromiso_pago IS NOT NULL AND c.fecha_compromiso_pago < CURRENT_DATE THEN true
              ELSE false
            END AS vencido
     FROM conversions c
     LEFT JOIN leads l ON l.id = c.lead_id
     LEFT JOIN projects p ON p.id = c.project_id
     WHERE c.importe_pagado < c.importe_total ${convProjFilter.replace('$1', projectId ? '$1' : '$1')}
     ORDER BY c.fecha_compromiso_pago ASC NULLS LAST
     LIMIT 50`,
    projectId ? [projectId] : []
  );

  // Evolucion mensual ultimos 12 meses
  const trendProjFilter = projectId ? 'AND project_id = $1' : '';
  const trendParams = projectId ? [projectId] : [];
  const { rows: ingresosTrend } = await query(
    `SELECT to_char(date_trunc('month', cp.fecha), 'YYYY-MM') AS mes,
            COALESCE(SUM(cp.importe), 0) AS total
     FROM conversion_payments cp
     JOIN conversions c ON c.id = cp.conversion_id
     WHERE cp.fecha >= CURRENT_DATE - INTERVAL '12 months' ${trendProjFilter.replace('project_id', 'c.project_id')}
     GROUP BY 1
     ORDER BY 1`,
    trendParams
  );
  const { rows: egresosTrend } = await query(
    `SELECT to_char(date_trunc('month', fecha), 'YYYY-MM') AS mes,
            COALESCE(SUM(importe), 0) AS total
     FROM expenses
     WHERE fecha >= CURRENT_DATE - INTERVAL '12 months' ${trendProjFilter.replace('project_id', 'expenses.project_id')}
     GROUP BY 1
     ORDER BY 1`,
    trendParams
  );

  // Egresos por categoria
  const { rows: porCategoria } = await query(
    `SELECT categoria, COALESCE(SUM(importe), 0) AS total
     FROM expenses e
     WHERE e.fecha BETWEEN $${fromIdx} AND $${toIdx} ${expProjFilter}
     GROUP BY categoria
     ORDER BY total DESC`,
    params
  );

  return {
    ingresos: {
      total_cobrado: Number(ingresosRows[0].total_cobrado),
      total_facturado: Number(facturadoRows[0].total_facturado),
      total_pendiente: Number(facturadoRows[0].total_pendiente),
      num_pagos: parseInt(ingresosRows[0].num_pagos),
      num_conversiones: parseInt(facturadoRows[0].num_conversiones),
    },
    egresos: {
      total: Number(egresosRows[0].total_egresos),
      num_egresos: parseInt(egresosRows[0].num_egresos),
      por_categoria: porCategoria.map(r => ({ categoria: r.categoria, total: Number(r.total) })),
    },
    balance: Number(ingresosRows[0].total_cobrado) - Number(egresosRows[0].total_egresos),
    cuentas_por_cobrar: receivables.map(r => ({ ...r, importe_pendiente: Number(r.importe_pendiente) })),
    trend: {
      ingresos: ingresosTrend.map(r => ({ mes: r.mes, total: Number(r.total) })),
      egresos: egresosTrend.map(r => ({ mes: r.mes, total: Number(r.total) })),
    },
  };
}
