import { query, getClient } from '../../shared/config/db.js';
// Los mismos roles con tablero que tasks.model.js (ROLES_TAREAS); aquí copiados para no importarse en círculo.
const ROLES_TAREAS = ['superadmin', 'admin', 'colaborador', 'tutor_redactor'];

/*
  Equipos de tutores (migración «equipos_de_tutores»; Diego, 04/11/2026): «un tablero
  de tutores separado del de colaboradores». Un equipo es de tipo
  'colaboradores' (los de siempre: desarrollo, SEO…) o 'tutores'. A uno de
  tutores se puede meter a tutores; a uno de colaboradores, solo a gente con
  tablero, como hasta hoy.

  Un tutor tiene tablero SOLO mientras esté en un equipo de tutores activo: así
  no sale en la lista de responsables ni en las cifras de nadie por ser tutor.
*/
export const TIPOS_DE_EQUIPO = ['colaboradores', 'tutores'];

let hayTipos = false;
export async function existeTipos() {
  if (hayTipos) return true;
  const { rows } = await query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'task_teams' AND column_name = 'tipo') AS hay`);
  hayTipos = rows[0]?.hay === true;
  return hayTipos;
}
/** Solo para las pruebas. */
export function olvidarTipos() { hayTipos = false; }

const ES_TUTOR = (u) => `(${u}.role::text = 'tutor' OR 'tutor' = ANY(COALESCE(${u}.roles_extra, '{}')::text[]))`;

/**
 * ¿Tiene tablero? (SQL). `u` es el alias de users e `idx` el número del
 * parámetro con ROLES_TAREAS. Con la migración de tipos, también el tutor que
 * está en un equipo de tutores activo.
 */
export function sqlConTablero(u, idx, tipos) {
  const base = `(${u}.role::text = ANY($${idx}::text[]) OR ${u}.roles_extra::text[] && $${idx}::text[])`;
  if (!tipos) return base;
  return `(${base} OR (${ES_TUTOR(u)}
      AND EXISTS (SELECT 1 FROM task_team_members m_tut JOIN task_teams t_tut ON t_tut.id = m_tut.team_id
                   WHERE m_tut.user_id = ${u}.id AND t_tut.is_active AND t_tut.tipo = 'tutores')))`;
}

/** El tipo de un equipo en SQL: sin la migración, todos son de colaboradores. */
const colTipo = (t, tipos) => (tipos ? `${t}.tipo` : `'colaboradores'::text`);

/*
  `task_teams.de_programacion` (migración 276, CRM-ISEIE#419) YA NO SE USA (Diego,
  11/11/2026). Decía qué equipos cerraba el supervisor, pero «Desarrollo y SEO»
  es un solo equipo y la gente de SEO tampoco podía cerrar. Ahora lo decide la
  tarea: si tiene supervisor, la cierra él (`tasks.reglas.js`, `puedeCerrar`).
  La columna se queda en la base (ya está aplicada) y aquí no se lee ni se
  escribe: no la vuelvas a usar.
*/

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

const camposEquipo = (tipos) => `
  tm.id, tm.issuer_id, ii.razon_social AS empresa, tm.name, ${colTipo('tm', tipos)} AS tipo, tm.color, tm.is_active, tm.sort_order,
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
  const tipos = await existeTipos();
  const { rows } = await query(
    `SELECT ${camposEquipo(tipos)}
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
  const tipos = await existeTipos();
  const { rows } = await query(
    `SELECT ${camposEquipo(tipos)} FROM task_teams tm JOIN invoice_issuers ii ON ii.id = tm.issuer_id WHERE tm.id = $1`, [id]);
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
  const tipos = await existeTipos();
  const { rows } = await query(
    `SELECT tm.id AS team_id, tm.name AS team_name, tm.color AS team_color, ${colTipo('tm', tipos)} AS team_tipo,
            tm.issuer_id, ii.razon_social AS empresa,
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

/**
 * Los equipos de varias personas a la vez (para la lista de responsables: la
 * ficha enseña el equipo de quien la va a llevar). Un Map id → [{ team_id, … }].
 */
export async function equiposDeLaGente(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(Number))];
  const out = new Map();
  if (!ids.length || !(await existeEquipos())) return out;
  const tipos = await existeTipos();
  const { rows } = await query(
    `SELECT m.user_id, tm.id AS team_id, tm.name AS team_name, ${colTipo('tm', tipos)} AS team_tipo,
            tm.issuer_id, ii.razon_social AS empresa,
            r.name AS cargo, r.level::float8 AS nivel
       FROM task_team_members m
       JOIN task_teams tm ON tm.id = m.team_id AND tm.is_active
       JOIN invoice_issuers ii ON ii.id = tm.issuer_id
       JOIN task_team_roles r ON r.id = m.team_role_id
      WHERE m.user_id = ANY($1::int[])
      ORDER BY ii.razon_social, tm.sort_order, tm.name`,
    [ids]
  );
  for (const { user_id: uid, ...e } of rows) {
    const k = Number(uid);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push({ ...e, team_id: Number(e.team_id), issuer_id: Number(e.issuer_id), nivel: n(e.nivel) });
  }
  return out;
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

export async function crearEquipo({ issuer_id, name, color = 'gray', sort_order = 0, created_by, tipo = 'colaboradores' }) {
  const tipos = await existeTipos();
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const { rows: [t] } = tipos
      ? await db.query(
        `INSERT INTO task_teams (issuer_id, name, color, sort_order, created_by, tipo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [issuer_id, name, color, sort_order, created_by, tipo])
      : await db.query(
        `INSERT INTO task_teams (issuer_id, name, color, sort_order, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [issuer_id, name, color, sort_order, created_by]);
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
 * Quién se puede meter en un equipo: gente activa de la empresa del equipo (un
 * campus suyo o la empresa entera en `user_empresas`) que tenga tablero. En un
 * equipo de tutores, también los tutores (04/11/2026), que pueden ser de la
 * empresa por `tutor_empresas`.
 */
export async function candidatosDe(teamId) {
  const tipos = await existeTipos();
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.role::text AS role
       FROM users u, task_teams tm
      WHERE tm.id = $1 AND u.active
        AND ((u.role::text = ANY($2::text[]) OR u.roles_extra::text[] && $2::text[])
             OR (${colTipo('tm', tipos)} = 'tutores' AND ${ES_TUTOR('u')}))
        AND ${deLaEmpresaDelEquipo('u.id', 'tm')}
        AND NOT EXISTS (SELECT 1 FROM task_team_members m WHERE m.team_id = tm.id AND m.user_id = u.id)
      ORDER BY u.nombre`,
    [teamId, ROLES_TAREAS]
  );
  return rows;
}

/** SQL: la persona `col` es de la empresa del equipo `tm` (un campus, la empresa entera o, si es tutor, sus empresas). */
function deLaEmpresaDelEquipo(col, tm) {
  return `(EXISTS (SELECT 1 FROM user_empresas ue WHERE ue.user_id = ${col} AND ue.issuer_id = ${tm}.issuer_id)
       OR EXISTS (SELECT 1 FROM user_projects up JOIN projects p ON p.id = up.project_id
                   WHERE up.user_id = ${col} AND up.active AND p.sociedad_emisora_id = ${tm}.issuer_id)
       OR EXISTS (SELECT 1 FROM tutor_empresas te WHERE te.tutor_id = ${col} AND te.issuer_id = ${tm}.issuer_id))`;
}

/** ¿Es esta persona de la empresa del equipo? (para meterla). */
export async function esDeLaEmpresa(teamId, userId) {
  const { rows } = await query(
    `SELECT 1 FROM task_teams tm WHERE tm.id = $1 AND ${deLaEmpresaDelEquipo('$2::int', 'tm')}`,
    [teamId, userId]
  );
  return rows.length > 0;
}

/**
 * ¿Puede estar en este equipo? Con tablero (superadmin, admin, colaborador), en
 * cualquiera; un tutor, solo en uno de tutores (04/11/2026).
 */
export async function puedeEstarEn(teamId, userId) {
  const tipos = await existeTipos();
  const { rows: [r] } = await query(
    `SELECT u.active,
            (u.role::text = ANY($3::text[]) OR u.roles_extra::text[] && $3::text[]) AS con_tablero,
            ${ES_TUTOR('u')} AS es_tutor,
            ${colTipo('tm', tipos)} AS tipo
       FROM users u, task_teams tm WHERE u.id = $2 AND tm.id = $1`,
    [teamId, userId, ROLES_TAREAS]
  );
  if (!r || !r.active) return { existe: false, puede: false, tipo: null };
  return { existe: true, puede: r.con_tablero || (r.tipo === 'tutores' && r.es_tutor), tipo: r.tipo };
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
