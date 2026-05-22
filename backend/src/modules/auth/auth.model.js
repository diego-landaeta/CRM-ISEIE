import { query } from '../../shared/config/db.js';

export async function findUserByEmail(email) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.password_hash, u.role, u.active, u.avatar_url,
            u.custom_role_id, u.set_password_token, u.set_password_expires
     FROM users u
     WHERE u.email = $1`,
    [email]
  );
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.role, u.active, u.avatar_url, u.custom_role_id,
            cr.label AS custom_role_label
     FROM users u
     LEFT JOIN custom_roles cr ON cr.id = u.custom_role_id
     WHERE u.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function getUserProjects(userId, role) {
  // Superadmin/admin ven TODOS los proyectos activos automáticamente
  // (sin necesidad de estar en user_projects). Esto evita que un proyecto
  // recién creado no aparezca en el selector hasta asignarse manualmente.
  //
  // TODO: las columnas `shortcuts`, `external_panels`, `logo_url`, `auto_email_documents`
  // aun no existen en 001_initial_schema.sql — se anadiran en migraciones posteriores
  // (CRM hermano las creo en 008, 018, etc.). Hasta entonces solo seleccionamos
  // las que existen en CRM-ISEIE.
  if (role === 'superadmin' || role === 'admin') {
    const { rows } = await query(
      `SELECT p.id, p.nombre, p.slug, p.emoji, p.type, p.webhook_api_key,
              p.modules, p.sidebar_labels, p.theme_color
       FROM projects p
       WHERE p.active = true
       ORDER BY p.nombre`
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.slug, p.emoji, p.type, p.webhook_api_key,
            p.modules, p.sidebar_labels, p.theme_color
     FROM user_projects up
     JOIN projects p ON p.id = up.project_id
     WHERE up.user_id = $1 AND up.active = true AND p.active = true
     ORDER BY p.nombre`,
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
