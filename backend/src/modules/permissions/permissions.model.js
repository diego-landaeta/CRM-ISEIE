import { query, getClient } from '../../shared/config/db.js';

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

/**
 * UNA excepción de una persona, sin tocar las demás (#223, MultiCRM #384).
 * `allowed` null la quita: la persona vuelve a lo que diga su rol.
 */
export async function setUserOverride(userId, resource, action, allowed) {
  if (allowed === null || allowed === undefined) {
    await query(
      'DELETE FROM user_permission_overrides WHERE user_id = $1 AND resource = $2 AND action = $3',
      [userId, resource, action]);
    return;
  }
  await query(
    `INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed`,
    [userId, resource, action, allowed === true]);
}

/**
 * Lo que se ha cambiado desde Roles para estos roles del sistema (migración
 * 211; en MultiCRM la 197). Sin la tabla todavía —servidor sin migrar— cada
 * rol se queda con lo que dice el código, igual que antes.
 */
export async function getRoleOverrides(roles) {
  const lista = [...new Set((roles || []).filter(Boolean))];
  if (!lista.length) return [];
  try {
    const { rows } = await query(
      `SELECT role, resource, action, allowed FROM role_permission_overrides
        WHERE role = ANY($1::text[]) ORDER BY role, resource, action`,
      [lista]
    );
    return rows;
  } catch (err) {
    if (err.code === '42P01') return [];
    throw err;
  }
}

/**
 * Deja los permisos de un recurso de un rol exactamente así: borra los que
 * había de ese recurso e inserta los nuevos, en una transacción.
 */
export async function saveRoleOverrides(role, resource, filas, updatedBy) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM role_permission_overrides WHERE role = $1 AND resource = $2', [role, resource]);
    for (const { action, allowed } of filas) {
      await client.query(
        `INSERT INTO role_permission_overrides (role, resource, action, allowed, updated_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [role, resource, action, allowed, updatedBy]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Cambia algunas claves de un rol a medida sin tocar el resto de su JSON. */
export async function mergeCustomRolePermissions(id, cambios) {
  const { rows } = await query(
    `UPDATE custom_roles SET permissions = COALESCE(permissions, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
      WHERE id = $1 RETURNING id, label, base_role, permissions`,
    [id, JSON.stringify(cambios)]
  );
  return rows[0] || null;
}

export async function getUserCustomRoleId(userId) {
  const { rows } = await query(
    `SELECT custom_role_id FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0]?.custom_role_id ?? null;
}

/* ─── #423 · Lo que hace falta para decidir, y el registro de cambios ─── */

/**
 * Todo lo que decide qué puede una persona, de una vez: su fila, su rol a
 * medida, sus excepciones y lo cambiado en Roles para sus roles.
 * `db` es `query` o un cliente de transacción (para leer lo recién escrito).
 */
export async function datosDePermisos(userId, db = { query }) {
  const { rows: [u] } = await db.query(
    `SELECT id, nombre, email, role::text AS role, COALESCE(roles_extra::text[], '{}') AS roles_extra,
            custom_role_id, active
       FROM users WHERE id = $1`, [userId]);
  if (!u) return null;
  const [cr, exc, aj] = await Promise.all([
    u.custom_role_id
      ? db.query('SELECT id, label, description, base_role, permissions, active FROM custom_roles WHERE id = $1', [u.custom_role_id])
      : { rows: [] },
    db.query('SELECT resource, action, allowed FROM user_permission_overrides WHERE user_id = $1', [userId]),
    ajustesDeRoles(db),
  ]);
  const excepciones = {};
  for (const e of exc.rows) excepciones[`${e.resource}.${e.action}`] = e.allowed;
  return { usuario: u, customRole: cr.rows[0] || null, excepciones, ajustesRol: aj };
}

/** Todas las filas de la 197 (son pocas). Sin la tabla, ninguna. */
export async function ajustesDeRoles(db = { query }) {
  try {
    const { rows } = await db.query('SELECT role, resource, action, allowed FROM role_permission_overrides');
    return rows;
  } catch (err) {
    if (err.code === '42P01') return [];
    throw err;
  }
}

/**
 * Un apunte en `permisos_registro` (238). Va con el cliente de la transacción
 * del cambio: o se guardan los dos o ninguno.
 */
export async function registrarCambio(db, { quienId = null, destino, usuarioId = null, rol = null, customRoleId = null, clave, antes = null, despues = null, origen, motivo = null }) {
  const texto = (v) => (v === null || v === undefined ? null : String(v));
  await db.query(
    `INSERT INTO permisos_registro (quien_id, destino_tipo, usuario_id, rol, custom_role_id, clave, antes, despues, origen, motivo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [quienId, destino, usuarioId, rol, customRoleId, clave, texto(antes), texto(despues), origen, motivo]);
}

/** Los cambios de permisos, de una persona, de un rol o todos, los últimos primero. */
export async function leerRegistro({ usuarioId = null, rol = null, customRoleId = null, limite = 100 } = {}) {
  const { rows } = await query(
    `SELECT r.id, r.cuando, r.quien_id, q.nombre AS quien_nombre, r.destino_tipo, r.usuario_id,
            u.nombre AS usuario_nombre, r.rol, r.custom_role_id, cr.label AS custom_role_nombre,
            r.clave, r.antes, r.despues, r.origen, r.motivo
       FROM permisos_registro r
       LEFT JOIN users q ON q.id = r.quien_id
       LEFT JOIN users u ON u.id = r.usuario_id
       LEFT JOIN custom_roles cr ON cr.id = r.custom_role_id
      WHERE ($1::int IS NULL OR r.usuario_id = $1)
        AND ($2::text IS NULL OR r.rol = $2)
        AND ($3::int IS NULL OR r.custom_role_id = $3)
      ORDER BY r.cuando DESC, r.id DESC
      LIMIT $4`,
    [usuarioId, rol, customRoleId, limite]);
  return rows;
}

/** ¿Comparten algún campus activo? (lo mismo que #245 y #384) */
export async function compartenCampus(a, b, db = { query }) {
  const { rows } = await db.query(
    `SELECT 1 FROM user_projects mio
       JOIN user_projects suyo ON suyo.project_id = mio.project_id AND suyo.active
      WHERE mio.user_id = $1 AND mio.active AND suyo.user_id = $2 LIMIT 1`, [a, b]);
  return rows.length > 0;
}
