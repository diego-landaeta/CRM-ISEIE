import { query } from '../../shared/config/db.js';

export async function findByProject(projectId) {
  const { rows } = await query(
    `SELECT * FROM project_channels WHERE project_id = $1 AND active = true ORDER BY position ASC, id ASC`,
    [projectId]
  );
  return rows;
}

export async function create(data) {
  const { rows } = await query(
    `INSERT INTO project_channels (project_id, label, url, icon, position)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.project_id, data.label, data.url, data.icon || 'Globe', data.position ?? 0]
  );
  return rows[0];
}

export async function update(id, fields) {
  const allowed = ['label', 'url', 'icon', 'position', 'active'];
  const sets = []; const params = []; let idx = 1;
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(`${k} = $${idx++}`); params.push(fields[k]); }
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await query(
    `UPDATE project_channels SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  return rows[0] || null;
}

export async function remove(id) {
  await query(`DELETE FROM project_channels WHERE id = $1`, [id]);
}
