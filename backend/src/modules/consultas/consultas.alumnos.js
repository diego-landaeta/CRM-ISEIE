/*
  CONSULTAS DE ALUMNOS · FASE 3 (#189): los alumnos de cada tutor, quién no tiene
  ningún mensaje todavía y «Escribir al alumno».

  «No basta con contestar a quien pregunta: el tutor tiene que hacer seguimiento
  en el campus a todos sus alumnos» (especificación, punto 6).

  MATRICULADOS. Una vez al día (y con «Sincronizar ahora») se leen, en cada
  campus que lee consultas, los cursos de cada tutor matriculado —los que
  IMPARTE: donde su rol es de profesor— y sus alumnos activos. Moodle no da la
  fecha de matrícula sin un plugin: se toma la primera vez que el CRM ve al
  alumno y se marca como aproximada (decisión 2 del estudio de la fase 0).

  SIN MENSAJES = alumno activo que no tiene ninguna conversación con su tutor:
  ni en el campus (de antes de que el CRM leyera) ni en el CRM. Los más antiguos
  arriba, con el semáforo: ámbar desde el día 5 y rojo desde el 7 (decisión 7).
*/
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import {
  cursosDe, matriculadosDe, conversacionesDe, MoodleError,
} from '../../shared/services/moodle.client.js';
import { conexionDelCampus } from '../tutores/tutor.campus.js';
import { campusConConsultas, enviarAlCampus } from './consultas.service.js';

export const DIAS_AMBAR = Number(process.env.CONSULTAS_SIN_MENSAJES_AMBAR || 5);
export const DIAS_ROJO = Number(process.env.CONSULTAS_SIN_MENSAJES_ROJO || 7);

const ROLES_PROFESOR = new Set(['editingteacher', 'teacher']);

/** Los tutores matriculados en ese campus, con su id de Moodle. */
async function tutoresDelCampus(projectId) {
  const { rows } = await query(
    `SELECT tc.tutor_id, tc.moodle_user_id
       FROM tutor_campus tc JOIN users u ON u.id = tc.tutor_id AND u.active
      WHERE tc.project_id = $1 AND tc.estado = 'activa' AND tc.moodle_user_id IS NOT NULL`, [projectId]);
  return rows.map((r) => ({ tutorId: Number(r.tutor_id), moodleId: Number(r.moodle_user_id) }));
}

/**
 * Lee del campus los alumnos activos de cada tutor y los guarda. Quien deja de
 * salir matriculado pasa a inactivo y sale de la lista.
 */
export async function sincronizarAlumnos(projectId, opciones = {}) {
  const conexion = await conexionDelCampus(projectId);
  if (!conexion || conexion.error) return { projectId, sinConexion: true };
  const resumen = { projectId, tutores: 0, alumnos: 0, nuevos: 0, bajas: 0, errores: [] };
  const tutores = await tutoresDelCampus(projectId);
  for (const tutor of tutores) {
    // La hora de la base, no la de Node: `visto_at` se pone con NOW() y un
    // reloj adelantado daría de baja a quien se acaba de ver.
    const inicio = (await query('SELECT NOW() AS ahora')).rows[0].ahora;
    let cursos;
    let conConversacion;
    try {
      cursos = await cursosDe(conexion, tutor.moodleId, opciones);
      conConversacion = await conQuienHabla(conexion, tutor.moodleId, opciones);
    } catch (err) {
      resumen.errores.push(err instanceof MoodleError ? err.message : 'No se han podido leer sus cursos.');
      continue;
    }
    resumen.tutores += 1;
    let completo = true;
    for (const curso of cursos) {
      let gente;
      try {
        gente = await matriculadosDe(conexion, curso.id, opciones);
      } catch (err) {
        completo = false;
        resumen.errores.push(err instanceof MoodleError ? err.message : `No se ha podido leer el curso ${curso.nombre || curso.id}.`);
        continue;
      }
      // Solo los cursos que imparte (donde es profesor), no en los que está de alumno.
      const yo = gente.find((g) => g.id === tutor.moodleId);
      if (!yo || !yo.roles.some((r) => ROLES_PROFESOR.has(r))) continue;
      for (const a of gente.filter((g) => g.id !== tutor.moodleId && g.roles.includes('student'))) {
        const r = await query(
          `INSERT INTO tutor_alumnos (project_id, tutor_id, alumno_moodle_id, curso_moodle_id, curso_nombre,
                                      alumno_nombre, alumno_email, ultimo_acceso, con_conversacion, activo, visto_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW())
           ON CONFLICT (project_id, tutor_id, alumno_moodle_id, curso_moodle_id) DO UPDATE
             SET curso_nombre = EXCLUDED.curso_nombre, alumno_nombre = EXCLUDED.alumno_nombre,
                 alumno_email = EXCLUDED.alumno_email, ultimo_acceso = EXCLUDED.ultimo_acceso,
                 con_conversacion = tutor_alumnos.con_conversacion OR EXCLUDED.con_conversacion,
                 activo = true, visto_at = NOW()
           RETURNING (xmax = 0) AS nuevo`,
          [projectId, tutor.tutorId, a.id, curso.id, curso.nombre, a.nombre, a.email, a.ultimoAcceso, conConversacion.has(a.id)]);
        resumen.alumnos += 1;
        if (r.rows[0]?.nuevo) resumen.nuevos += 1;
      }
    }
    // Lo que no ha salido en esta vuelta ya no está matriculado. Solo si se ha
    // podido leer todo: un curso que falla no puede dar de baja a sus alumnos.
    if (completo) {
      const b = await query(
        `UPDATE tutor_alumnos SET activo = false
          WHERE project_id = $1 AND tutor_id = $2 AND activo AND visto_at < $3`, [projectId, tutor.tutorId, inicio]);
      resumen.bajas += b.rowCount;
    }
  }
  // Los alumnos de quien ya no es tutor activo de este campus (baja en el
  // campus, usuario desactivado…) salen de las listas y de las métricas.
  const fuera = await query(
    `UPDATE tutor_alumnos SET activo = false
      WHERE project_id = $1 AND activo AND NOT (tutor_id = ANY($2::int[]))`,
    [projectId, tutores.map((t) => t.tutorId)]);
  resumen.bajas += fuera.rowCount;
  return resumen;
}

/**
 * Con quién tiene ya conversación el tutor en el campus: todas sus
 * conversaciones, de 500 en 500. Con una sola página, a un tutor con más de 500
 * se le quedaban alumnos con conversación marcados como «sin mensajes».
 */
const POR_PAGINA = 500;
async function conQuienHabla(conexion, moodleUserId, opciones) {
  const quien = new Set();
  for (let desde = 0; ; desde += POR_PAGINA) {
    const pagina = await conversacionesDe(conexion, moodleUserId, { limite: POR_PAGINA, desde }, opciones);
    for (const c of pagina) for (const m of c.miembros) quien.add(m.id);
    if (pagina.length < POR_PAGINA) break;
  }
  return quien;
}

export async function sincronizarTodos(opciones = {}) {
  const resultados = [];
  for (const c of await campusConConsultas()) {
    try {
      resultados.push(await sincronizarAlumnos(c.projectId, opciones));
    } catch (err) {
      logger.warn({ projectId: c.projectId, err: err.message }, 'consultas: fallo al sincronizar los alumnos');
      resultados.push({ projectId: c.projectId, errores: [err.message] });
    }
  }
  return resultados;
}

/** Que tiene conversación con su tutor: al entrar su primera consulta o al escribirle el tutor. */
export async function marcarContactado(projectId, tutorId, alumnoMoodleId, cuando = new Date()) {
  await query(
    `UPDATE tutor_alumnos
        SET con_conversacion = true, primer_contacto_at = COALESCE(primer_contacto_at, $4)
      WHERE project_id = $1 AND tutor_id = $2 AND alumno_moodle_id = $3`,
    [projectId, tutorId, alumnoMoodleId, cuando]);
}

/**
 * «Alumnos sin mensajes»: activos, sin conversación con su tutor ni en el campus
 * ni en el CRM. Los más antiguos arriba.
 */
export async function sinMensajes({ tutorId = null, projectIds = null } = {}) {
  const where = ['ta.activo', 'NOT ta.con_conversacion',
    `NOT EXISTS (SELECT 1 FROM consultas c WHERE c.project_id = ta.project_id
                   AND c.alumno_moodle_id = ta.alumno_moodle_id AND c.tutor_id = ta.tutor_id)`];
  const p = [];
  if (tutorId) { p.push(tutorId); where.push(`ta.tutor_id = $${p.length}`); }
  if (projectIds) { p.push(projectIds); where.push(`ta.project_id = ANY($${p.length}::int[])`); }
  // Una fila por alumno y tutor, aunque esté en varios cursos suyos (si no, el
  // mismo alumno salía dos veces y contaba doble en el resumen semanal): sus
  // cursos juntos y la matrícula más antigua. `id` es la de esa matrícula.
  const { rows } = await query(
    `WITH g AS (
       SELECT ta.project_id, ta.tutor_id, ta.alumno_moodle_id,
              (ARRAY_AGG(ta.id ORDER BY ta.matriculado_desde, ta.id))[1] AS id,
              MIN(ta.matriculado_desde) AS matriculado_desde,
              BOOL_OR(ta.matricula_aproximada) AS matricula_aproximada,
              MAX(ta.ultimo_acceso) AS ultimo_acceso,
              MAX(ta.alumno_nombre) AS alumno_nombre, MAX(ta.alumno_email) AS alumno_email,
              STRING_AGG(DISTINCT ta.curso_nombre, ' · ') AS curso_nombre
         FROM tutor_alumnos ta
        WHERE ${where.join(' AND ')}
        GROUP BY ta.project_id, ta.tutor_id, ta.alumno_moodle_id
     )
     SELECT g.id, g.project_id, pr.nombre AS campus, g.tutor_id, u.nombre AS tutor,
            g.alumno_nombre, g.alumno_email, g.curso_nombre, g.matriculado_desde, g.matricula_aproximada,
            g.ultimo_acceso,
            FLOOR(EXTRACT(EPOCH FROM (NOW() - g.matriculado_desde)) / 86400)::int AS dias
       FROM g
       JOIN projects pr ON pr.id = g.project_id
       JOIN users u ON u.id = g.tutor_id
      ORDER BY g.matriculado_desde ASC, g.id
      LIMIT 1000`, p);
  return rows.map((r) => ({ ...r, color: r.dias >= DIAS_ROJO ? 'rojo' : r.dias >= DIAS_AMBAR ? 'ambar' : 'verde' }));
}

export async function filaDeAlumno(id) {
  const { rows } = await query('SELECT * FROM tutor_alumnos WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * «Escribir al alumno»: el mensaje sale del CRM al campus en nombre del tutor y
 * queda como una conversación más (una consulta que empezó el tutor). El alumno
 * sale de la lista aunque el campus no lo acepte todavía: el mensaje queda
 * guardado con el motivo y se reintenta desde la consulta.
 */
export async function escribirAlAlumno(fila, tutorId, texto, opciones = {}) {
  const { rows } = await query(
    `INSERT INTO consultas (project_id, issuer_id, alumno_moodle_id, alumno_nombre, alumno_email,
                            curso_moodle_id, curso_nombre, tutor_id, estado, origen, entrada_at, asignada_at)
     SELECT $1, p.sociedad_emisora_id, $2, $3, $4, $5, $6, $7, 'respondida', 'tutor', NOW(), NOW()
       FROM projects p WHERE p.id = $1
     RETURNING *`,
    [fila.project_id, fila.alumno_moodle_id, fila.alumno_nombre, fila.alumno_email,
     fila.curso_moodle_id, fila.curso_nombre, tutorId]);
  const consulta = rows[0];
  await query(
    `INSERT INTO consulta_eventos (consulta_id, tipo, user_id, detalle) VALUES ($1, 'iniciada_por_tutor', $2, NULL)`,
    [consulta.id, tutorId]);
  const m = await query(
    `INSERT INTO consulta_mensajes (consulta_id, project_id, autor, autor_user_id, texto, escrito_at)
     VALUES ($1, $2, 'tutor', $3, $4, NOW()) RETURNING *`,
    [consulta.id, consulta.project_id, tutorId, texto]);
  const envio = await enviarAlCampus(m.rows[0], consulta, [], opciones);
  await marcarContactado(fila.project_id, tutorId, fila.alumno_moodle_id);
  return { consultaId: consulta.id, ...envio };
}
