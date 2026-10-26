import { query, getClient } from '../../shared/config/db.js';
// Los mismos roles con tablero que tasks.model.js (ROLES_TAREAS); aquí copiados para no importarse en círculo.
const ROLES_TAREAS = ['superadmin', 'admin', 'colaborador'];

/*
  Equipos del tablero, con cargos por nivel (migración 235; Diego, 26/10/2026).

  Aquí solo SQL. Quién puede qué lo decide `tasks.reglas.js` y el servicio.
  Hasta que se pase la migración, el tablero sigue sin equipos: `existeEquipos`
  lo mira una vez y se recuerda solo el «sí».
*/

let hayEquipos = false;
export async function existeEquipos() {
  if (hayEquipos) return true;
  const { rows } = await query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'tasks' AND column_name = 'team_id') AS hay`);
  hayEquipos = rows[0]?.hay === true;
  return hayEquipos;
}
/** Solo para las pruebas. */
export function olvidarEquipos() { hayEquipos = false; }

/** Los cargos de serie de un equipo nuevo (Diego: «Encargado», nivel 2; «Miembro», nivel 1). */
export const CARGOS_DE_SERIE = [
  { name: 'Encargado', level: 2, sort_order: 1 },
  { name: 'Miembro', level: 1, sort_order: 2 },
];

const n = (v) => (v == null ? null : Number(v));

const CAMPOS_EQUIPO = `
  tm.id, tm.issuer_id, ii.razon_social AS empresa, tm.name, tm.color, tm.is_active, tm.sort_order,
  tm.created_at, tm.updated_at,
  (SELECT COUNT(*)::int FROM task_team_members m WHERE m.team_id = tm.id) AS miembros,
  COALESCE((SELECT json_agg(json_build_object('id', r.id, 'name', r.name, 'level', r.level::float8,
                                              'sort_order', r.sort_order, 'is_active', r.is_active)
                            ORDER BY r.level DESC, r.sort_order, r.id)
              FROM task_team_roles r WHERE r.team_id = tm.id), '[]'::json) AS cargos`;

/**
 * Los equipos de unas empresas (`issuerIds`; `null` = todas). Con `soloDe`, solo
 * los equipos en los que está esa persona.
 */
export async function listarEquipos({ issuerIds = null, soloDe = null, incluirArchivados = false } = {}) {
  const { rows } = await query(
    `SELECT ${CAMPOS_EQUIPO}
       FROM task_teams tm
       JOIN invoice_issuers ii ON ii.id = tm.issuer_id
      WHERE ($1::int[] IS NULL OR tm.issuer_id = ANY($1::int[]))
        AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM task_team_members m WHERE m.team_id = tm.id AND m.user_id = $2))
        AND ($3 OR tm.is_active)
      ORDER BY ii.razon_social, tm.sort_order, tm.name`,
    [issuerIds, soloDe, incluirArchivados]
  );
  return rows;
}

export async function equipoPorId(id) {
  const { rows } = await query(
    `SELECT ${CAMPOS_EQUIPO} FROM task_teams tm JOIN invoice_issuers ii ON ii.id = tm.issuer_id WHERE tm.id = $1`, [id]);
  return rows[0] || null;
}

export async function miembrosDe(teamId) {
  const { rows } = await query(
    `SELECT m.user_id AS id, u.nombre, u.email, u.role::text AS role, u.active,
            m.team_role_id, r.name AS cargo, r.level::float8 AS nivel
       FROM task_team_members m
       JOIN users u ON u.id = m.user_id
       JOIN task_team_roles r ON r.id = m.team_role_id
      WHERE m.team_id = $1
      ORDER BY r.level DESC, u.nombre`,
    [teamId]
  );
  return rows;
}

/** Los equipos y cargos de una persona, con los niveles extremos de cada equipo. */
export async function equiposDeLaPersona(userId) {
  if (!(await existeEquipos())) return [];
  const { rows } = await query(
    `SELECT tm.id AS team_id, tm.name AS team_name, tm.color AS team_color, tm.issuer_id, ii.razon_social AS empresa,
            r.id AS team_role_id, r.name AS cargo, r.level::float8 AS nivel,
            (SELECT MIN(r2.level)::float8 FROM task_team_members m2 JOIN task_team_roles r2 ON r2.id = m2.team_role_id
              WHERE m2.team_id = tm.id) AS nivel_min_miembros,
            (SELECT MIN(r3.level)::float8 FROM task_team_roles r3 WHERE r3.team_id = tm.id AND r3.is_active) AS nivel_min_cargos
       FROM task_team_members m
       JOIN task_teams tm ON tm.id = m.team_id AND tm.is_active
       JOIN invoice_issuers ii ON ii.id = tm.issuer_id
       JOIN task_team_roles r ON r.id = m.team_role_id
      WHERE m.user_id = $1
      ORDER BY ii.razon_social, tm.sort_order, tm.name`,
    [userId]
  );
  return rows;
}

/** El nivel de cada una de estas personas en el equipo (las que no están, no salen). */
export async function nivelesEn(teamId, userIds) {
  const ids = [...new Set(userIds.filter(Boolean).map(Number))];
  if (!teamId || !ids.length) return new Map();
  const { rows } = await query(
    `SELECT m.user_id, r.level::float8 AS nivel, r.name AS cargo
       FROM task_team_members m JOIN task_team_roles r ON r.id = m.team_role_id
      WHERE m.team_id = $1 AND m.user_id = ANY($2::int[])`,
    [teamId, ids]
  );
  return new Map(rows.map((r) => [Number(r.user_id), { nivel: n(r.nivel), cargo: r.cargo }]));
}

export async function crearEquipo({ issuer_id, name, color = 'gray', sort_order = 0, created_by }) {
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const { rows: [t] } = await db.query(
      `INSERT INTO task_teams (issuer_id, name, color, sort_order, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [issuer_id, name, color, sort_order, created_by]
    );
    for (const c of CARGOS_DE_SERIE) {
      await db.query('INSERT INTO task_team_roles (team_id, name, level, sort_order) VALUES ($1, $2, $3, $4)',
        [t.id, c.name, c.level, c.sort_order]);
    }
    await db.query('COMMIT');
    return equipoPorId(t.id);
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }
}

export async function actualizarEquipo(id, campos) {
  const permitidos = ['name', 'color', 'is_active', 'sort_order'];
  const sets = []; const params = [];
  for (const k of permitidos) {
    if (campos[k] !== undefined) { params.push(campos[k]); sets.push(`${k} = $${params.length}`); }
  }
  if (!sets.length) return equipoPorId(id);
  params.push(id);
  await query(`UPDATE task_teams SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params);
  return equipoPorId(id);
}

export async function cargoPorId(teamId, roleId) {
  const { rows } = await query('SELECT id, team_id, name, level::float8 AS level, sort_order, is_active FROM task_team_roles WHERE id = $1 AND team_id = $2', [roleId, teamId]);
  return rows[0] || null;
}

export async function crearCargo(teamId, { name, level, sort_order = 0 }) {
  const { rows: [r] } = await query(
    'INSERT INTO task_team_roles (team_id, name, level, sort_order) VALUES ($1, $2, $3, $4) RETURNING id', [teamId, name, level, sort_order]);
  return cargoPorId(teamId, r.id);
}

export async function actualizarCargo(teamId, roleId, campos) {
  const permitidos = ['name', 'level', 'sort_order', 'is_active'];
  const sets = []; const params = [];
  for (const k of permitidos) {
    if (campos[k] !== undefined) { params.push(campos[k]); sets.push(`${k} = $${params.length}`); }
  }
  if (sets.length) {
    params.push(roleId, teamId);
    await query(`UPDATE task_team_roles SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length - 1} AND team_id = $${params.length}`, params);
  }
  return cargoPorId(teamId, roleId);
}

export async function miembrosConCargo(roleId) {
  const { rows: [r] } = await query('SELECT COUNT(*)::int AS n FROM task_team_members WHERE team_role_id = $1', [roleId]);
  return r.n;
}

export async function ponerMiembro(teamId, userId, roleId, addedBy) {
  await query(
    `INSERT INTO task_team_members (team_id, user_id, team_role_id, added_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (team_id, user_id) DO UPDATE SET team_role_id = EXCLUDED.team_role_id`,
    [teamId, userId, roleId, addedBy]
  );
}

export async function quitarMiembro(teamId, userId) {
  const { rowCount } = await query('DELETE FROM task_team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
  return rowCount > 0;
}

/**
 * Quién se puede meter en un equipo: gente activa con tablero que sea de la
 * empresa del equipo (un campus suyo o la empresa entera en `user_empresas`).
 */
export async function candidatosDe(teamId) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.role::text AS role
       FROM users u, task_teams tm
      WHERE tm.id = $1 AND u.active
        AND (u.role::text = ANY($2::text[]) OR u.roles_extra::text[] && $2::text[])
        AND (EXISTS (SELECT 1 FROM user_empresas ue WHERE ue.user_id = u.id AND ue.issuer_id = tm.issuer_id)
             OR EXISTS (SELECT 1 FROM user_projects up JOIN projects p ON p.id = up.project_id
                         WHERE up.user_id = u.id AND up.active AND p.sociedad_emisora_id = tm.issuer_id))
        AND NOT EXISTS (SELECT 1 FROM task_team_members m WHERE m.team_id = tm.id AND m.user_id = u.id)
      ORDER BY u.nombre`,
    [teamId, ROLES_TAREAS]
  );
  return rows;
}

/** ¿Es esta persona de la empresa del equipo? (para meterla). */
export async function esDeLaEmpresa(teamId, userId) {
  const { rows } = await query(
    `SELECT 1 FROM task_teams tm WHERE tm.id = $1 AND (
       EXISTS (SELECT 1 FROM user_empresas ue WHERE ue.user_id = $2 AND ue.issuer_id = tm.issuer_id)
       OR EXISTS (SELECT 1 FROM user_projects up JOIN projects p ON p.id = up.project_id
                   WHERE up.user_id = $2 AND up.active AND p.sociedad_emisora_id = tm.issuer_id))`,
    [teamId, userId]
  );
  return rows.length > 0;
}

/** Las empresas de unos campus (para decir qué equipos ve quien mira). */
export async function empresasDeLosCampus(projectIds) {
  if (!projectIds?.length) return [];
  const { rows } = await query(
    'SELECT DISTINCT sociedad_emisora_id AS id FROM projects WHERE id = ANY($1::int[]) AND sociedad_emisora_id IS NOT NULL ORDER BY 1',
    [projectIds]
  );
  return rows.map((r) => Number(r.id));
}
