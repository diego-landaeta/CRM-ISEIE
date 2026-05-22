import { query } from '../../shared/config/db.js';

export async function listByProject(projectId) {
  const { rows } = await query(
    `SELECT id, project_id, type, label, destination, config, field_mapping,
            sample_payload, sample_received_at, active,
            last_sync_at, last_sync_status, last_sync_count, created_at, updated_at
     FROM project_connectors
     WHERE project_id = $1
     ORDER BY id`,
    [projectId]
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(`SELECT * FROM project_connectors WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function create(data) {
  const { rows } = await query(
    `INSERT INTO project_connectors (project_id, type, label, destination, config, field_mapping)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      data.project_id,
      data.type,
      data.label,
      data.destination || 'product',
      JSON.stringify(data.config || {}),
      JSON.stringify(data.field_mapping || {}),
    ]
  );
  return rows[0];
}

export async function update(id, data) {
  const allowed = ['label', 'destination', 'config', 'field_mapping', 'active'];
  const fields = []; const values = []; let i = 1;
  for (const k of allowed) {
    if (data[k] === undefined) continue;
    fields.push(`${k} = $${i++}`);
    values.push((k === 'config' || k === 'field_mapping') ? JSON.stringify(data[k]) : data[k]);
  }
  if (!fields.length) return null;
  fields.push('updated_at = NOW()');
  values.push(id);
  const { rows } = await query(
    `UPDATE project_connectors SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] || null;
}

export async function remove(id) {
  await query(`DELETE FROM project_connectors WHERE id = $1`, [id]);
}

export async function saveSample(id, sample) {
  await query(
    `UPDATE project_connectors SET sample_payload = $1, sample_received_at = NOW(), updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(sample), id]
  );
}

export async function recordSync(id, status, count) {
  await query(
    `UPDATE project_connectors SET last_sync_at = NOW(), last_sync_status = $1, last_sync_count = $2, updated_at = NOW() WHERE id = $3`,
    [status, count, id]
  );
}
