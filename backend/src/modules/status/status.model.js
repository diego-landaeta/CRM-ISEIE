import { query } from '../../shared/config/db.js';

// Las tablas `status_components`, `status_incidents`, `status_errors` están
// creadas en la migración 037_status.sql. Este model expone las queries
// reales contra ellas. `logError` se invoca desde el errorHandler global en
// cada 5xx — protegido con try/catch en el caller para no romper la cadena.

export async function getComponents() {
  const { rows } = await query(
    `SELECT id, name, slug, status, position, updated_at FROM status_components ORDER BY position`
  );
  return rows;
}

export async function updateComponentStatus(slug, status) {
  const { rows } = await query(
    `UPDATE status_components SET status = $1, updated_at = NOW() WHERE slug = $2 RETURNING *`,
    [status, slug]
  );
  return rows[0] || null;
}

export async function getActiveIncidents() {
  const { rows } = await query(
    `SELECT id, title, description, severity, status, affects, created_at, updated_at
       FROM status_incidents
      WHERE status != 'resolved'
      ORDER BY created_at DESC`
  );
  return rows;
}

export async function getIncidents({ limit = 20, resolved = true } = {}) {
  const whereClause = resolved ? '' : `WHERE status != 'resolved'`;
  const { rows } = await query(
    `SELECT id, title, description, severity, status, affects, resolved_at, created_at, updated_at
       FROM status_incidents
       ${whereClause}
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function createIncident({ title, description, severity, affects, created_by }) {
  const { rows } = await query(
    `INSERT INTO status_incidents (title, description, severity, affects, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [title, description || null, severity || 'warning', affects || [], created_by]
  );
  return rows[0];
}

export async function updateIncident(id, { title, description, severity, status, affects }) {
  const fields = [];
  const values = [];
  let i = 1;
  if (title !== undefined)       { fields.push(`title = $${i++}`);       values.push(title); }
  if (description !== undefined) { fields.push(`description = $${i++}`); values.push(description); }
  if (severity !== undefined)    { fields.push(`severity = $${i++}`);    values.push(severity); }
  if (affects !== undefined)     { fields.push(`affects = $${i++}`);     values.push(affects); }
  if (status !== undefined) {
    fields.push(`status = $${i++}`);
    values.push(status);
    if (status === 'resolved') fields.push(`resolved_at = NOW()`);
  }
  fields.push(`updated_at = NOW()`);
  values.push(id);
  const { rows } = await query(
    `UPDATE status_incidents SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] || null;
}

export async function getRecentErrors(limit = 100) {
  const { rows } = await query(
    `SELECT id, method, path, status_code, message, user_id, created_at
       FROM status_errors
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function logError({ method, path, status_code, message, stack, user_id }) {
  try {
    await query(
      `INSERT INTO status_errors (method, path, status_code, message, stack, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [method, path, status_code, message, stack, user_id || null]
    );
    // Mantener sólo los últimos 1000 errores
    await query(
      `DELETE FROM status_errors WHERE id NOT IN (
         SELECT id FROM status_errors ORDER BY created_at DESC LIMIT 1000
       )`
    );
  } catch {
    // No-op: si esto falla, no podemos hacer mucho — viene del errorHandler global.
  }
}
