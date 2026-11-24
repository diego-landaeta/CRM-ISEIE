/*
  «MI CAMPUS» DE LA TUTORA (#681): lo que tiene que hacer hoy en Moodle.

  Por cada campus donde está matriculada (tutor_campus activa, con su usuario de
  Moodle) y cada curso que IMPARTE allí (rol de profesor):

    · los alumnos matriculados (activos), con su último acceso y su % hecho (el
      avance de Moodle, el mismo que da la ficha del alumno: #532);
    · sus dudas abiertas en el CRM (Consultas), las de alumnos de ese curso;
    · las tareas con entregas SIN CORREGIR, con el enlace para corregirlas en Moodle.

  Y, aparte, lo que tiene pendiente por desarrollar (Cursos pendientes, #336).

  Se lee de Moodle en el momento, con el token del campus, para que las cifras
  sean las de Moodle y no las de ayer. Para no castigar al campus, se guarda
  dos minutos por tutora Y CAMPUS; «Actualizar» lo vuelve a pedir. Las dudas que
  ya no esperan se quitan también de esa copia: son del CRM, no de Moodle (#850).

  Uno o varios campus (Diego, 24/11: «que las tutoras redactoras puedan ver entre
  uno y varios campus»): con `campus` se leen solo los elegidos (de los suyos; lo
  que no es suyo se ignora) y `todosLosCampus` dice cuáles tiene, para el selector.

  TODO lo pendiente, de cualquier fecha (Diego, 24/11: «tienen que tener TODAS las
  pendientes, no solamente desde que se subió el campus»):
    · las entregas sin corregir nunca han tenido corte de fecha; lo que faltaba eran
      las de los cursos cuyos alumnos no se pudieron leer (la base del campus llena,
      «Database connection failed»): ahora se lee de 2 en 2 y se repite (moodle.client);
    · los mensajes privados de Moodle cuyo último mensaje es del alumno salen aquí
      aunque sean de antes de «Leer las consultas» (`sinResponder`): solo se leen,
      no se crea ninguna consulta ni se escribe a nadie. Lo que ya está en el CRM
      (ese mensaje entró en una consulta, o el alumno tiene una duda abierta) no se
      repite.
*/
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import {
  cursosDe, matriculadosDe, tareasDeCursos, entregasSinCorregir, urlDelCampus, MoodleError, esAlumno, esRolDeTutora,
  conversacionesSinResponder,
} from '../../shared/services/moodle.client.js';
import { conexionDelCampus } from './tutor.campus.js';

const CACHE_MS = 2 * 60 * 1000;
/** Lo leído con algún fallo se guarda menos: al volver a entrar se intenta otra vez. */
const CACHE_CON_FALLOS_MS = 15 * 1000;
/**
 * Llamadas a la vez a un campus. Eran 4: el servidor de los campus de CEDIA (Psiko, ISAEG…)
 * tiene pocas conexiones a su base y, con 4, contestaba «Database connection failed» en 14 a
 * 40 de los 96 cursos de una tutora (24/11). Con 2, ninguno. `MI_CAMPUS_PARALELO` lo cambia.
 */
const paralelo = () => {
  const n = parseInt(process.env.MI_CAMPUS_PARALELO || '2', 10);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 8) : 2;
};
/**
 * Cursos por llamada al leer las tareas. Todos en una sola llamada pasaba del tiempo de
 * espera con una tutora de muchos cursos, y entonces NINGÚN curso enseñaba sus tareas.
 * Por tandas, si una falla, solo sus cursos lo dicen; los demás salen enteros.
 */
const CURSOS_POR_TANDA = 10;

/** Quien tiene un rol del equipo no es alumno; el resto sí (vive en moodle.client.js). */
export { esAlumno };

/**
 * Los alumnos que le tocan a la profesora `yo` en ese curso. Una profesora SIN permiso de
 * edición que está en algún grupo ve solo a los de sus grupos (lo que Moodle le enseña con
 * grupos separados: de serie no tiene «ver todos los grupos»). Con permiso de edición, o
 * sin grupo, todos. Al poner la nota, el plugin lo vuelve a mirar con los permisos exactos.
 */
export function alumnosDe(gente, yo) {
  const alumnos = gente.filter((g) => g.id !== yo.id && esAlumno(g));
  const veTodos = yo.roles.some((r) => r === 'editingteacher' || r === 'manager');
  const misGrupos = new Set(yo.grupos || []);
  if (veTodos || misGrupos.size === 0) return alumnos;
  return alumnos.filter((a) => (a.grupos || []).some((x) => misGrupos.has(x)));
}
/** La copia de dos minutos, por tutora y campus: `${tutorId}:${projectId}` → { at, datos }. */
const cache = new Map();

/**
 * Con más alumnos que esto en un campus, no se pide el % hecho de cada uno: son una
 * llamada por alumno y el campus no tiene por qué aguantarlas cada vez que una tutora
 * abre su página. Se dice en el curso, no se enseña un 0.
 */
const maxProgreso = () => parseInt(process.env.MI_CAMPUS_MAX_PROGRESO || '300', 10);

/**
 * El % hecho de los alumnos de esos cursos: { alumnoId: { cursoId: % | null } }.
 *
 * Moodle lo da alumno por alumno (`core_enrol_get_users_courses`, la llamada de `cursosDe`),
 * pero de TODOS sus cursos a la vez: un alumno en dos cursos de la tutora cuesta una sola
 * llamada. Los cursos sin seguimiento de finalización no se preguntan: su «—» ya se sabe.
 */
export async function progresoDeAlumnos(conexion, cursos, opciones) {
  const conSeguimiento = new Set(cursos.filter((k) => k.seguimiento).map((k) => k.id));
  const ids = [...new Set(cursos.filter((k) => conSeguimiento.has(k.id)).flatMap((k) => k.alumnos.map((a) => a.id)))];
  const porAlumno = new Map();
  if (!ids.length) return { porAlumno, aviso: null };
  if (ids.length > maxProgreso()) {
    return { porAlumno, aviso: `Con más de ${maxProgreso()} alumnos en el campus no se lee el % hecho de cada uno.` };
  }
  let fallos = 0;
  await enTandas(ids, paralelo(), async (id) => {
    try {
      const suyos = await cursosDe(conexion, id, opciones);
      porAlumno.set(id, new Map(suyos.filter((k) => conSeguimiento.has(k.id)).map((k) => [k.id, k.progreso])));
    } catch {
      fallos += 1;
    }
  });
  return { porAlumno, aviso: fallos === ids.length ? 'No se ha podido leer el % hecho de los alumnos.' : null };
}

/** Como Promise.all, pero de `n` en `n`: un campus no aguanta 95 peticiones a la vez. */
async function enTandas(lista, n, fn) {
  const salida = new Array(lista.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (i < lista.length) {
      const k = i++;
      salida[k] = await fn(lista[k]);
    }
  }));
  return salida;
}

const mensaje = (err, porDefecto) => (err instanceof MoodleError ? err.message : porDefecto);

/** Los campus de la tutora, con su usuario de Moodle. */
async function campusDeLaTutora(tutorId) {
  const { rows } = await query(
    `SELECT tc.project_id, tc.moodle_user_id, p.nombre AS campus, tc.error
       FROM tutor_campus tc JOIN projects p ON p.id = tc.project_id AND p.active
      WHERE tc.tutor_id = $1 AND tc.estado = 'activa' AND tc.moodle_user_id IS NOT NULL
      ORDER BY p.nombre`, [tutorId]);
  return rows.map((r) => ({
    projectId: Number(r.project_id), moodleId: Number(r.moodle_user_id), campus: r.campus,
    // Lo que dijo la última comprobación (p. ej. «el correo apunta a otra cuenta»): con la
    // cuenta vinculada equivocada no sale ningún curso, y la tutora tiene que saber por qué.
    aviso: r.error || null,
  }));
}

/**
 * Los campus que tiene asignados y en los que su cuenta de Moodle no está: para que lo
 * sepa y sepa a quién pedirlo, en vez de no ver el campus sin explicación.
 */
async function campusSinConectar(tutorId) {
  const { rows } = await query(
    `SELECT tc.project_id, p.nombre AS campus, tc.estado, tc.error, tc.moodle_user_id
       FROM tutor_campus tc JOIN projects p ON p.id = tc.project_id AND p.active
      WHERE tc.tutor_id = $1 AND (tc.moodle_user_id IS NULL OR tc.estado <> 'activa')
      ORDER BY p.nombre`, [tutorId]);
  return rows.map((r) => ({
    projectId: Number(r.project_id), campus: r.campus, estado: r.estado,
    // Sin cuenta vinculada, lo que pasa es que su correo del CRM no lleva a ninguna (aunque
    // antes estuviera activa); con cuenta, que esa cuenta está suspendida o fuera del campus.
    motivo: r.error || (r.moodle_user_id == null
      ? 'No encontramos tu cuenta de Moodle con tu correo del CRM.'
      : 'Tu cuenta de este campus está dada de baja o suspendida.'),
  }));
}

/** Sus consultas abiertas en ese campus. */
async function dudasAbiertas(tutorId, projectId) {
  const { rows } = await query(
    `SELECT id, alumno_moodle_id, alumno_nombre, COALESCE(espera_desde, entrada_at) AS desde
       FROM consultas WHERE tutor_id = $1 AND project_id = $2 AND estado = 'abierta'
      ORDER BY COALESCE(espera_desde, entrada_at)`, [tutorId, projectId]);
  return rows.map((r) => ({
    consultaId: Number(r.id), alumnoId: r.alumno_moodle_id ? Number(r.alumno_moodle_id) : null,
    alumno: r.alumno_nombre, desde: r.desde,
  }));
}

/** Lo que tiene pendiente por desarrollar (#336): sin cerrar ni cancelar. */
async function pendientesDeDesarrollar(tutorId) {
  const { rows } = await query(
    `SELECT cp.id, cp.nombre, cp.tipo, cp.estado, cp.fecha_comprometida, cp.avance_foto, cp.avance_video,
            cp.avance_modulos, cp.project_id, p.nombre AS campus
       FROM cursos_pendientes cp JOIN projects p ON p.id = cp.project_id
      WHERE cp.tutor_id = $1 AND cp.estado NOT IN ('cerrado', 'cancelado')
      ORDER BY cp.fecha_comprometida NULLS LAST, cp.id`, [tutorId]);
  return rows.map((r) => ({
    id: Number(r.id), nombre: r.nombre, tipo: r.tipo, estado: r.estado, campus: r.campus,
    projectId: r.project_id == null ? null : Number(r.project_id),
    fechaComprometida: r.fecha_comprometida,
    avance: { foto: r.avance_foto, video: r.avance_video, modulos: Number(r.avance_modulos) || 0 },
  }));
}

/**
 * Los mensajes privados de Moodle que esperan su respuesta y que el CRM no tiene ya (ese
 * último mensaje no está en ninguna consulta y el alumno no tiene una duda abierta con ella,
 * que ya sale como duda). Si Moodle no los da, se dice y el resto del campus sigue.
 */
async function mensajesSinResponder(conexion, c, dudas, opciones) {
  let lista;
  try {
    lista = await conversacionesSinResponder(conexion, c.moodleId, opciones);
  } catch (err) {
    return { lista: [], aviso: `No se han podido leer tus mensajes de Moodle: ${mensaje(err, 'el campus no ha contestado.')}` };
  }
  if (!lista.length) return { lista, aviso: null };
  const { rows } = await query(
    `SELECT externo_id FROM consulta_mensajes WHERE project_id = $1 AND externo_id = ANY($2::bigint[])`,
    [c.projectId, lista.map((x) => x.mensajeId)]);
  const enElCrm = new Set(rows.map((r) => Number(r.externo_id)));
  const conDuda = new Set(dudas.map((d) => d.alumnoId).filter(Boolean));
  return {
    lista: lista.filter((x) => !enElCrm.has(x.mensajeId) && !conDuda.has(x.alumnoId)),
    aviso: null,
  };
}

/** Un campus: sus cursos de profesora, cada uno con alumnos, dudas y tareas por corregir. */
async function unCampus(tutorId, c, { conProgreso = true, conMensajes = true, ...opciones } = {}) {
  const base = {
    projectId: c.projectId, campus: c.campus, url: null, error: null, aviso: c.aviso || null,
    cursos: [], dudasSinCurso: [], sinResponderSinCurso: [], avisoMensajes: null,
  };
  const conexion = await conexionDelCampus(c.projectId);
  if (!conexion) return { ...base, error: 'Este campus no está conectado en Integraciones.' };
  if (conexion.error) return { ...base, error: conexion.error };
  const url = urlDelCampus(conexion.url);
  base.url = url;

  let cursos;
  try {
    cursos = await cursosDe(conexion, c.moodleId, opciones);
  } catch (err) {
    return { ...base, error: mensaje(err, 'No se han podido leer sus cursos del campus.') };
  }

  // Los matriculados de cada curso; solo quedan los cursos donde es profesora.
  const conGente = await enTandas(cursos, paralelo(), async (curso) => {
    try {
      const gente = await matriculadosDe(conexion, curso.id, opciones);
      const yo = gente.find((g) => g.id === c.moodleId);
      if (!yo || !yo.roles.some((r) => esRolDeTutora(r))) return null;
      return { ...curso, alumnos: alumnosDe(gente, yo), error: null };
    } catch (err) {
      return { ...curso, alumnos: [], error: mensaje(err, 'No se han podido leer sus alumnos.') };
    }
  });
  const imparte = conGente.filter(Boolean);

  // Las tareas y sus entregas sin corregir, por tandas de cursos (`CURSOS_POR_TANDA`).
  const { tareas, entregas, sinPermiso, errorDe } = await tareasPorTandas(conexion, imparte.map((x) => x.id), opciones);

  const { porAlumno, aviso: avisoProgreso } = conProgreso
    ? await progresoDeAlumnos(conexion, imparte, opciones)
    : { porAlumno: new Map(), aviso: null };

  const dudas = await dudasAbiertas(tutorId, c.projectId);
  const { lista: mensajes, aviso: avisoMensajes } = conMensajes
    ? await mensajesSinResponder(conexion, c, dudas, opciones)
    : { lista: [], aviso: null };
  base.avisoMensajes = avisoMensajes;
  const usadas = new Set();
  const mensajesUsados = new Set();
  base.cursos = imparte.map((curso) => {
    const alumnos = new Map(curso.alumnos.map((a) => [a.id, a]));
    const susDudas = dudas.filter((d) => d.alumnoId && alumnos.has(d.alumnoId) && !usadas.has(d.consultaId));
    susDudas.forEach((d) => usadas.add(d.consultaId));
    // Cada mensaje en el primer curso suyo donde está el alumno (como las dudas).
    const susMensajes = mensajes.filter((m) => alumnos.has(m.alumnoId) && !mensajesUsados.has(m.conversacionId));
    susMensajes.forEach((m) => mensajesUsados.add(m.conversacionId));
    const susTareas = (tareas.get(curso.id) || []).map((t) => {
      const sin = (entregas.get(t.id) || []).filter((e) => alumnos.has(e.alumnoId))
        .map((e) => ({
          ...e, alumno: alumnos.get(e.alumnoId)?.nombre || null,
          // Esa entrega, abierta en el calificador de Moodle.
          corregirUrl: `${url}/mod/assign/view.php?id=${t.cmid}&action=grader&userid=${e.alumnoId}`,
        }));
      return {
        // En grupo, Moodle guarda la entrega a nombre del grupo: no se cuenta aquí, se corrige allí.
        id: t.id, nombre: t.nombre, entrega: t.entrega, sinCorregir: t.enGrupo ? [] : sin, notaMax: t.notaMax,
        // «Recordarme calificar antes de» (#769): adelanta el aviso a administración.
        calificarAntes: t.calificarAntes || null,
        enGrupo: Boolean(t.enGrupo), calificable: Boolean(t.calificable),
        corregirUrl: `${url}/mod/assign/view.php?id=${t.cmid}&action=grading`,
      };
    });
    const avisoPermiso = sinPermiso.has(curso.id)
      ? 'Moodle no deja leer las tareas de este curso con el token del campus: revisa sus permisos.' : null;
    return {
      id: curso.id, nombre: curso.nombre, url: `${url}/course/view.php?id=${curso.id}`, error: curso.error || errorDe.get(curso.id) || avisoPermiso,
      // Sin seguimiento de finalización, el % de sus alumnos es «—» (no 0 %).
      seguimiento: Boolean(curso.seguimiento),
      avisoProgreso: curso.seguimiento ? avisoProgreso : null,
      alumnos: curso.alumnos
        .map((a) => ({
          id: a.id, nombre: a.nombre, email: a.email, ultimoAcceso: a.ultimoAcceso,
          progreso: curso.seguimiento ? (porAlumno.get(a.id)?.get(curso.id) ?? null) : null,
          mensajeUrl: `${url}/message/index.php?id=${a.id}`,
        }))
        .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es')),
      dudas: susDudas,
      sinResponder: susMensajes.map((m) => mensajeParaVer(m, url, alumnos)),
      tareas: susTareas,
    };
  }).sort((a, b) => porHacer(b) - porHacer(a)
    || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
  base.dudasSinCurso = dudas.filter((d) => !usadas.has(d.consultaId));
  // De alguien que no está (o ya no está) en sus cursos: también espera, sale aparte.
  base.sinResponderSinCurso = mensajes.filter((m) => !mensajesUsados.has(m.conversacionId))
    .map((m) => mensajeParaVer(m, url, new Map()));
  return base;
}

/** Un mensaje sin responder tal como lo enseña «Mi campus»: quién, desde cuándo y dónde contestarlo. */
function mensajeParaVer(m, url, alumnos) {
  return {
    conversacionId: m.conversacionId, alumnoId: m.alumnoId,
    alumno: alumnos.get(m.alumnoId)?.nombre || m.alumno || null,
    desde: m.desde,
    // La conversación, abierta en la mensajería del campus.
    responderUrl: `${url}/message/index.php?convid=${m.conversacionId}`,
  };
}

/**
 * Las tareas de esos cursos y sus entregas por corregir, de `CURSOS_POR_TANDA` en
 * `CURSOS_POR_TANDA` cursos. Lo que falla en una tanda se apunta a sus cursos (`errorDe`)
 * y no borra lo que ya se ha leído de las demás.
 */
export async function tareasPorTandas(conexion, cursoIds, opciones) {
  const tareas = new Map();
  const entregas = new Map();
  const sinPermiso = new Set();
  const errorDe = new Map();
  for (let i = 0; i < cursoIds.length; i += CURSOS_POR_TANDA) {
    const tanda = cursoIds.slice(i, i + CURSOS_POR_TANDA);
    try {
      const t = await tareasDeCursos(conexion, tanda, opciones);
      const e = await entregasSinCorregir(conexion, [...t.values()].flat().map((x) => x.id), opciones);
      for (const [k, v] of t) tareas.set(k, v);
      for (const id of t.sinPermiso || []) sinPermiso.add(id);
      for (const [k, v] of e) entregas.set(k, v);
    } catch (err) {
      const m = mensaje(err, 'No se han podido leer las tareas del campus.');
      for (const id of tanda) errorDe.set(id, m);
    }
  }
  return { tareas, entregas, sinPermiso, errorDe };
}

/** Lo que tiene pendiente un curso: entregas por corregir, dudas abiertas y mensajes sin responder. */
const porHacer = (curso) => curso.tareas.reduce((n, t) => n + t.sinCorregir.length, 0) + curso.dudas.length
  + (curso.sinResponder?.length || 0);

/** Tras corregir: que «Mi campus» no enseñe la copia de antes de la nota (de ningún campus suyo). */
export function olvidarMiCampus(tutorId) {
  for (const clave of [...cache.keys()]) {
    if (clave.startsWith(`${tutorId}:`)) cache.delete(clave);
  }
}

/** Un campus leído de Moodle; si falla entero, el campus sale con su error y los demás siguen. */
async function leerUnCampus(tutorId, c, opciones) {
  try {
    return await unCampus(tutorId, c, opciones);
  } catch (err) {
    logger.warn({ tutorId, projectId: c.projectId, err: err.message }, 'tutores/mi-campus: fallo al leer el campus');
    return {
      projectId: c.projectId, campus: c.campus, url: null, error: 'No se ha podido leer este campus.', aviso: c.aviso || null,
      cursos: [], dudasSinCurso: [], sinResponderSinCurso: [], avisoMensajes: null,
    };
  }
}

/** ¿Algo de lo leído ha fallado? Entonces la copia dura poco: al volver se lee otra vez. */
export const conFallos = (datos) => Boolean(datos.error || datos.avisoMensajes || datos.cursos.some((k) => k.error));

/**
 * Sus campus leídos de Moodle, sin copia. Con `conProgreso: false`, sin el % hecho de cada
 * alumno (una llamada por alumno): el aviso de entregas sin corregir no lo necesita. Con
 * `conMensajes: false`, sin leer sus mensajes privados.
 */
export async function leerSusCampus(tutorId, opciones = {}) {
  const campus = [];
  for (const c of await campusDeLaTutora(tutorId)) campus.push(await leerUnCampus(tutorId, c, opciones));
  return campus;
}

/**
 * La copia de dos minutos es para no castigar a Moodle; las dudas son del CRM. Una que ya
 * no espera (contestada desde el CRM o en Moodle, cerrada, o pasada a otra tutora) no puede
 * seguir saliendo «sin contestar» hasta que caduque la copia (#850).
 */
async function sinLasYaAtendidas(tutorId, datos) {
  const { rows } = await query(
    `SELECT id, project_id, alumno_moodle_id FROM consultas WHERE tutor_id = $1 AND estado = 'abierta'`, [tutorId]);
  const abiertas = new Set(rows.map((r) => Number(r.id)));
  const espera = (d) => abiertas.has(d.consultaId);
  // Un mensaje de Moodle cuyo alumno ya tiene una duda abierta con ella sale como esa duda.
  const conDuda = new Set(rows.filter((r) => r.alumno_moodle_id != null).map((r) => `${r.project_id}:${r.alumno_moodle_id}`));
  const sinDuda = (projectId) => (m) => !conDuda.has(`${projectId}:${m.alumnoId}`);
  return {
    ...datos,
    campus: datos.campus.map((c) => ({
      ...c,
      dudasSinCurso: c.dudasSinCurso.filter(espera),
      sinResponderSinCurso: (c.sinResponderSinCurso || []).filter(sinDuda(c.projectId)),
      cursos: c.cursos.map((k) => ({
        ...k, dudas: k.dudas.filter(espera), sinResponder: (k.sinResponder || []).filter(sinDuda(c.projectId)),
      })),
    })),
  };
}

/**
 * Los campus pedidos, de entre los suyos. Sin pedir nada (o nada válido), todos: lo de
 * otra tutora o un campus que no es suyo no se lee, se ignora.
 */
export function campusElegidos(suyos, pedidos) {
  const ids = new Set((Array.isArray(pedidos) ? pedidos : []).map(Number).filter((n) => Number.isInteger(n) && n > 0));
  if (!ids.size) return { elegidos: suyos, filtro: null };
  const elegidos = suyos.filter((c) => ids.has(c.projectId));
  return elegidos.length ? { elegidos, filtro: new Set(elegidos.map((c) => c.projectId)) } : { elegidos: suyos, filtro: null };
}

/**
 * Todo «Mi campus» de una tutora. Con `refrescar`, sin la copia de dos minutos. Con
 * `campus` (ids de proyecto), solo esos campus suyos: lo demás ni se lee de Moodle.
 */
export async function miCampus(tutorId, { refrescar = false, campus: pedidos = null, ...opciones } = {}) {
  const suyos = await campusDeLaTutora(tutorId);
  const { elegidos, filtro } = campusElegidos(suyos, pedidos);
  const campus = [];
  let leidoAt = null;
  for (const c of elegidos) {
    const clave = `${tutorId}:${c.projectId}`;
    const guardado = cache.get(clave);
    let entrada = guardado;
    const dura = guardado && conFallos(guardado.datos) ? CACHE_CON_FALLOS_MS : CACHE_MS;
    if (refrescar || !guardado || Date.now() - guardado.at >= dura) {
      entrada = { at: Date.now(), datos: await leerUnCampus(tutorId, c, opciones) };
      cache.set(clave, entrada);
    }
    campus.push(entrada.datos);
    // «Leído a las…»: la hora de lo más antiguo que se enseña, no la de ahora.
    if (leidoAt === null || entrada.at < leidoAt) leidoAt = entrada.at;
  }
  const pendientes = (await pendientesDeDesarrollar(tutorId))
    .filter((p) => !filtro || p.projectId == null || filtro.has(p.projectId));
  const sinConectar = (await campusSinConectar(tutorId))
    .filter((s) => !filtro || filtro.has(s.projectId));
  return sinLasYaAtendidas(tutorId, {
    leidoAt: new Date(leidoAt ?? Date.now()).toISOString(),
    campus,
    pendientes,
    sinConectar,
    // Para el selector: todos los campus conectados de la tutora, también los no elegidos.
    todosLosCampus: suyos.map((c) => ({ projectId: c.projectId, campus: c.campus })),
    elegidos: filtro ? [...filtro] : null,
  });
}
