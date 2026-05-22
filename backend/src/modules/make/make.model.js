import crypto from 'crypto';
import { query } from '../../shared/config/db.js';

export async function listByProject(projectId) {
  const { rows } = await query(
    `SELECT id, project_id, slug, label, mode, field_mapping,
            sample_payload, sample_received_at,
            total_received, total_created, total_errors,
            last_received_at, last_error, active, created_at
     FROM make_webhooks WHERE project_id = $1 ORDER BY id`,
    [projectId]
  );
  return rows;
}

export async function findBySlug(slug) {
  const { rows } = await query(`SELECT * FROM make_webhooks WHERE slug = $1`, [slug]);
  return rows[0] || null;
}

export async function findById(id) {
  const { rows } = await query(`SELECT * FROM make_webhooks WHERE id = $1`, [id]);
  return rows[0] || null;
}

function randomSlug() {
  return 'mk_' + crypto.randomBytes(8).toString('hex');
}
function randomSecret() {
  return 'msk_' + crypto.randomBytes(24).toString('hex');
}

export async function create({ project_id, label, field_mapping = {}, mode = 'test' }) {
  const slug = randomSlug();
  const secret = randomSecret();
  const { rows } = await query(
    `INSERT INTO make_webhooks (project_id, slug, label, secret, mode, field_mapping)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    [project_id, slug, label, secret, mode, JSON.stringify(field_mapping)]
  );
  return rows[0];
}

export async function update(id, patch) {
  const allowed = ['label', 'mode', 'field_mapping', 'active'];
  const sets = []; const vals = []; let i = 1;
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    sets.push(`${k} = $${i++}`);
    vals.push(k === 'field_mapping' ? JSON.stringify(patch[k]) : patch[k]);
  }
  if (!sets.length) return findById(id);
  sets.push('updated_at = NOW()');
  vals.push(id);
  const { rows } = await query(
    `UPDATE make_webhooks SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  );
  return rows[0];
}

export async function remove(id) {
  await query(`DELETE FROM make_webhooks WHERE id = $1`, [id]);
}

export async function rotateSecret(id) {
  const secret = randomSecret();
  const { rows } = await query(
    `UPDATE make_webhooks SET secret = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [secret, id]
  );
  return rows[0];
}

export async function saveSample(id, payload) {
  await query(
    `UPDATE make_webhooks
     SET sample_payload = $1::jsonb, sample_received_at = NOW(),
         total_received = total_received + 1,
         last_received_at = NOW(),
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(payload), id]
  );
}

export async function bumpCounter(id, { ok, errorMsg } = {}) {
  await query(
    `UPDATE make_webhooks
     SET total_created = total_created + $2,
         total_errors  = total_errors + $3,
         last_error    = $4,
         updated_at    = NOW()
     WHERE id = $1`,
    [id, ok ? 1 : 0, ok ? 0 : 1, ok ? null : (errorMsg?.slice(0, 1000) || null)]
  );
}

export async function logDelivery({ webhook_id, result, lead_id, error_message, payload, mapped }) {
  await query(
    `INSERT INTO make_webhook_deliveries
       (webhook_id, result, lead_id, error_message, payload, mapped)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      webhook_id, result, lead_id || null, error_message || null,
      payload != null ? JSON.stringify(payload) : null,
      mapped != null ? JSON.stringify(mapped) : null,
    ]
  );
}

export async function listDeliveries(webhookId, limit = 30) {
  const { rows } = await query(
    `SELECT id, received_at, result, lead_id, error_message, payload, mapped
     FROM make_webhook_deliveries
     WHERE webhook_id = $1
     ORDER BY received_at DESC LIMIT $2`,
    [webhookId, limit]
  );
  return rows;
}
