import { query } from '../../shared/config/db.js';
import { encrypt, decrypt, maskSecret } from '../../shared/utils/crypto.js';

export async function list({ projectId, service }) {
  const conditions = ['ac.active = true'];
  const params = [];
  let idx = 1;
  if (projectId !== undefined) {
    conditions.push(projectId === null ? `ac.project_id IS NULL` : `ac.project_id = $${idx++}`);
    if (projectId !== null) params.push(projectId);
  }
  if (service) { conditions.push(`ac.service = $${idx++}`); params.push(service); }

  const { rows } = await query(
    `SELECT ac.id, ac.project_id, ac.service, ac.metadata, ac.active,
            ac.last_tested_at, ac.last_test_result, ac.created_at, ac.updated_at,
            ac.encrypted_value, ac.iv, ac.auth_tag,
            p.nombre as project_nombre
     FROM api_credentials ac
     LEFT JOIN projects p ON p.id = ac.project_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ac.service, ac.project_id`,
    params
  );

  return rows.map(r => ({
    id: r.id,
    project_id: r.project_id,
    project_nombre: r.project_nombre,
    service: r.service,
    metadata: r.metadata,
    active: r.active,
    last_tested_at: r.last_tested_at,
    last_test_result: r.last_test_result,
    masked_value: maskSecret(decrypt(r.encrypted_value, r.iv, r.auth_tag)),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export async function getDecryptedValue(service, projectId = null) {
  const { rows } = await query(
    `SELECT encrypted_value, iv, auth_tag FROM api_credentials
     WHERE service = $1 AND (project_id = $2 OR ($2::int IS NULL AND project_id IS NULL))
     AND active = true LIMIT 1`,
    [service, projectId]
  );
  if (!rows[0]) return null;
  return decrypt(rows[0].encrypted_value, rows[0].iv, rows[0].auth_tag);
}

export async function upsert({ project_id, service, value, metadata }) {
  const { encrypted, iv, authTag } = encrypt(value);
  const pId = project_id || null;
  const { rows } = await query(
    `INSERT INTO api_credentials (project_id, service, encrypted_value, iv, auth_tag, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (project_id, service) DO UPDATE
       SET encrypted_value = EXCLUDED.encrypted_value,
           iv = EXCLUDED.iv,
           auth_tag = EXCLUDED.auth_tag,
           metadata = COALESCE(EXCLUDED.metadata, api_credentials.metadata),
           active = true,
           updated_at = NOW()
     RETURNING id, project_id, service, metadata, active, created_at, updated_at`,
    [pId, service, encrypted, iv, authTag, metadata ? JSON.stringify(metadata) : null]
  );
  const r = rows[0];
  return { ...r, masked_value: maskSecret(value) };
}

export async function remove(id) {
  await query(`UPDATE api_credentials SET active = false WHERE id = $1`, [id]);
}

export async function recordTestResult(id, result) {
  await query(
    `UPDATE api_credentials SET last_tested_at = NOW(), last_test_result = $1 WHERE id = $2`,
    [result, id]
  );
}
