import crypto from 'crypto';
import { query } from '../../shared/config/db.js';

export async function listByProject(projectId, kind) {
  const c = ['project_id = $1']; const p = [projectId]; let i = 2;
  if (kind) { c.push(`kind = $${i++}`); p.push(kind); }
  const { rows } = await query(`SELECT * FROM project_webhook_tokens WHERE ${c.join(' AND ')} ORDER BY created_at DESC`, p);
  return rows;
}

export async function findByToken(token) {
  const { rows } = await query(`SELECT * FROM project_webhook_tokens WHERE token = $1 AND active = true`, [token]);
  return rows[0] || null;
}

export async function findById(id) {
  const { rows } = await query(`SELECT * FROM project_webhook_tokens WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function setListenMode(id, awaiting) {
  const sets = ['awaiting_sample = $2', 'last_used_at = last_used_at']; // touch updated, no
  const params = [id, awaiting];
  if (awaiting) {
    // limpiar sample previo al iniciar escucha
    sets.push('sample_payload = NULL', 'sample_received_at = NULL');
  }
  const { rows } = await query(`UPDATE project_webhook_tokens SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  return rows[0];
}

export async function saveSample(id, payload) {
  const { rows } = await query(
    `UPDATE project_webhook_tokens
       SET sample_payload = $2, sample_received_at = NOW(), awaiting_sample = false
     WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(payload)]
  );
  return rows[0];
}

export async function create(data) {
  const token = `${data.kind}_${crypto.randomBytes(16).toString('hex')}`;
  const { rows } = await query(
    `INSERT INTO project_webhook_tokens (project_id, kind, token, field_mapping, notas, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [data.project_id, data.kind, token, JSON.stringify(data.field_mapping || {}), data.notas || null, data.created_by || null]
  );
  return rows[0];
}

export async function update(id, fields) {
  const allowed = ['active', 'field_mapping', 'notas'];
  const jsonbFields = new Set(['field_mapping']);
  const sets = []; const params = []; let idx = 1;
  for (const k of allowed) if (fields[k] !== undefined) {
    sets.push(`${k} = $${idx++}`);
    params.push(jsonbFields.has(k) ? JSON.stringify(fields[k]) : fields[k]);
  }
  if (!sets.length) return null;
  params.push(id);
  const { rows } = await query(`UPDATE project_webhook_tokens SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params);
  return rows[0];
}

export async function remove(id) { await query(`DELETE FROM project_webhook_tokens WHERE id = $1`, [id]); }

export async function recordUse(id) {
  await query(`UPDATE project_webhook_tokens SET uses_count = uses_count + 1, last_used_at = NOW() WHERE id = $1`, [id]);
}
