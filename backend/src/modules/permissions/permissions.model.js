import { query } from '../../shared/config/db.js';

export async function findAllCustomRoles() {
  const { rows } = await query(
    `SELECT id, label, description, base_role, permissions, active, created_at
     FROM custom_roles
     ORDER BY label`
  );
  return rows;
}

export async function findCustomRoleById(id) {
  const { rows } = await query(
    `SELECT id, label, description, base_role, permissions, active, created_at
     FROM custom_roles WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function createCustomRole({ label, description, base_role, permissions }) {
  const { rows } = await query(
    `INSERT INTO custom_roles (label, description, base_role, permissions)
     VALUES ($1, $2, $3, $4)
     RETURNING id, label, description, base_role, permissions, active, created_at`,
    [label, description || null, base_role || 'gestor', JSON.stringify(permissions || {})]
  );
  return rows[0];
}

export async function updateCustomRole(id, { label, description, base_role, permissions, active }) {
  const fields = [];
  const values = [];
  let i = 1;

  if (label !== undefined)       { fields.push(`label = $${i++}`);       values.push(label); }
  if (description !== undefined) { fields.push(`description = $${i++}`); values.push(description); }
  if (base_role !== undefined)   { fields.push(`base_role = $${i++}`);   values.push(base_role); }
  if (permissions !== undefined) { fields.push(`permissions = $${i++}`); values.push(JSON.stringify(permissions)); }
  if (active !== undefined)      { fields.push(`active = $${i++}`);      values.push(active); }

  fields.push(`updated_at = NOW()`);
  values.push(id);

  const { rows } = await query(
    `UPDATE custom_roles SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] || null;
}

export async function deleteCustomRole(id) {
  const { rows: users } = await query(
    `SELECT id FROM users WHERE custom_role_id = $1 LIMIT 1`,
    [id]
  );
  if (users.length > 0) return { error: 'HAS_USERS' };

  await query(`DELETE FROM custom_roles WHERE id = $1`, [id]);
  return { ok: true };
}

export async function getOverridesByUser(userId) {
  const { rows } = await query(
    `SELECT resource, action, allowed FROM user_permission_overrides WHERE user_id = $1 ORDER BY resource, action`,
    [userId]
  );
  return rows;
}

export async function saveOverridesForUser(userId, overrides) {
  // overrides: [{ resource, action, allowed }]
  // Reemplaza todos los overrides del usuario en una transacción
  await query(`DELETE FROM user_permission_overrides WHERE user_id = $1`, [userId]);

  if (!overrides || overrides.length === 0) return;

  const values = overrides.flatMap(({ resource, action, allowed }) => [userId, resource, action, allowed]);
  const placeholders = overrides.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(', ');

  await query(
    `INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ${placeholders}`,
    values
  );
}

export async function getUserCustomRoleId(userId) {
  const { rows } = await query(
    `SELECT custom_role_id FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0]?.custom_role_id ?? null;
}
