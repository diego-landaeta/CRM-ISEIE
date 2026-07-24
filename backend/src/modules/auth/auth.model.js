import { query } from '../../shared/config/db.js';

export async function findUserByEmail(email) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.password_hash, u.role, u.active, u.avatar_url,
            u.custom_role_id, u.factura_manager, u.set_password_token, u.set_password_expires
     FROM users u
     WHERE u.email = $1`,
    [email]
  );
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.role, u.active, u.avatar_url, u.custom_role_id,
            u.factura_manager,
            cr.label AS custom_role_label
     FROM users u
     LEFT JOIN custom_roles cr ON cr.id = u.custom_role_id
     WHERE u.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function getUserProjects(userId, role) {
  // SOLO superadmin ve todos los proyectos sin asignación manual (rol global).
  // Para admin/gestor respetamos `user_projects` — un admin lo es de un
  // proyecto concreto, no del CRM entero. (Antes admin caía en la rama de
  // "todos" — bug histórico que rompía el aislamiento de proyectos.)
  if (role === 'superadmin') {
    const { rows } = await query(
      `SELECT p.id, p.nombre, p.slug, p.emoji, p.type, p.webhook_api_key,
              p.modules, p.sidebar_labels, p.theme_color,
              p.sociedad_emisora_id, s.razon_social AS sociedad_nombre
       FROM projects p
       LEFT JOIN invoice_issuers s ON s.id = p.sociedad_emisora_id
       WHERE p.active = true
       ORDER BY s.razon_social NULLS LAST, p.nombre`
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.slug, p.emoji, p.type, p.webhook_api_key,
            p.modules, p.sidebar_labels, p.theme_color,
            p.sociedad_emisora_id, s.razon_social AS sociedad_nombre
     FROM user_projects up
     JOIN projects p ON p.id = up.project_id
     LEFT JOIN invoice_issuers s ON s.id = p.sociedad_emisora_id
     WHERE up.user_id = $1 AND up.active = true AND p.active = true
     ORDER BY s.razon_social NULLS LAST, p.nombre`,
    [userId]
  );
  return rows;
}

export async function updateLastLogin(userId) {
  await query(
    `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [userId]
  );
}

export async function saveRefreshToken(userId, tokenHash, expiresAt) {
  await query(
    `INSERT INTO user_refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );
}

export async function findRefreshToken(tokenHash) {
  const { rows } = await query(
    `SELECT id, user_id, expires_at, revoked
     FROM user_refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash]
  );
  return rows[0] || null;
}

export async function revokeRefreshToken(tokenHash) {
  await query(
    `UPDATE user_refresh_tokens SET revoked = true WHERE token_hash = $1`,
    [tokenHash]
  );
}

export async function revokeAllUserTokens(userId) {
  await query(
    `UPDATE user_refresh_tokens SET revoked = true WHERE user_id = $1 AND revoked = false`,
    [userId]
  );
}

export async function findUserBySetPasswordToken(tokenHash) {
  const { rows } = await query(
    `SELECT id, email, nombre, set_password_expires
     FROM users
     WHERE set_password_token = $1`,
    [tokenHash]
  );
  return rows[0] || null;
}

export async function updatePassword(userId, passwordHash) {
  await query(
    `UPDATE users
     SET password_hash = $2,
         set_password_token = NULL,
         set_password_expires = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, passwordHash]
  );
}

export async function logActivity(userId, action, details, ipAddress) {
  await query(
    `INSERT INTO user_activity_log (user_id, action, details, ip_address)
     VALUES ($1, $2, $3, $4)`,
    [userId, action, details ? JSON.stringify(details) : null, ipAddress]
  );
}
