import { query, getClient } from '../../shared/config/db.js';
import { existeEquipos } from './tasks.equipos.model.js';

// Quien tiene tablero de tareas: el equipo de desarrollo (Diego, 09/10: «las
// tareas son del equipo de desarrollo, las gestoras no tienen tareas»). Ni
// gestoras, ni soporte, ni project manager, ni tutores (un tutor que trabaje en
// el equipo entra con el rol colaborador).
export const ROLES_TAREAS = ['superadmin', 'admin', 'colaborador'];

const CON_TABLERO = `(u.role::text = ANY($ROLES::text[]) OR u.roles_extra::text[] && $ROLES::text[])`;
const conTablero = (n) => CON_TABLERO.replaceAll('$ROLES', `$${n}`);

/**
 * La gente del ámbito (#245, decisiones de Diego del 08/10).
 *
 * El ámbito es una lista de campus, pero se llega a él POR EMPRESA (Diego,
 * 26/10/2026: «las tareas van por empresa, no por proyecto»): `ambitoDe`
 * (servicio) mete en la lista todos los campus de las empresas de quien mira.
 *
 * Una persona entra si:
 *   · tiene algún campus activo dentro del ámbito;
 *   · o es de una empresa del ámbito (`user_empresas`) aunque no tenga ningún
 *     campus: el equipo de desarrollo es de la empresa, no de un campus;
 *   · NO tiene ni campus ni empresa: colaboradores del grupo, que los ve todo el equipo;
 *   · o es quien está mirando.
 *
 * `col` es la columna con el id de la persona; `idxIds` y `idxYo`, los números
 * de parámetro del ámbito (int[]) y de quien mira. Una tarea sin responsable no
 * tiene campus, así que la ve todo el equipo, como un colaborador.
 */
export function genteDelAmbito(col, idxIds, idxYo) {
  return `(${col} = $${idxYo}
    OR EXISTS (SELECT 1 FROM user_projects up_a
                WHERE up_a.user_id = ${col} AND up_a.active AND up_a.project_id = ANY($${idxIds}::int[]))
    OR ${deEmpresaDelAmbito(col, idxIds)}
    OR (NOT EXISTS (SELECT 1 FROM user_projects up_s WHERE up_s.user_id = ${col} AND up_s.active)
        AND NOT EXISTS (SELECT 1 FROM user_empresas ue_s WHERE ue_s.user_id = ${col})))`;
}

/** Es de una empresa (`user_empresas`) que tiene algún campus en el ámbito. */
function deEmpresaDelAmbito(col, idxIds) {
  return `EXISTS (SELECT 1 FROM user_empresas ue_a
                     JOIN projects pe_a ON pe_a.sociedad_emisora_id = ue_a.issuer_id
                    WHERE ue_a.user_id = ${col} AND pe_a.id = ANY($${idxIds}::int[]))`;
}

/**
 * Los campus de las empresas de una persona: las de sus campus y las que tiene
 * enteras (`user_empresas`), más sus campus sin empresa. Es «su empresa» para
 * el tablero (Diego, 26/10/2026).
 */
export async function campusDeSusEmpresas(userId) {
  const { rows } = await query(
    `WITH empresas AS (
       SELECT p.sociedad_emisora_id AS id FROM user_projects up JOIN projects p ON p.id = up.project_id
        WHERE up.user_id = $1 AND up.active AND p.sociedad_emisora_id IS NOT NULL
       UNION
       SELECT issuer_id FROM user_empresas WHERE user_id = $1)
     SELECT p.id FROM projects p WHERE p.sociedad_emisora_id IN (SELECT id FROM empresas)
     UNION
     SELECT up.project_id FROM user_projects up WHERE up.user_id = $1 AND up.active
     ORDER BY 1`,
    [userId]
  );
  return rows.map((r) => Number(r.id));
}

/** Los campus de una empresa (para el selector de la cabecera). */
export async function campusDeLaEmpresa(issuerId) {
  const { rows } = await query('SELECT id FROM projects WHERE sociedad_emisora_id = $1 ORDER BY id', [issuerId]);
  return rows.map((r) => Number(r.id));
}

/** La empresa de un campus, o null si no tiene. */
export async function empresaDelCampus(projectId) {
  const { rows } = await query('SELECT sociedad_emisora_id AS id FROM projects WHERE id = $1', [projectId]);
  return rows[0]?.id == null ? null : Number(rows[0].id);
}

/*
 * El supervisor (migración 234). Hasta que se pase, el tablero sigue sin él: la
 * columna se pide solo si existe. Se recuerda solo el «sí».
 */
let haySupervisor = false;
export async function existeSupervisor() {
  if (haySupervisor) return true;
  const { rows } = await query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'tasks' AND column_name = 'supervisor_id') AS hay`);
  haySupervisor = rows[0]?.hay === true;
  return haySupervisor;
}
/** Solo para las pruebas. */
export function olvidarSupervisor() { haySupervisor = false; }

const columnasSupervisor = (hay) => (hay
  ? `t.supervisor_id,
  u_sup.nombre AS supervisor_name,`
  : `NULL::int AS supervisor_id,
  NULL::text AS supervisor_name,`);
const joinSupervisor = (hay) => (hay ? '\n  LEFT JOIN users u_sup ON u_sup.id = t.supervisor_id' : '');

// El equipo de la tarea y el cargo de quien la lleva en él (migración 235).
const columnasEquipo = (eq) => (eq
  ? `t.team_id,
  tm_t.name AS team_name,
  tm_t.color AS team_color,
  (SELECT r_c.name FROM task_team_members m_c JOIN task_team_roles r_c ON r_c.id = m_c.team_role_id
    WHERE m_c.team_id = t.team_id AND m_c.user_id = t.assigned_to) AS assigned_cargo,`
  : `NULL::int AS team_id,
  NULL::text AS team_name,
  NULL::text AS team_color,
  NULL::text AS assigned_cargo,`);
const joinEquipo = (eq) => (eq ? '\n  LEFT JOIN task_teams tm_t ON tm_t.id = t.team_id' : '');

/** Lo que hay en la base: supervisor y equipos (cada uno con su migración). */
async function extras() {
  const [sup, eq] = await Promise.all([existeSupervisor(), existeEquipos()]);
  return { sup, eq };
}

// Las columnas de una tarjeta. `position` es NUMERIC y pg lo devolveria como
// texto: se pasa a numero para que el tablero pueda calcular puntos medios.
const columnas = (hay, eq = false) => `
  ${columnasSupervisor(hay)}
  ${columnasEquipo(eq)}
  t.id,
  t.title,
  t.description,
  t.status,
  t.position::float8 AS position,
  t.priority,
  t.due_date,
  t.project_id,
  p.nombre AS project_name,
  t.external_project_id,
  ep.name AS external_project_name,
  ep.color AS external_project_color,
  t.area_id,
  ar.name AS area_name,
  ar.color AS area_color,
  t.assigned_to,
  u_assign.nombre AS assigned_to_name,
  u_assign.email AS assigned_to_email,
  t.created_by,
  u_create.nombre AS created_by_name,
  t.completed_at,
  t.archived_at,
  t.created_at,
  t.updated_at`;

const joins = (hay, eq = false) => `
  FROM tasks t
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN task_external_projects ep ON ep.id = t.external_project_id
  LEFT JOIN task_areas ar ON ar.id = t.area_id
  LEFT JOIN users u_assign ON u_assign.id = t.assigned_to
  LEFT JOIN users u_create ON u_create.id = t.created_by${joinSupervisor(hay)}${joinEquipo(eq)}`;

export async function findTasks({
  assigned_to, project_id, external_project_id, area_id, status, priority, search, tag, vencidas, desde, hasta,
  periodo_desde, periodo_hasta, incluir_archivadas = false, orden = 'tablero', ambito = null, yo = null, supervisor_id = null, tambien_supervisa = null,
  team_id, visibles_para = null, mias_de = null, de_la_cabecera = null,
}) {
  const { sup: hay, eq } = await extras();
  const conditions = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    conditions.push(sql.replaceAll('$?', `$${params.length}`));
  };

  if (!incluir_archivadas) conditions.push('t.archived_at IS NULL');
  if (assigned_to != null) add('t.assigned_to = $?', assigned_to);
  // La empresa (o el campus) de arriba: solo las tareas DE esa empresa (Diego,
  // 30/10: «en el tablero se están ligando tareas entre empresas»). El ámbito de
  // abajo mira a la PERSONA, y quien está en CEDIA y en ICTESS traía las de las dos.
  // La empresa de una tarea es la de su equipo; sin equipo, la de su campus; sin
  // ninguno de los dos, no se puede saber y se deja ver.
  if (de_la_cabecera) {
    params.push(de_la_cabecera);
    const ids = `$${params.length}::int[]`;
    conditions.push(`(CASE
      ${eq ? `WHEN t.team_id IS NOT NULL THEN EXISTS (SELECT 1 FROM task_teams tt_c
                 JOIN projects pc ON pc.sociedad_emisora_id = tt_c.issuer_id
                WHERE tt_c.id = t.team_id AND pc.id = ANY(${ids}))` : ''}
      WHEN t.project_id IS NOT NULL THEN t.project_id = ANY(${ids})
      ELSE TRUE END)`);
  }
  // `null` es «todo el CRM» (superadmin y soporte): no se acota.
  if (ambito) {
    params.push(ambito, yo);
    const enAmbito = genteDelAmbito('t.assigned_to', params.length - 1, params.length);
    // «Por revisar» del supervisor: lo de su ámbito y, además, lo que supervisa.
    if (tambien_supervisa && hay) {
      params.push(tambien_supervisa);
      conditions.push(`(${enAmbito} OR t.supervisor_id = $${params.length})`);
    } else conditions.push(enAmbito);
  }
  // Las que supervisa una persona (sin la migración 234, ninguna).
  if (supervisor_id != null) {
    if (hay) add('t.supervisor_id = $?', supervisor_id);
    else conditions.push('FALSE');
  }
  // Sin «Ver todo» (26/10/2026): las suyas —las lleva, las creó o las supervisa—
  // y las de sus equipos, que se ven aunque no se puedan mover.
  if (visibles_para) {
    params.push(visibles_para);
    const yoN = `$${params.length}`;
    conditions.push(`(t.assigned_to = ${yoN} OR t.created_by = ${yoN}${hay ? ` OR t.supervisor_id = ${yoN}` : ''}${eq
      ? ` OR EXISTS (SELECT 1 FROM task_team_members m_v WHERE m_v.team_id = t.team_id AND m_v.user_id = ${yoN})` : ''})`);
  }
  // «Mi tablero» (Diego, 26/10/2026): lo que lleva, lo que supervisa y lo que creó.
  if (mias_de) {
    params.push(mias_de);
    const yoM = `$${params.length}`;
    conditions.push(`(t.assigned_to = ${yoM} OR t.created_by = ${yoM}${hay ? ` OR t.supervisor_id = ${yoM}` : ''})`);
  }
  // El equipo elegido arriba: uno, o 0 = «Sin equipo».
  if (team_id != null && eq) {
    if (Number(team_id) === 0) conditions.push('t.team_id IS NULL');
    else add('t.team_id = $?', team_id);
  }
  if (project_id != null) add('t.project_id = $?', project_id);
  if (external_project_id != null) add('t.external_project_id = $?', external_project_id);
  if (area_id != null) add('t.area_id = $?', area_id);
  if (status) add('t.status = $?', status);
  if (priority) add('t.priority = $?', priority);
  if (search) add('(t.title ILIKE $? OR t.description ILIKE $?)', `%${search}%`);
  if (tag) add('EXISTS (SELECT 1 FROM task_tags tg WHERE tg.task_id = t.id AND LOWER(tg.name) = LOWER($?))', tag);
  if (vencidas) conditions.push(`t.due_date < NOW() AND t.status <> 'hecha'`);
  // El rango es de dias enteros DE LA OFICINA (APP_TIMEZONE), como el
  // comentario automático y el correo: «hasta el 31» incluye todo el 31 en
  // Madrid, no en la hora de la base (UTC).
  const zona = process.env.APP_TIMEZONE || 'Europe/Madrid';
  if (desde) {
    params.push(desde, zona);
    conditions.push(`t.due_date >= ($${params.length - 1}::date::timestamp AT TIME ZONE $${params.length})`);
  }
  if (hasta) {
    params.push(hasta, zona);
    conditions.push(`t.due_date < (($${params.length - 1}::date + 1)::timestamp AT TIME ZONE $${params.length})`);
  }
  // El periodo (Diego, 27/10/2026: «vistas por día, semana y mes»). Entra la
  // tarea que se creó, se terminó o vence dentro, y la que sigue abierta y se
  // creó antes de que acabe (lo que está en marcha ese día, esa semana o ese mes).
  if (periodo_desde && periodo_hasta) {
    params.push(periodo_desde, periodo_hasta, zona);
    const n = params.length;
    const ini = `($${n - 2}::date::timestamp AT TIME ZONE $${n})`;
    const fin = `(($${n - 1}::date + 1)::timestamp AT TIME ZONE $${n})`;
    const dentro = (col) => `(${col} >= ${ini} AND ${col} < ${fin})`;
    conditions.push(`(${dentro('t.created_at')} OR ${dentro('t.completed_at')} OR ${dentro('t.due_date')}
      OR (t.status <> 'hecha' AND t.created_at < ${fin}))`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT ${columnas(hay, eq)},
      (SELECT COUNT(*)::int FROM task_checklist_items ci WHERE ci.task_id = t.id) AS checklist_total,
      (SELECT COUNT(*)::int FROM task_checklist_items ci WHERE ci.task_id = t.id AND ci.is_completed) AS checklist_completed,
      (SELECT COUNT(*)::int FROM task_comments cm WHERE cm.task_id = t.id) AS comments_count,
      (SELECT COUNT(*)::int FROM task_links lk WHERE lk.task_id = t.id) AS links_count,
      (SELECT cm.content FROM task_comments cm WHERE cm.task_id = t.id ORDER BY cm.created_at DESC, cm.id DESC LIMIT 1) AS last_comment,
      COALESCE((
        SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name, 'color', tg.color) ORDER BY tg.id)
        FROM task_tags tg WHERE tg.task_id = t.id
      ), '[]'::json) AS tags
    ${joins(hay, eq)}
    ${whereClause}
    ORDER BY ${orden === 'vencimiento'
    ? 't.due_date ASC NULLS LAST, t.updated_at ASC'
    : 't.position ASC, t.created_at DESC'}
  `;

  const { rows } = await query(sql, params);
  return rows;
}

/** Cuántas tareas esperan revisión: el número del selector y del menú. */
export async function countReview(ambito = null, yo = null, { tambienSupervisa = false } = {}) {
  const hay = await existeSupervisor();
  const params = [];
  let filtro = '';
  if (ambito) {
    params.push(ambito, yo);
    filtro = `AND (${genteDelAmbito('t.assigned_to', 1, 2)}${tambienSupervisa && hay ? ' OR t.supervisor_id = $2' : ''})`;
  }
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total FROM tasks t
      WHERE t.status = 'en_revision' AND t.archived_at IS NULL ${filtro}`,
    params
  );
  return rows[0].total;
}

/** Si una persona está en el ámbito de quien mira (ver `genteDelAmbito`). */
export async function personaEnAmbito(personaId, ambito, yo) {
  if (!ambito) return true;
  const { rows } = await query(
    `SELECT ${genteDelAmbito('$3::int', 1, 2)} AS dentro`,
    [ambito, yo, personaId]
  );
  return rows[0].dentro === true;
}

export async function findTaskById(id) {
  const { sup: hay, eq } = await extras();
  // Quién la terminó (27/10/2026): quien la pasó a «Hecha» por última vez
  // —arrastrándola o aprobándola—, del historial. Si nació ya hecha, quien la creó.
  const { rows } = await query(
    `SELECT ${columnas(hay, eq)},
       (SELECT cm.content FROM task_comments cm WHERE cm.task_id = t.id ORDER BY cm.created_at DESC, cm.id DESC LIMIT 1) AS last_comment,
       CASE WHEN t.status = 'hecha' THEN COALESCE(cierre.user_id, t.created_by) END AS completed_by,
       CASE WHEN t.status = 'hecha' THEN COALESCE(u_cierre.nombre, u_create.nombre) END AS completed_by_name
     ${joins(hay, eq)}
     LEFT JOIN LATERAL (
       SELECT te.user_id FROM task_events te
        WHERE te.task_id = t.id AND te.event_type = 'status_changed' AND te.details->>'new_status' = 'hecha'
        ORDER BY te.created_at DESC, te.id DESC LIMIT 1) cierre ON t.status = 'hecha'
     LEFT JOIN users u_cierre ON u_cierre.id = cierre.user_id
     WHERE t.id = $1`,
    [id]
  );
  return rows[0] || null;
}

/** La posicion actual de una tarjeta, solo si sigue viva. */
export async function findPosition(id) {
  const { rows } = await query(
    `SELECT position::float8 AS position, status, assigned_to
       FROM tasks WHERE id = $1 AND archived_at IS NULL`,
    [id]
  );
  return rows[0] || null;
}

export async function getMaxPosition(status, assigned_to = null) {
  const { rows } = await query(
    `SELECT COALESCE(MAX(position), 0)::float8 AS max_pos
       FROM tasks
      WHERE status = $1 AND archived_at IS NULL AND assigned_to IS NOT DISTINCT FROM $2`,
    [status, assigned_to]
  );
  return Number(rows[0]?.max_pos || 0);
}

/**
 * Encuentra de forma exacta las posiciones de las tarjetas anterior y siguiente
 * en la misma columna y para el mismo responsable, evitando saltos indebidos si
 * los IDs del frontal estuviesen desfasados.
 */
export async function findNeighbors(status, assigned_to, { prev_id, next_id, sin = 0 }) {
  let prevPos = null;
  let nextPos = null;

  if (next_id) {
    const nextTask = next_id === sin ? null : await findPosition(next_id);
    if (nextTask && nextTask.status === status && nextTask.assigned_to === assigned_to) {
      nextPos = nextTask.position;
      const { rows } = await query(
        `SELECT position::float8 AS position
           FROM tasks
          WHERE status = $1 AND archived_at IS NULL AND assigned_to IS NOT DISTINCT FROM $2
            AND position < $3 AND id <> $4
          ORDER BY position DESC
          LIMIT 1`,
        [status, assigned_to, nextPos, sin]
      );
      if (rows[0]) {
        prevPos = rows[0].position;
      }
    }
  }

  if (prevPos == null && prev_id) {
    const prevTask = prev_id === sin ? null : await findPosition(prev_id);
    if (prevTask && prevTask.status === status && prevTask.assigned_to === assigned_to) {
      prevPos = prevTask.position;
      if (nextPos == null) {
        const { rows } = await query(
          `SELECT position::float8 AS position
             FROM tasks
            WHERE status = $1 AND archived_at IS NULL AND assigned_to IS NOT DISTINCT FROM $2
              AND position > $3 AND id <> $4
            ORDER BY position ASC
            LIMIT 1`,
          [status, assigned_to, prevPos, sin]
        );
        if (rows[0]) {
          nextPos = rows[0].position;
        }
      }
    }
  }

  return { prevPos, nextPos };
}

/**
 * Vuelve a repartir las posiciones de una columna con huecos de 1.000.
 */
export async function renumberColumn(status, assigned_to) {
  await query(
    `UPDATE tasks t
        SET position = s.rn * 1000
       FROM (
         SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC, created_at DESC) AS rn
           FROM tasks
          WHERE status = $1 AND archived_at IS NULL AND assigned_to IS NOT DISTINCT FROM $2
       ) s
      WHERE t.id = s.id`,
    [status, assigned_to]
  );
}

export async function createTask(data) {
  const {
    title,
    description = null,
    status = 'por_hacer',
    position = null,
    priority = 'media',
    due_date = null,
    project_id = null,
    external_project_id = null,
    area_id = null,
    assigned_to = null,
    created_by,
    completed_at = null,
    supervisor_id = null,
    team_id = null,
  } = data;

  const { rows } = await query(
    `INSERT INTO tasks (
       title, description, status, position, priority,
       due_date, project_id, external_project_id, area_id, assigned_to, created_by, completed_at
     ) VALUES (
       $1, $2, $3::varchar,
       -- Los tipos explícitos hacen falta: $3 y $10 se usan en dos sitios y,
       -- sin ellos, PostgreSQL no sabe qué tipo darles (42P08).
       COALESCE($4::numeric, (SELECT COALESCE(MAX(t2.position), 0) + 1000 FROM tasks t2
                              WHERE t2.status = $3::varchar AND t2.assigned_to IS NOT DISTINCT FROM $10::int
                                AND t2.archived_at IS NULL)),
       $5, $6, $7, $8, $9, $10, $11, $12
     )
     RETURNING id`,
    [title, description, status, position, priority, due_date, project_id, external_project_id, area_id, assigned_to, created_by, completed_at]
  );
  // El supervisor va aparte: sin la migración 234 la columna no existe.
  if (supervisor_id && await existeSupervisor()) {
    await query('UPDATE tasks SET supervisor_id = $2 WHERE id = $1', [rows[0].id, supervisor_id]);
  }
  if (team_id && await existeEquipos()) {
    await query('UPDATE tasks SET team_id = $2 WHERE id = $1', [rows[0].id, team_id]);
  }
  return findTaskById(rows[0].id);
}

export async function updateTask(id, fields) {
  const allowed = ['title', 'description', 'priority', 'due_date', 'project_id', 'external_project_id', 'area_id', 'assigned_to'];
  if (await existeSupervisor()) allowed.push('supervisor_id');
  if (await existeEquipos()) allowed.push('team_id');
  const sets = [];
  const params = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      params.push(fields[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }

  if (sets.length === 0) return findTaskById(id);

  sets.push('updated_at = NOW()');
  params.push(id);

  const { rowCount } = await query(
    `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${params.length} AND archived_at IS NULL`,
    params
  );
  return rowCount ? findTaskById(id) : null;
}

export async function updateTaskPositionAndStatus(id, { status, position, completed_at }) {
  const { rowCount } = await query(
    `UPDATE tasks
        SET status = $1, position = $2, completed_at = $3, updated_at = NOW()
      WHERE id = $4 AND archived_at IS NULL`,
    [status, position, completed_at, id]
  );
  return rowCount ? findTaskById(id) : null;
}

export async function archiveTask(id) {
  const { rowCount } = await query(
    `UPDATE tasks SET archived_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND archived_at IS NULL`,
    [id]
  );
  return rowCount ? findTaskById(id) : null;
}

/**
 * Devolver tarea atómicamente: en una única transacción de Postgres
 * pasa a «en_curso», inserta el comentario obligatorio y registra los eventos.
 */
export async function returnTaskAtomic({ taskId, comment, user }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: taskRows } = await client.query(
      `SELECT * FROM tasks WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
      [taskId]
    );
    const task = taskRows[0];
    if (!task) {
      await client.query('ROLLBACK');
      return null;
    }
    if (task.status !== 'en_revision') {
      await client.query('ROLLBACK');
      return { noEnRevision: true, oldTask: task };
    }

    // Calcular posición al final de «en_curso»
    const { rows: posRows } = await client.query(
      `SELECT COALESCE(MAX(position), 0)::float8 AS max_pos
         FROM tasks
        WHERE status = 'en_curso' AND archived_at IS NULL AND assigned_to IS NOT DISTINCT FROM $1`,
      [task.assigned_to]
    );
    const newPos = Number(posRows[0]?.max_pos || 0) + 1000;

    await client.query(
      `UPDATE tasks
          SET status = 'en_curso', position = $1, completed_at = NULL, updated_at = NOW()
        WHERE id = $2`,
      [newPos, taskId]
    );

    const { rows: commentRows } = await client.query(
      `INSERT INTO task_comments (task_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [taskId, user.userId, comment]
    );

    await client.query(
      `INSERT INTO task_events (task_id, user_id, event_type, details)
       VALUES ($1, $2, 'status_changed', $3)`,
      [
        taskId,
        user.userId,
        JSON.stringify({
          old_status: task.status,
          new_status: 'en_curso',
          motivo: comment,
        }),
      ]
    );

    await client.query(
      `INSERT INTO task_events (task_id, user_id, event_type, details)
       VALUES ($1, $2, 'comment', $3)`,
      [taskId, user.userId, JSON.stringify({ comment_id: commentRows[0].id })]
    );

    await client.query('COMMIT');

    const updatedTask = await findTaskById(taskId);
    return { task: updatedTask, comment: commentRows[0], oldTask: task };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Aprobar: de «En revisión» a «Hecha», con su fecha de cierre y su evento, en
 * una transacción. Si otra persona la movió mientras tanto, no se toca.
 */
export async function approveTaskAtomic({ taskId, user }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: [task] } = await client.query(
      'SELECT * FROM tasks WHERE id = $1 AND archived_at IS NULL FOR UPDATE',
      [taskId]
    );
    if (!task) {
      await client.query('ROLLBACK');
      return null;
    }
    if (task.status !== 'en_revision') {
      await client.query('ROLLBACK');
      return { noEnRevision: true, oldTask: task };
    }
    const { rows: [pos] } = await client.query(
      `SELECT COALESCE(MAX(position), 0)::float8 AS max_pos FROM tasks
        WHERE status = 'hecha' AND archived_at IS NULL AND assigned_to IS NOT DISTINCT FROM $1`,
      [task.assigned_to]
    );
    await client.query(
      `UPDATE tasks SET status = 'hecha', position = $1, completed_at = NOW(), updated_at = NOW()
        WHERE id = $2`,
      [Number(pos.max_pos) + 1000, taskId]
    );
    await client.query(
      `INSERT INTO task_events (task_id, user_id, event_type, details)
       VALUES ($1, $2, 'status_changed', $3)`,
      [taskId, user.userId, JSON.stringify({ old_status: 'en_revision', new_status: 'hecha', action: 'approved' })]
    );
    await client.query('COMMIT');
    return { task: await findTaskById(taskId), oldTask: task };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* --- Historial --- */

export async function createTaskEvent({ task_id, user_id, event_type, details = {} }) {
  const { rows } = await query(
    `INSERT INTO task_events (task_id, user_id, event_type, details)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [task_id, user_id, event_type, JSON.stringify(details)]
  );
  return rows[0];
}

export async function findTaskEvents(task_id) {
  const { rows } = await query(
    `SELECT te.id, te.task_id, te.user_id, u.nombre AS user_name,
            te.event_type, te.details, te.created_at
       FROM task_events te
       LEFT JOIN users u ON u.id = te.user_id
      WHERE te.task_id = $1
      ORDER BY te.created_at DESC, te.id DESC`,
    [task_id]
  );
  return rows;
}

/* --- Lista de comprobacion --- */

export async function findChecklistItems(task_id) {
  const { rows } = await query(
    `SELECT id, task_id, title, is_completed, position::float8 AS position, created_at, updated_at
       FROM task_checklist_items
      WHERE task_id = $1
      ORDER BY position ASC, id ASC`,
    [task_id]
  );
  return rows;
}

export async function createChecklistItem({ task_id, title }) {
  const { rows } = await query(
    `INSERT INTO task_checklist_items (task_id, title, position)
     VALUES ($1, $2, (SELECT COALESCE(MAX(position), 0) + 1000 FROM task_checklist_items WHERE task_id = $1))
     RETURNING id, task_id, title, is_completed, position::float8 AS position, created_at, updated_at`,
    [task_id, title]
  );
  return rows[0];
}

export async function updateChecklistItem(task_id, id, fields) {
  const allowed = ['title', 'is_completed'];
  const sets = [];
  const params = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      params.push(fields[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (sets.length === 0) return null;

  sets.push('updated_at = NOW()');
  params.push(id, task_id);

  const { rows } = await query(
    `UPDATE task_checklist_items
        SET ${sets.join(', ')}
      WHERE id = $${params.length - 1} AND task_id = $${params.length}
      RETURNING id, task_id, title, is_completed, position::float8 AS position, created_at, updated_at`,
    params
  );
  return rows[0] || null;
}

export async function deleteChecklistItem(task_id, id) {
  const { rows } = await query(
    'DELETE FROM task_checklist_items WHERE id = $1 AND task_id = $2 RETURNING id, title',
    [id, task_id]
  );
  return rows[0] || null;
}

/* --- Comentarios --- */

export async function findComments(task_id) {
  const { rows } = await query(
    `SELECT c.id, c.task_id, c.user_id, u.nombre AS user_name, u.avatar_url AS user_avatar,
            c.content, c.created_at, c.updated_at
       FROM task_comments c
       JOIN users u ON u.id = c.user_id
      WHERE c.task_id = $1
      ORDER BY c.created_at ASC, c.id ASC`,
    [task_id]
  );
  return rows;
}

export async function findComment(task_id, id) {
  const { rows } = await query(
    'SELECT id, task_id, user_id FROM task_comments WHERE id = $1 AND task_id = $2',
    [id, task_id]
  );
  return rows[0] || null;
}

export async function createComment({ task_id, user_id, content }) {
  const { rows } = await query(
    `INSERT INTO task_comments (task_id, user_id, content)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [task_id, user_id, content]
  );
  return rows[0];
}

export async function deleteComment(task_id, id) {
  const { rows } = await query(
    'DELETE FROM task_comments WHERE id = $1 AND task_id = $2 RETURNING id',
    [id, task_id]
  );
  return rows[0] || null;
}

/* --- Etiquetas --- */

export async function findTags(task_id) {
  const { rows } = await query(
    `SELECT id, task_id, name, color, created_at
       FROM task_tags
      WHERE task_id = $1
      ORDER BY id ASC`,
    [task_id]
  );
  return rows;
}

/**
 * «Web» y «web» son la misma etiqueta (índice único de la 210; en MultiCRM la 196). Si ya estaba,
 * se devuelve la que había, sin cambiarle el color, y `repetida` lo dice.
 */
export async function createTag({ task_id, name, color = 'sky' }) {
  const { rows } = await query(
    `INSERT INTO task_tags (task_id, name, color)
     VALUES ($1, $2, $3)
     ON CONFLICT (task_id, LOWER(name)) DO NOTHING
     RETURNING *`,
    [task_id, name, color]
  );
  if (rows[0]) return { ...rows[0], repetida: false };
  const { rows: [ya] } = await query(
    'SELECT * FROM task_tags WHERE task_id = $1 AND LOWER(name) = LOWER($2)',
    [task_id, name]
  );
  return { ...ya, repetida: true };
}

export async function deleteTag(task_id, id) {
  const { rows } = await query(
    'DELETE FROM task_tags WHERE id = $1 AND task_id = $2 RETURNING id, name',
    [id, task_id]
  );
  return rows[0] || null;
}

/** Los nombres de etiqueta que se pueden elegir en el filtro del tablero. */
export async function findTagNames({ assigned_to = null, ambito = null, yo = null } = {}) {
  const params = [];
  let filtro = '';
  if (assigned_to != null) {
    params.push(assigned_to);
    filtro = 'AND t.assigned_to = $1';
  } else if (ambito) {
    params.push(ambito, yo);
    filtro = `AND ${genteDelAmbito('t.assigned_to', 1, 2)}`;
  }
  const { rows } = await query(
    `SELECT MIN(tg.name) AS name, COUNT(*)::int AS total
       FROM task_tags tg
       JOIN tasks t ON t.id = tg.task_id
      WHERE t.archived_at IS NULL ${filtro}
      GROUP BY LOWER(tg.name)
      ORDER BY MIN(tg.name)`,
    params
  );
  return rows;
}

/* --- Enlaces --- */

export async function findLinks(task_id) {
  const { rows } = await query(
    `SELECT l.id, l.task_id, l.url, l.title, l.created_by, u.nombre AS created_by_name, l.created_at
       FROM task_links l
       LEFT JOIN users u ON u.id = l.created_by
      WHERE l.task_id = $1
      ORDER BY l.id ASC`,
    [task_id]
  );
  return rows;
}

export async function createLink({ task_id, url, title = null, created_by }) {
  const { rows } = await query(
    `INSERT INTO task_links (task_id, url, title, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [task_id, url, title, created_by]
  );
  return rows[0];
}

export async function deleteLink(task_id, id) {
  const { rows } = await query(
    'DELETE FROM task_links WHERE id = $1 AND task_id = $2 RETURNING id, url, title',
    [id, task_id]
  );
  return rows[0] || null;
}

/* --- Personas --- */

/**
 * A quién puede asignar tareas quien mira (Hugo, 09/10): a sí mismo y a la
 * gente con algún campus activo dentro de su ámbito, o de una empresa del
 * ámbito (`user_empresas`, Diego 26/10/2026: el equipo de desarrollo va por
 * empresa). Los colaboradores sin campus ni empresa, NO: a ellos solo les
 * asigna el superadmin (`ambito` null).
 */
export function asignableEnAmbito(col, idxIds, idxYo) {
  return `(${col} = $${idxYo}
    OR EXISTS (SELECT 1 FROM user_projects up_g
                WHERE up_g.user_id = ${col} AND up_g.active AND up_g.project_id = ANY($${idxIds}::int[]))
    OR ${deEmpresaDelAmbito(col, idxIds)})`;
}

/**
 * La gente del equipo que ve quien mira. `asignable` dice si además puede
 * ponerla como responsable: un colaborador sin campus sale (su tablero se ve),
 * pero solo el superadmin se lo asigna.
 */
export async function findAssignees(ambito = null, yo = null, ambitoAsignar = null) {
  const params = [ROLES_TAREAS];
  // `yo` solo entra si se usa: un parámetro sin usar no tiene tipo (42P18).
  let idxYo = null;
  const yoEn = () => { if (!idxYo) { params.push(yo); idxYo = params.length; } return idxYo; };
  let filtro = '';
  if (ambito) {
    params.push(ambito);
    filtro = `AND ${genteDelAmbito('u.id', params.length, yoEn())}`;
  }
  let asignable = 'TRUE';
  if (ambitoAsignar) {
    params.push(ambitoAsignar);
    asignable = asignableEnAmbito('u.id', params.length, yoEn());
  }
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.role, ${asignable} AS asignable
       FROM users u
      WHERE u.active AND ${conTablero(1)} ${filtro}
      ORDER BY u.nombre ASC`,
    params
  );
  return rows;
}

/** Si quien mira puede asignarle tareas a esta persona (ver `asignableEnAmbito`). */
export async function personaAsignable(personaId, ambito, yo) {
  if (!ambito) return true;
  const { rows } = await query(`SELECT ${asignableEnAmbito('$3::int', 1, 2)} AS ok`, [ambito, yo, personaId]);
  return rows[0].ok === true;
}

export async function findUserBasic(id) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.active, u.role::text AS role,
            (u.role::text = ANY($2::text[]) OR u.roles_extra::text[] && $2::text[]) AS con_tablero
       FROM users u WHERE u.id = $1`,
    [id, ROLES_TAREAS]
  );
  return rows[0] || null;
}

/* --- Todo el equipo y métricas --- */

export async function getTeamMetrics(projectId = null, areaId = null, ambito = null, yo = null) {
  const params = [ROLES_TAREAS];
  let filtroProyecto = '';
  let filtroArea = '';
  let filtroGente = '';

  if (projectId) {
    params.push(projectId);
    filtroProyecto = `AND t.project_id = $${params.length}`;
  }
  if (areaId) {
    params.push(areaId);
    filtroArea = `AND t.area_id = $${params.length}`;
  }
  if (ambito) {
    params.push(ambito, yo);
    filtroGente = `AND ${genteDelAmbito('u.id', params.length - 1, params.length)}`;
  }

  const { rows } = await query(
    `SELECT
       u.id AS user_id,
       u.nombre AS user_name,
       u.email AS user_email,
       u.role AS user_role,
       COUNT(t.id) FILTER (WHERE t.archived_at IS NULL AND t.status <> 'hecha')::int AS open_tasks,
       COUNT(t.id) FILTER (WHERE t.archived_at IS NULL AND t.status <> 'hecha' AND t.due_date < NOW())::int AS overdue_tasks,
       COUNT(t.id) FILTER (WHERE t.status = 'hecha' AND t.completed_at >= date_trunc('week', NOW()))::int AS completed_this_week,
       COUNT(t.id) FILTER (WHERE t.status = 'hecha' AND t.completed_at >= date_trunc('month', NOW()))::int AS completed_this_month
     FROM users u
     LEFT JOIN tasks t ON t.assigned_to = u.id ${filtroProyecto} ${filtroArea}
     WHERE u.active AND ${conTablero(1)} ${filtroGente}
     GROUP BY u.id, u.nombre, u.email, u.role
     ORDER BY open_tasks DESC, u.nombre ASC`,
    params
  );
  return rows;
}

/** «Todo el equipo» por área: lo mismo que por persona, agrupado por área. */
export async function getTeamMetricsByArea(projectId = null, ambito = null, yo = null) {
  const params = [];
  let filtroProyecto = '';
  let filtroGente = '';
  if (projectId) {
    params.push(projectId);
    filtroProyecto = `AND t.project_id = $${params.length}`;
  }
  if (ambito) {
    params.push(ambito, yo);
    filtroGente = `AND ${genteDelAmbito('t.assigned_to', params.length - 1, params.length)}`;
  }
  const { rows } = await query(
    `SELECT
       ar.id AS area_id,
       COALESCE(ar.name, 'Sin área') AS area_name,
       ar.color AS area_color,
       COUNT(t.id) FILTER (WHERE t.archived_at IS NULL AND t.status <> 'hecha')::int AS open_tasks,
       COUNT(t.id) FILTER (WHERE t.archived_at IS NULL AND t.status <> 'hecha' AND t.due_date < NOW())::int AS overdue_tasks,
       COUNT(t.id) FILTER (WHERE t.status = 'hecha' AND t.completed_at >= date_trunc('week', NOW()))::int AS completed_this_week,
       COUNT(t.id) FILTER (WHERE t.status = 'hecha' AND t.completed_at >= date_trunc('month', NOW()))::int AS completed_this_month,
       (SELECT COUNT(*)::int FROM user_task_areas uta WHERE uta.area_id = ar.id) AS people
     FROM tasks t
     LEFT JOIN task_areas ar ON ar.id = t.area_id
     WHERE TRUE ${filtroProyecto} ${filtroGente}
     GROUP BY ar.id, ar.name, ar.color, ar.sort_order
     ORDER BY ar.sort_order ASC NULLS LAST, area_name ASC`,
    params
  );
  return rows;
}

/* --- Columnas dinámicas --- */

export async function findActiveColumns() {
  const { rows } = await query(
    `SELECT id, key, name, color, sort_order, is_system, is_active, created_at, updated_at
       FROM task_columns
      WHERE is_active = true
      ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

export async function findAllColumns() {
  const { rows } = await query(
    `SELECT id, key, name, color, sort_order, is_system, is_active, created_at, updated_at
       FROM task_columns
      ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

export async function findColumnByKey(key) {
  const { rows } = await query(`SELECT * FROM task_columns WHERE key = $1`, [key]);
  return rows[0] || null;
}

export async function findColumnById(id) {
  const { rows } = await query(`SELECT * FROM task_columns WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function countTasksInColumn(key) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total FROM tasks WHERE status = $1 AND archived_at IS NULL`,
    [key]
  );
  return rows[0]?.total || 0;
}

export async function createColumn({ key, name, color = 'gray', sort_order = 0 }) {
  const { rows } = await query(
    `INSERT INTO task_columns (key, name, color, sort_order, is_system, is_active)
     VALUES ($1, $2, $3, $4, FALSE, TRUE)
     RETURNING *`,
    [key, name, color, sort_order]
  );
  return rows[0];
}

export async function updateColumn(id, fields) {
  const allowed = ['name', 'color', 'sort_order', 'is_active'];
  const sets = [];
  const params = [];

  for (const k of allowed) {
    if (fields[k] !== undefined) {
      params.push(fields[k]);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (sets.length === 0) return findColumnById(id);

  sets.push('updated_at = NOW()');
  params.push(id);

  const { rows } = await query(
    `UPDATE task_columns SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return rows[0] || null;
}

export async function reorderColumns(keys) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < keys.length; i++) {
      await client.query(
        `UPDATE task_columns SET sort_order = $1, updated_at = NOW() WHERE key = $2`,
        [(i + 1) * 10, keys[i]]
      );
    }
    await client.query('COMMIT');
    return findActiveColumns();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* --- Áreas de trabajo --- */

export async function findActiveAreas() {
  const { rows } = await query(
    `SELECT id, name, color, sort_order, is_active, created_at, updated_at
       FROM task_areas
      WHERE is_active = true
      ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

export async function findAllAreas() {
  const { rows } = await query(
    `SELECT id, name, color, sort_order, is_active, created_at, updated_at
       FROM task_areas
      ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

export async function findAreaById(id) {
  const { rows } = await query(`SELECT * FROM task_areas WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function createArea({ name, color = 'gray', sort_order = null }) {
  // Sin orden, al final de la lista: con 0 una nueva saltaba delante de Meta.
  const { rows } = await query(
    `INSERT INTO task_areas (name, color, sort_order, is_active)
     VALUES ($1, $2, COALESCE($3, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM task_areas)), TRUE)
     RETURNING *`,
    [name, color, sort_order]
  );
  return rows[0];
}

export async function updateArea(id, fields) {
  const allowed = ['name', 'color', 'sort_order', 'is_active'];
  const sets = [];
  const params = [];

  for (const k of allowed) {
    if (fields[k] !== undefined) {
      params.push(fields[k]);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (sets.length === 0) return findAreaById(id);

  sets.push('updated_at = NOW()');
  params.push(id);

  const { rows } = await query(
    `UPDATE task_areas SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return rows[0] || null;
}

export async function getUserAreas(userId) {
  const { rows } = await query(
    `SELECT ta.id, ta.name, ta.color, ta.sort_order
       FROM user_task_areas uta
       JOIN task_areas ta ON ta.id = uta.area_id
      WHERE uta.user_id = $1 AND ta.is_active = true
      ORDER BY ta.sort_order ASC`,
    [userId]
  );
  return rows;
}

/** Deja en el área exactamente a estas personas (las demás áreas de cada una, intactas). */
export async function setAreaMembers(areaId, userIds) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_task_areas WHERE area_id = $1', [areaId]);
    if (userIds.length) {
      await client.query(
        `INSERT INTO user_task_areas (user_id, area_id)
         SELECT UNNEST($1::int[]), $2 ON CONFLICT DO NOTHING`,
        [userIds, areaId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const { rows } = await query('SELECT user_id FROM user_task_areas WHERE area_id = $1 ORDER BY user_id', [areaId]);
  return rows.map((x) => x.user_id);
}

export async function getUserAreaAssignments() {
  const { rows } = await query(
    `SELECT user_id, area_id FROM user_task_areas`
  );
  return rows;
}

export async function setUserAreas(userId, areaIds) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM user_task_areas WHERE user_id = $1`, [userId]);
    for (const areaId of areaIds) {
      await client.query(
        `INSERT INTO user_task_areas (user_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, areaId]
      );
    }
    await client.query('COMMIT');
    return getUserAreas(userId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* --- Proyectos Propios (Externos) --- */

export async function findActiveExternalProjects() {
  const { rows } = await query(
    `SELECT id, name, description, url, color, sort_order, is_active, created_at, updated_at
       FROM task_external_projects
      WHERE is_active = true
      ORDER BY sort_order ASC, name ASC`
  );
  return rows;
}

export async function findAllExternalProjects() {
  const { rows } = await query(
    `SELECT id, name, description, url, color, sort_order, is_active, created_at, updated_at
       FROM task_external_projects
      ORDER BY sort_order ASC, name ASC`
  );
  return rows;
}

export async function findExternalProjectById(id) {
  const { rows } = await query(`SELECT * FROM task_external_projects WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function createExternalProject({ name, description = null, url = null, color = 'gray' }) {
  // Al final de la lista.
  const { rows } = await query(
    `INSERT INTO task_external_projects (name, description, url, color, sort_order, is_active)
     VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM task_external_projects), TRUE)
     RETURNING *`,
    [name, description, url, color]
  );
  return rows[0];
}

export async function updateExternalProject(id, fields) {
  const allowed = ['name', 'description', 'url', 'color', 'sort_order', 'is_active'];
  const sets = [];
  const params = [];

  for (const k of allowed) {
    if (fields[k] !== undefined) {
      params.push(fields[k]);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (sets.length === 0) return findExternalProjectById(id);

  sets.push('updated_at = NOW()');
  params.push(id);

  const { rows } = await query(
    `UPDATE task_external_projects SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return rows[0] || null;
}

/* --- Correo diario --- */

/**
 * Lo que vence hoy o ya venció, por persona. `hoy` es la fecha (AAAA-MM-DD) en
 * la zona de la oficina y `tz` esa zona: el fin del día se calcula ahí, no en
 * la de la base, que en el servidor es UTC.
 */
export async function findDailyDigest(aviso, hoy, tz = 'Europe/Madrid') {
  // Solo a quien tiene tablero (Diego, 09/10): una gestora con tareas de antes
  // recibiría un correo con un enlace que ya no puede abrir (403).
  const { rows } = await query(
    `SELECT u.id AS user_id, u.nombre, u.email,
            json_agg(json_build_object(
              'id', t.id, 'title', t.title, 'status', t.status,
              'priority', t.priority, 'due_date', t.due_date
            ) ORDER BY t.due_date ASC) AS tareas
       FROM users u
       JOIN tasks t ON t.assigned_to = u.id
      WHERE u.active
        AND u.email IS NOT NULL
        AND ${conTablero(4)}
        AND t.archived_at IS NULL
        AND t.status <> 'hecha'
        AND t.due_date < (($2::date + 1)::timestamp AT TIME ZONE $3)
        AND NOT EXISTS (
          SELECT 1 FROM avisos_apagados a WHERE a.user_id = u.id AND a.aviso = $1
        )
      GROUP BY u.id, u.nombre, u.email
      ORDER BY u.nombre`,
    [aviso, hoy, tz, ROLES_TAREAS]
  );
  return rows;
}

export async function avisoApagado(userId, aviso) {
  const { rows } = await query(
    'SELECT 1 FROM avisos_apagados WHERE user_id = $1 AND aviso = $2',
    [userId, aviso]
  );
  return rows.length > 0;
}
