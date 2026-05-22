import { query, getClient } from '../../shared/config/db.js';

export async function findAll({ active, role, projectId, page, limit }) {
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (active !== undefined) {
    conditions.push(`u.active = $${paramIdx++}`);
    params.push(active === 'true');
  }
  if (role) {
    conditions.push(`u.role = $${paramIdx++}`);
    params.push(role);
  }
  if (projectId) {
    conditions.push(`EXISTS (SELECT 1 FROM user_projects up WHERE up.user_id = u.id AND up.project_id = $${paramIdx++})`);
    params.push(projectId);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (page - 1) * limit;

  const countResult = await query(`SELECT COUNT(*) FROM users u ${where}`, params);
  const total = parseInt(countResult.rows[0].count);

  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.role, u.active, u.last_login_at, u.created_at, u.avatar_url, u.avatar_key,
            COALESCE(
              (SELECT json_agg(up.project_id ORDER BY up.project_id)
               FROM user_projects up
               WHERE up.user_id = u.id AND up.active = true),
              '[]'::json
            ) AS project_ids
     FROM users u ${where}
     ORDER BY u.created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset]
  );

  return { users: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.role, u.active, u.last_login_at, u.created_at, u.avatar_url, u.avatar_key
     FROM users u WHERE u.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function findByEmail(email) {
  const { rows } = await query(`SELECT id FROM users WHERE email = $1`, [email]);
  return rows[0] || null;
}

export async function getUserProjects(userId) {
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.slug, p.emoji, p.type
     FROM user_projects up JOIN projects p ON p.id = up.project_id
     WHERE up.user_id = $1 AND up.active = true AND p.active = true
     ORDER BY p.nombre`,
    [userId]
  );
  return rows;
}

export async function create({ nombre, email, passwordHash, role, projectIds, setPasswordToken, setPasswordExpires }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO users (nombre, email, password_hash, role, set_password_token, set_password_expires)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, nombre, email, role, active, created_at`,
      [nombre, email, passwordHash, role, setPasswordToken, setPasswordExpires]
    );
    const user = rows[0];

    for (const projectId of projectIds) {
      await client.query(
        `INSERT INTO user_projects (user_id, project_id, orden_cola)
         VALUES ($1, $2, (SELECT COALESCE(MAX(orden_cola), 0) + 1 FROM user_projects WHERE project_id = $2))`,
        [user.id, projectId]
      );
    }

    await client.query('COMMIT');
    return user;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function update(id, { nombre, role, projectIds, avatar_url, avatar_key }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const sets = [];
    const params = [];
    let paramIdx = 1;

    if (nombre) { sets.push(`nombre = $${paramIdx++}`); params.push(nombre); }
    if (role) { sets.push(`role = $${paramIdx++}`); params.push(role); }
    if (avatar_url !== undefined) { sets.push(`avatar_url = $${paramIdx++}`); params.push(avatar_url); }
    if (avatar_key !== undefined) { sets.push(`avatar_key = $${paramIdx++}`); params.push(avatar_key); }

    if (sets.length > 0) {
      sets.push(`updated_at = NOW()`);
      params.push(id);
      await client.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
    }

    if (projectIds) {
      await client.query(`UPDATE user_projects SET active = false WHERE user_id = $1`, [id]);
      for (const projectId of projectIds) {
        await client.query(
          `INSERT INTO user_projects (user_id, project_id, orden_cola)
           VALUES ($1, $2, (SELECT COALESCE(MAX(orden_cola), 0) + 1 FROM user_projects WHERE project_id = $2))
           ON CONFLICT (user_id, project_id) DO UPDATE SET active = true`,
          [id, projectId]
        );
      }
    }

    await client.query('COMMIT');

    return await findById(id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deactivate(id) {
  await query(`UPDATE users SET active = false, updated_at = NOW() WHERE id = $1`, [id]);
}

export async function reactivate(id) {
  await query(`UPDATE users SET active = true, updated_at = NOW() WHERE id = $1`, [id]);
}

// Log de auditoría: paginado, opcionalmente filtrado por usuario y/o accion.
// `action` admite prefijo via LIKE (ej. "lead.%" devuelve todos los eventos de leads).
export async function listActivityLog({ userId = null, action = null, search = null, limit = 100, offset = 0 } = {}) {
  const params = [];
  const where = [];
  let i = 1;
  if (userId) { where.push(`a.user_id = $${i++}`); params.push(userId); }
  if (action) {
    if (action.includes('%')) { where.push(`a.action LIKE $${i++}`); params.push(action); }
    else { where.push(`a.action = $${i++}`); params.push(action); }
  }
  if (search) {
    where.push(`(u.nombre ILIKE $${i} OR u.email ILIKE $${i} OR a.action ILIKE $${i})`);
    params.push(`%${search}%`); i++;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit, offset);
  const { rows } = await query(
    `SELECT a.id, a.user_id, a.action, a.details, a.ip_address, a.created_at,
            u.nombre AS user_nombre, u.email AS user_email, u.role AS user_role
       FROM user_activity_log a
       LEFT JOIN users u ON u.id = a.user_id
       ${whereSql}
      ORDER BY a.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}`,
    params
  );
  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS total FROM user_activity_log a LEFT JOIN users u ON u.id = a.user_id ${whereSql}`,
    params.slice(0, params.length - 2)
  );
  return { items: rows, total: countRows[0]?.total || 0 };
}
