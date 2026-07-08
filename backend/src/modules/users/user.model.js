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
            u.whatsapp_phone, u.whatsapp_display_name,
            COALESCE(
              (SELECT json_agg(up.project_id ORDER BY up.project_id)
               FROM user_projects up
               WHERE up.user_id = u.id AND up.active = true),
              '[]'::json
            ) AS project_ids,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'projectId', up.project_id,
                 'recibeLeads', up.recibe_leads
               ) ORDER BY up.project_id)
               FROM user_projects up
               WHERE up.user_id = u.id AND up.active = true),
              '[]'::json
            ) AS projects
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

export async function create({ nombre, email, passwordHash, role, projectIds, projects, setPasswordToken, setPasswordExpires }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO users (nombre, email, password_hash, role, set_password_token, set_password_expires)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, nombre, email, role, active, created_at`,
      [nombre, email, passwordHash, role, setPasswordToken, setPasswordExpires]
    );
    const user = rows[0];

    const projectsList = Array.isArray(projects) && projects.length > 0
      ? projects.map((p) => ({ projectId: p.projectId ?? p.project_id, recibeLeads: !!(p.recibeLeads ?? p.recibe_leads) }))
      : (Array.isArray(projectIds) ? projectIds.map((pid) => ({ projectId: pid, recibeLeads: false })) : []);

    for (const { projectId, recibeLeads } of projectsList) {
      await client.query(
        `INSERT INTO user_projects (user_id, project_id, orden_cola, recibe_leads)
         VALUES ($1, $2, (SELECT COALESCE(MAX(orden_cola), 0) + 1 FROM user_projects WHERE project_id = $2), $3)`,
        [user.id, projectId, recibeLeads]
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

export async function update(id, { nombre, role, projectIds, projects, avatar_url, avatar_key, whatsapp_phone, whatsapp_display_name }) {
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
    // Teléfono WhatsApp del gestor (cadena vacía → NULL para limpiar).
    if (whatsapp_phone !== undefined) { sets.push(`whatsapp_phone = $${paramIdx++}`); params.push(whatsapp_phone || null); }
    if (whatsapp_display_name !== undefined) { sets.push(`whatsapp_display_name = $${paramIdx++}`); params.push(whatsapp_display_name || null); }

    if (sets.length > 0) {
      sets.push(`updated_at = NOW()`);
      params.push(id);
      await client.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
    }

    // Acepta el formato nuevo (projects: [{projectId, recibeLeads}]) o el
    // legacy (projectIds: number[]) — este segundo deja recibe_leads en FALSE
    // (comportamiento previo: solo gestores reciben leads).
    const projectsList = Array.isArray(projects) && projects.length > 0
      ? projects.map((p) => ({ projectId: p.projectId ?? p.project_id, recibeLeads: !!(p.recibeLeads ?? p.recibe_leads) }))
      : (Array.isArray(projectIds) ? projectIds.map((pid) => ({ projectId: pid, recibeLeads: false })) : null);

    if (projectsList) {
      await client.query(`UPDATE user_projects SET active = false WHERE user_id = $1`, [id]);
      for (const { projectId, recibeLeads } of projectsList) {
        await client.query(
          `INSERT INTO user_projects (user_id, project_id, orden_cola, recibe_leads)
           VALUES ($1, $2, (SELECT COALESCE(MAX(orden_cola), 0) + 1 FROM user_projects WHERE project_id = $2), $3)
           ON CONFLICT (user_id, project_id) DO UPDATE SET active = true, recibe_leads = EXCLUDED.recibe_leads`,
          [id, projectId, recibeLeads]
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

// Reset de contraseña por admin: fija el hash y anula cualquier token pendiente.
export async function setPasswordHash(id, passwordHash) {
  await query(
    `UPDATE users SET password_hash = $2, set_password_token = NULL, set_password_expires = NULL, updated_at = NOW()
     WHERE id = $1`,
    [id, passwordHash]
  );
}

export async function reactivate(id) {
  await query(`UPDATE users SET active = true, updated_at = NOW() WHERE id = $1`, [id]);
}
