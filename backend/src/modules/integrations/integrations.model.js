import { query } from '../../shared/config/db.js';

// Si el provider/proyecto NO existe → null. Si existe pero NO se ha guardado
// secreto aún (encrypted_value=NULL) devolvemos la fila tal cual para que el
// frontend pueda mostrar el form con config_public actual.
export async function get(projectId, provider) {
  const { rows } = await query(
    `SELECT id, project_id, provider, active, encrypted_value, iv, auth_tag,
            config_public, last_test_status, last_test_message, last_test_at,
            created_at, updated_at
       FROM project_integrations
      WHERE project_id = $1 AND provider = $2`,
    [projectId, provider]
  );
  return rows[0] || null;
}

export async function listByProject(projectId) {
  const { rows } = await query(
    `SELECT id, project_id, provider, active, config_public,
            last_test_status, last_test_message, last_test_at,
            (encrypted_value IS NOT NULL) AS has_secret,
            created_at, updated_at
       FROM project_integrations
      WHERE project_id = $1
      ORDER BY provider`,
    [projectId]
  );
  return rows;
}

export async function upsert({ projectId, provider, active, encrypted_value, iv, auth_tag, config_public }) {
  // Si encrypted_value viene null/undefined, NO sobreescribe el actual (se reusa
  // el anterior). El frontend manda undefined si el user no toca el campo.
  const { rows } = await query(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, $2, COALESCE($3, false), $4, $5, $6, COALESCE($7::jsonb, '{}'::jsonb))
     ON CONFLICT (project_id, provider) DO UPDATE
       SET active          = COALESCE(EXCLUDED.active, project_integrations.active),
           encrypted_value = COALESCE(EXCLUDED.encrypted_value, project_integrations.encrypted_value),
           iv              = COALESCE(EXCLUDED.iv,              project_integrations.iv),
           auth_tag        = COALESCE(EXCLUDED.auth_tag,        project_integrations.auth_tag),
           config_public   = COALESCE(EXCLUDED.config_public,   project_integrations.config_public),
           updated_at      = NOW()
     RETURNING *`,
    [projectId, provider, active, encrypted_value || null, iv || null, auth_tag || null,
     config_public ? JSON.stringify(config_public) : null]
  );
  return rows[0];
}

export async function recordTestResult({ projectId, provider, status, message }) {
  await query(
    `UPDATE project_integrations
        SET last_test_status = $3,
            last_test_message = $4,
            last_test_at = NOW(),
            updated_at = NOW()
      WHERE project_id = $1 AND provider = $2`,
    [projectId, provider, status, (message || '').slice(0, 1000)]
  );
}

export async function remove(projectId, provider) {
  await query(`DELETE FROM project_integrations WHERE project_id = $1 AND provider = $2`,
    [projectId, provider]);
}
