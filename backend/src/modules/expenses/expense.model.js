import { query } from '../../shared/config/db.js';

// ============================================================
// EXPENSES (egresos / gastos operativos)
// Tabla: expenses (migracion 005_expenses.sql).
// Columnas: id, project_id, concepto, importe, fecha, categoria,
//           notas, registrado_por, created_at, updated_at.
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
