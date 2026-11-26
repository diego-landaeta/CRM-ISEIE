import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { misCampus } from './tutor.acceso.js';
import * as campusDeLaTutora from './tutor.micampus.js';
import { redaccionEnMoodle } from './tutor.redaccion.js';
import { panelDeTutores } from '../consultas/consultas.carga.js';
import { existeEquipos, existeTipos, ES_REDACTORA } from '../tasks/tasks.equipos.model.js';

/*
  Supervisión de tutores (petición de la dirección, 26/11/2026, para ISEIE).

  «Un supervisor de tutores»: alguien —un tutor más, normalmente— que ve lo que
  hacen los demás tutores de sus campus y no toca nada. Con `tutores.supervisar`:

    · la lista de tutores de SUS campus, con su carga, sus consultas abiertas, sus
      alumnos sin mensajes y sus tareas abiertas (el panel de tutores de Consultas,
      sin el IBAN ni el DNI de la ficha de Tutores);
    · el «Mi campus» de cada uno, recortado a los campus que comparten: consultas
      por responder, entregas por corregir, mensajes sin responder y lo que tiene
      por desarrollar;
    · lo que redactan las tutoras redactoras en Moodle (el bloque de la ficha);
    · sus tareas del tablero de tutores y de redactoras, con su último comentario.

  Todo es lectura. No hay aquí ni una ruta que escriba, y las de escribir de cada
  cosa (responder, corregir, mover una tarea) siguen pidiendo lo que pedían: ser
  su tutora, su profesora en Moodle o quien lleva la tarea.

  Alcance: los campus de quien mira (`user_projects`); super admin y soporte, todos.
  Un tutor de otro campus es «no encontrado», como en el resto de Tutores.
*/

const NO_ENCONTRADO = () => new AppError('Tutor no encontrado', 404, 'NOT_FOUND');

/** Los campus de quien mira, para filtrar con `= ANY`: null = todos; sin ninguno, [-1]. */
async function campusQueMira(req) {
  const mios = await misCampus(req);
  if (mios === null) return null;
  return mios.length ? mios : [-1];
}

const ES_TUTOR = `(u.role::text IN ('tutor', 'tutor_redactor')
  OR COALESCE(u.roles_extra, '{}')::text[] && ARRAY['tutor', 'tutor_redactor'])`;

/**
 * Que sea tutor (o redactora) y de uno de esos campus: por `user_projects` o por su
 * empresa entera (`tutor_empresas`), como `panelDeTutores`. Si no, 404.
 */
export async function exigirTutorSupervisable(req, tutorId) {
  const id = Number(tutorId);
  if (!Number.isInteger(id) || id <= 0) throw NO_ENCONTRADO();
  const campus = await campusQueMira(req);
  const { rows } = await query(
    `SELECT u.id FROM users u
      WHERE u.id = $1 AND ${ES_TUTOR}
        AND ($2::int[] IS NULL
             OR EXISTS (SELECT 1 FROM user_projects up
                         WHERE up.user_id = u.id AND up.active AND up.project_id = ANY($2::int[]))
             OR EXISTS (SELECT 1 FROM tutor_empresas te
                          JOIN projects p ON p.sociedad_emisora_id = te.issuer_id AND p.active
                         WHERE te.tutor_id = u.id AND p.id = ANY($2::int[])))`,
    [id, campus]);
  if (!rows[0]) throw NO_ENCONTRADO();
  return { id, campus };
}

/**
 * SQL: la tarea `t` es del trabajo de tutora. Fuera, las de un equipo de colaboradores
 * (desarrollo, SEO…): no son de esto. Sin equipo, las suyas sueltas (de su campus, si
 * tiene). Con equipo, solo los de las empresas de esos campus. `n` es el parámetro
 * con los campus (o NULL = todos).
 */
function sqlTareaDeTutora(t, n, { equipos, tipos }) {
  const sueltas = `(${t}.project_id IS NULL OR ${n}::int[] IS NULL OR ${t}.project_id = ANY(${n}::int[]))`;
  if (!equipos) return sueltas;
  const deEquipo = `EXISTS (SELECT 1 FROM task_teams tt_s WHERE tt_s.id = ${t}.team_id
      ${tipos ? "AND tt_s.tipo <> 'colaboradores'" : 'AND FALSE'}
      AND (${n}::int[] IS NULL OR tt_s.issuer_id IN (SELECT sociedad_emisora_id FROM projects WHERE id = ANY(${n}::int[]))))`;
  return `((${t}.team_id IS NULL AND ${sueltas}) OR ${deEquipo})`;
}

/** Las tareas de hace más de un mes ya hechas no se enseñan: no dicen nada de hoy. */
const VIVA = (t) => `(${t}.archived_at IS NULL AND (${t}.status <> 'hecha' OR ${t}.completed_at IS NULL OR ${t}.completed_at > NOW() - INTERVAL '30 days'))`;

/** GET /api/tutores/supervision — los tutores de mis campus, con lo que tienen entre manos. */
export async function lista(req) {
  const campus = await campusQueMira(req);
  const tutores = (await panelDeTutores(campus)).filter((t) => t.id !== Number(req.user.userId));
  if (!tutores.length) return { tutores: [] };
  const ids = tutores.map((t) => t.id);
  const equipos = await existeEquipos();
  const tipos = equipos && (await existeTipos());
  const { rows } = await query(
    `SELECT u.id, ${ES_REDACTORA('u')} AS es_redactora,
            (SELECT COUNT(*)::int FROM tasks t
              WHERE t.assigned_to = u.id AND ${VIVA('t')} AND t.status <> 'hecha'
                AND ${sqlTareaDeTutora('t', '$2', { equipos, tipos })}) AS tareas_abiertas,
            (SELECT COUNT(*)::int FROM cursos_pendientes cp
              WHERE cp.tutor_id = u.id AND cp.estado NOT IN ('cerrado', 'cancelado')
                AND ($2::int[] IS NULL OR cp.project_id IS NULL OR cp.project_id = ANY($2::int[]))) AS por_desarrollar
       FROM users u WHERE u.id = ANY($1::int[])`,
    [ids, campus]);
  const extra = new Map(rows.map((r) => [Number(r.id), r]));
  return {
    tutores: tutores.map((t) => ({
      id: t.id,
      nombre: t.nombre,
      email: t.email,
      campus: t.campus || [],
      disponible: t.disponible !== false,
      motivo_no_disponible: t.motivo_no_disponible || null,
      carga: t.carga || null,
      carga_desactualizada: Boolean(t.desactualizada),
      alumnos_activos: t.alumnos_activos || 0,
      consultas_abiertas: t.consultas_abiertas || 0,
      alumnos_sin_mensajes: t.alumnos_sin_mensajes || 0,
      es_redactora: extra.get(t.id)?.es_redactora === true,
      tareas_abiertas: extra.get(t.id)?.tareas_abiertas || 0,
      por_desarrollar: extra.get(t.id)?.por_desarrollar || 0,
    })),
  };
}

/**
 * GET /api/tutores/supervision/:id/mi-campus — su «Mi campus», solo en los campus que
 * comparte con quien mira. Lo que no es de esos campus ni se lee de Moodle.
 */
export async function miCampusDe(req, tutorId, { refrescar = false } = {}) {
  const { id, campus } = await exigirTutorSupervisable(req, tutorId);
  return campusDeLaTutora.miCampus(id, { refrescar, soloEn: campus });
}

/** GET /api/tutores/supervision/:id/redaccion-moodle — lo que redacta en Moodle, de esos campus. */
export async function redaccionDe(req, tutorId) {
  const { id, campus } = await exigirTutorSupervisable(req, tutorId);
  const datos = await redaccionEnMoodle(id, { campusVisibles: campus });
  if (!datos) throw NO_ENCONTRADO();
  return datos;
}

/**
 * GET /api/tutores/supervision/:id/tareas — sus tareas de tutora (abiertas y las hechas
 * este mes), con la columna, el equipo y lo último que se ha escrito en cada una.
 */
export async function tareasDe(req, tutorId) {
  const { id, campus } = await exigirTutorSupervisable(req, tutorId);
  const equipos = await existeEquipos();
  const tipos = equipos && (await existeTipos());
  const { rows } = await query(
    `SELECT t.id, t.title, t.status, COALESCE(col.name, t.status) AS columna, t.priority, t.due_date,
            t.created_at, t.updated_at, t.completed_at,
            ${equipos ? 'tm.name' : 'NULL::text'} AS equipo,
            (SELECT COUNT(*)::int FROM task_comments c WHERE c.task_id = t.id) AS comentarios,
            (SELECT row_to_json(x) FROM (
               SELECT LEFT(c.content, 280) AS texto, c.created_at AS at, u.nombre AS autor
                 FROM task_comments c LEFT JOIN users u ON u.id = c.user_id
                WHERE c.task_id = t.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1) x) AS ultimo_comentario
       FROM tasks t
       LEFT JOIN task_columns col ON col.key = t.status
       ${equipos ? 'LEFT JOIN task_teams tm ON tm.id = t.team_id' : ''}
      WHERE t.assigned_to = $1 AND ${VIVA('t')} AND ${sqlTareaDeTutora('t', '$2', { equipos, tipos })}
      ORDER BY (t.status = 'hecha'), t.due_date NULLS LAST, t.updated_at DESC
      LIMIT 200`,
    [id, campus]);
  return rows.map((r) => ({
    id: Number(r.id),
    titulo: r.title,
    estado: r.status,
    columna: r.columna,
    prioridad: r.priority,
    vence: r.due_date,
    creada: r.created_at,
    actualizada: r.updated_at,
    hecha: r.completed_at,
    equipo: r.equipo || null,
    comentarios: r.comentarios || 0,
    ultimoComentario: r.ultimo_comentario || null,
  }));
}
