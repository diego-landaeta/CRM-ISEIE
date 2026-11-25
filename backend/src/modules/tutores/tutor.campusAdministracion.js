/*
  «MI CAMPUS» DE ADMINISTRACIÓN, gemela de la del CRM (Diego, 25/11: «que los admin puedan verlo también y los
  superadmin»).

  La vista de la tutora (tutor.micampus.js) enseña los cursos donde SU cuenta de Moodle es
  profesora. Administración no da clase: revisa el campus entero (Bárbara, en ISEIE, revisa
  los 314 cursos y no está matriculada en ninguno). Con `tutores.campus_administracion`:

    · los campus de su alcance (`user_projects`; super admin y soporte, todos) que tienen el
      Moodle conectado en Integraciones;
    · TODO el campus, leído con el token del campus (`conexionDelCampus`), nunca con una
      cuenta personal: las entregas por corregir (la más antigua primero, con la profesora
      del curso), las consultas abiertas del CRM y los mensajes de Moodle sin responder de
      las tutoras enlazadas en el CRM;
    · los alumnos de un curso, con su % hecho, solo al abrir ese curso (`cursoDeAdministracion`).

  SOLO LEE. Responder y corregir siguen siendo de la profesora: si quien mira tiene además
  su cuenta enlazada y es profesora de ese curso, `puedoCorregir` lo dice y se corrige como
  siempre (tutor.correccion.js, que lo vuelve a comprobar). Si no, «Abrir en Moodle». Nunca
  se envía ni se califica con la cuenta del token en nombre de nadie.

  Para no tumbar el Moodle (ISEIE: 314 cursos; con todo a la vez da «dbconnectionfailed»):
    · un campus cada vez (el que se elige) y el % de los alumnos solo del curso que se abre;
    · las tareas por tandas de cursos y de dos en dos (tareasPorTandas, enTandas), con los
      reintentos de moodle.client;
    · una copia por campus de 5 minutos, la MISMA para toda administración (lo de Moodle no
      cambia según quién mire), y una sola lectura en marcha por campus: si dos personas lo
      abren a la vez, la segunda espera a la primera;
    · «Actualizar» no vuelve a leer si la copia tiene menos de 20 s;
    · si la lectura tarda más de lo que espera la petición, se contesta `leyendo` (con la
      copia anterior, si la hay) y la pantalla vuelve a preguntar.

  Medido en producción de ISEIE (25/11, solo lectura): 314 cursos, 54 llamadas, ~14 s.
*/
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import {
  cursosDelCampus, matriculadosDe, esAlumno, esRolDeTutora, urlDelCampus, MoodleError, conversacionesSinResponder,
} from '../../shared/services/moodle.client.js';
import { campusParaRecortar } from '../../shared/utils/ambito.js';
import { conexionDelCampus } from './tutor.campus.js';
import {
  tareasPorTandas, progresoDeAlumnos, enTandas, paralelo,
} from './tutor.micampus.js';

const MIN = 60 * 1000;
const env = (nombre, porDefecto) => {
  const n = parseInt(process.env[nombre] ?? '', 10);
  return Number.isInteger(n) && n >= 0 ? n : porDefecto;
};
/** Lo que dura la copia de un campus entero, y la de uno con algún fallo. */
const copiaCampus = () => env('MI_CAMPUS_ADMIN_CACHE_MS', 5 * MIN);
const COPIA_CON_FALLOS_MS = 30 * 1000;
/** La de un curso abierto (alumnos y su %). */
const COPIA_CURSO_MS = 2 * MIN;
/** «Actualizar» antes de esto devuelve la copia: no se relee el campus entero a golpe de clic. */
const MIN_ENTRE_LECTURAS_MS = 20 * 1000;
/** Lo que espera la petición a que acabe la lectura antes de contestar «leyendo». */
const espera = () => env('MI_CAMPUS_ADMIN_ESPERA_MS', 20 * 1000);

/** projectId → { at, datos } y projectId → la lectura en marcha. */
const copias = new Map();
const enMarcha = new Map();
/** `${projectId}:${cursoId}` → { at, datos }. */
const copiasCurso = new Map();

const mensaje = (err, porDefecto) => (err instanceof MoodleError ? err.message : porDefecto);

/** Para las pruebas: empezar sin copias. */
export function olvidarCopias() {
  copias.clear();
  enMarcha.clear();
  copiasCurso.clear();
}

/** Los campus de su alcance con el Moodle conectado. */
export async function campusDeAdministracion(req) {
  const recorte = await campusParaRecortar(req);
  const { rows } = await query(
    `SELECT p.id, p.nombre
       FROM projects p
       JOIN project_integrations pi ON pi.project_id = p.id AND pi.provider = 'moodle'
        AND pi.active AND pi.encrypted_value IS NOT NULL
      WHERE p.active AND ($1::int[] IS NULL OR p.id = ANY($1::int[]))
      ORDER BY p.nombre`, [recorte]);
  return rows.map((r) => ({ projectId: Number(r.id), campus: r.nombre }));
}

/** El campus pedido, si es de su alcance y está conectado; si no, 404 (no se confirma que exista). */
async function exigirCampus(req, projectId) {
  const c = (await campusDeAdministracion(req)).find((x) => x.projectId === Number(projectId));
  if (!c) throw new AppError('Ese campus no está entre los tuyos o no tiene el Moodle conectado', 404, 'NOT_FOUND');
  return c;
}

/** Las tutoras enlazadas en ese campus (cuenta de Moodle activa): de ellas salen los mensajes sin responder. */
async function tutorasEnlazadas(projectId) {
  const { rows } = await query(
    `SELECT tc.tutor_id, tc.moodle_user_id, u.nombre
       FROM tutor_campus tc JOIN users u ON u.id = tc.tutor_id
      WHERE tc.project_id = $1 AND tc.estado = 'activa' AND tc.moodle_user_id IS NOT NULL AND u.active
      ORDER BY u.nombre`, [projectId]);
  return rows.map((r) => ({ tutorId: Number(r.tutor_id), moodleId: Number(r.moodle_user_id), nombre: r.nombre }));
}

/**
 * El campus entero leído de Moodle con el token del campus. Lo mismo para toda
 * administración: aquí no entra nada de quien mira (eso va en `paraLaPersona`).
 */
export async function leerCampusEntero(c, opciones = {}) {
  const base = {
    projectId: c.projectId, campus: c.campus, url: null, error: null, avisos: [],
    cursos: [], entregas: [], mensajes: [], tareasEnGrupo: 0,
  };
  const conexion = await conexionDelCampus(c.projectId);
  if (!conexion) return { ...base, error: 'Este campus no está conectado en Integraciones.' };
  if (conexion.error) return { ...base, error: conexion.error };
  const url = urlDelCampus(conexion.url);
  base.url = url;

  let cursos;
  try {
    cursos = await cursosDelCampus(conexion, opciones);
  } catch (err) {
    return { ...base, error: mensaje(err, 'No se ha podido leer la lista de cursos del campus.') };
  }

  // Las tareas y sus entregas por corregir, de los cursos visibles (los ocultos no se están dando).
  const visibles = cursos.filter((k) => k.visible);
  const { tareas, entregas, sinPermiso, errorDe } = await tareasPorTandas(conexion, visibles.map((k) => k.id), opciones);

  const nombreDe = new Map(cursos.map((k) => [k.id, k.nombre]));
  const porCurso = new Map();
  for (const [cursoId, lista] of tareas) {
    for (const t of lista) {
      const suyas = entregas.get(t.id) || [];
      // En grupo, Moodle la guarda a nombre del grupo: se cuenta y se corrige allí.
      if (t.enGrupo) { if (suyas.length) base.tareasEnGrupo += 1; continue; }
      for (const e of suyas) {
        if (!porCurso.has(cursoId)) porCurso.set(cursoId, []);
        porCurso.get(cursoId).push({
          cursoId, curso: nombreDe.get(cursoId) || null, tareaId: t.id, tarea: t.nombre,
          alumnoId: e.alumnoId, alumno: null, entregadaAt: e.entregadaAt,
          corregirUrl: `${url}/mod/assign/view.php?id=${t.cmid}&action=grader&userid=${e.alumnoId}`,
          tareaUrl: `${url}/mod/assign/view.php?id=${t.cmid}`,
        });
      }
    }
  }

  // Quién es cada alumno y quién da clase: solo en los cursos con algo por corregir, de dos en dos.
  const profesorasDe = new Map();
  const fallosDe = new Map();
  await enTandas([...porCurso.keys()], paralelo(), async (cursoId) => {
    let gente;
    try {
      gente = await matriculadosDe(conexion, cursoId, opciones);
    } catch (err) {
      fallosDe.set(cursoId, mensaje(err, 'No se han podido leer sus alumnos.'));
      // Sin saber quién es, la entrega se enseña igual: mejor de más que esconderla.
      base.entregas.push(...porCurso.get(cursoId));
      return;
    }
    const alumnos = new Map(gente.filter(esAlumno).map((g) => [g.id, g.nombre]));
    profesorasDe.set(cursoId, gente.filter((g) => g.roles.some((r) => esRolDeTutora(r)))
      .map((g) => ({ id: g.id, nombre: g.nombre })));
    // Solo matrículas activas de alumno, como «Mi campus» de la tutora.
    for (const e of porCurso.get(cursoId)) {
      if (alumnos.has(e.alumnoId)) base.entregas.push({ ...e, alumno: alumnos.get(e.alumnoId) });
    }
  });
  for (const e of base.entregas) e.profesoras = profesorasDe.get(e.cursoId) || [];
  // La más antigua primero; sin fecha, al final.
  base.entregas.sort((a, b) => (a.entregadaAt ? new Date(a.entregadaAt).getTime() : Infinity)
    - (b.entregadaAt ? new Date(b.entregadaAt).getTime() : Infinity));

  const cuantas = new Map();
  for (const e of base.entregas) cuantas.set(e.cursoId, (cuantas.get(e.cursoId) || 0) + 1);
  base.cursos = cursos.map((k) => ({
    id: k.id, nombre: k.nombre, visible: k.visible, seguimiento: k.seguimiento, url: `${url}/course/view.php?id=${k.id}`,
    porCorregir: cuantas.get(k.id) || 0,
    profesoras: profesorasDe.get(k.id) || null,
    error: errorDe.get(k.id) || fallosDe.get(k.id)
      || (sinPermiso.has(k.id) ? 'Moodle no deja leer las tareas de este curso con el token del campus: revisa sus permisos.' : null),
  })).sort((a, b) => b.porCorregir - a.porCorregir
    || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));

  // Los mensajes privados que esperan respuesta, de las tutoras enlazadas en el CRM (una a una).
  for (const t of await tutorasEnlazadas(c.projectId)) {
    try {
      for (const m of await conversacionesSinResponder(conexion, t.moodleId, opciones)) {
        base.mensajes.push({
          conversacionId: m.conversacionId, mensajeId: m.mensajeId, alumnoId: m.alumnoId, alumno: m.alumno,
          desde: m.desde, tutoraId: t.tutorId, tutora: t.nombre,
          responderUrl: `${url}/message/index.php?convid=${m.conversacionId}`,
        });
      }
    } catch (err) {
      base.avisos.push(`No se han podido leer los mensajes de Moodle de ${t.nombre}: ${mensaje(err, 'el campus no ha contestado.')}`);
    }
  }
  base.mensajes.sort((a, b) => new Date(a.desde).getTime() - new Date(b.desde).getTime());
  return base;
}

/** ¿Algo ha fallado? Entonces la copia dura poco. */
const conFallos = (d) => Boolean(d.error || d.avisos.length || d.cursos.some((k) => k.error));

async function leerSinRomper(c, opciones) {
  try {
    return await leerCampusEntero(c, opciones);
  } catch (err) {
    logger.warn({ projectId: c.projectId, err: err.message }, 'tutores/mi-campus-administracion: fallo al leer el campus');
    return {
      projectId: c.projectId, campus: c.campus, url: null, error: 'No se ha podido leer este campus.', avisos: [],
      cursos: [], entregas: [], mensajes: [], tareasEnGrupo: 0,
    };
  }
}

/**
 * La copia del campus o una lectura nueva (una sola en marcha por campus). Si no acaba en
 * `esperaMs`, `{ leyendo: true, copia }` con la copia anterior (o null).
 */
export async function campusConCopia(c, { refrescar = false, esperaMs = espera(), ...opciones } = {}) {
  const guardado = copias.get(c.projectId);
  const edad = guardado ? Date.now() - guardado.at : Infinity;
  const dura = guardado && conFallos(guardado.datos) ? COPIA_CON_FALLOS_MS : copiaCampus();
  if (guardado && (edad < MIN_ENTRE_LECTURAS_MS || (!refrescar && edad < dura))) {
    return { leyendo: false, copia: guardado };
  }
  let lectura = enMarcha.get(c.projectId);
  if (!lectura) {
    lectura = leerSinRomper(c, opciones).then((datos) => {
      const entrada = { at: Date.now(), datos };
      copias.set(c.projectId, entrada);
      return entrada;
    }).finally(() => enMarcha.delete(c.projectId));
    enMarcha.set(c.projectId, lectura);
  }
  let reloj;
  const tarde = new Promise((r) => { reloj = setTimeout(() => r(null), esperaMs); });
  const hecho = await Promise.race([lectura, tarde]);
  clearTimeout(reloj);
  return hecho ? { leyendo: false, copia: hecho } : { leyendo: true, copia: guardado || null };
}

/** Su cuenta de Moodle en ese campus, si está enlazada y puede corregir desde el CRM. */
async function miCuentaEn(userId, projectId) {
  const { rows } = await query(
    `SELECT moodle_user_id, admin_sitio_excepcion_at, admin_sitio_permitida FROM tutor_campus
      WHERE tutor_id = $1 AND project_id = $2 AND estado = 'activa' AND moodle_user_id IS NOT NULL`,
    [userId, projectId]);
  const r = rows[0];
  if (!r) return null;
  // Con la cuenta de administración del sitio sin permitir, la nota va en Moodle (como en su vista).
  if (r.admin_sitio_excepcion_at != null && !r.admin_sitio_permitida) return null;
  return Number(r.moodle_user_id);
}

/** Las consultas abiertas del CRM en ese campus, de todas las tutoras. */
async function consultasAbiertas(projectId, url) {
  const { rows } = await query(
    `SELECT c.id, c.alumno_moodle_id, c.alumno_nombre, c.curso_moodle_id, c.curso_nombre,
            COALESCE(c.espera_desde, c.entrada_at) AS desde, c.conversacion_externa_id, c.conversacion_grupo_id,
            c.tutor_id, u.nombre AS tutora
       FROM consultas c LEFT JOIN users u ON u.id = c.tutor_id
      WHERE c.project_id = $1 AND c.estado = 'abierta'
      ORDER BY COALESCE(c.espera_desde, c.entrada_at)`, [projectId]);
  return rows.map((r) => {
    const conv = r.conversacion_grupo_id ?? r.conversacion_externa_id;
    const alumnoId = r.alumno_moodle_id != null ? Number(r.alumno_moodle_id) : null;
    return {
      consultaId: Number(r.id), alumnoId, alumno: r.alumno_nombre,
      cursoId: r.curso_moodle_id != null ? Number(r.curso_moodle_id) : null, curso: r.curso_nombre,
      desde: r.desde, tutoraId: r.tutor_id != null ? Number(r.tutor_id) : null, tutora: r.tutora,
      // Abrir en Moodle: la conversación, o la mensajería con el alumno.
      moodleUrl: !url ? null : (conv != null ? `${url}/message/index.php?convid=${conv}`
        : (alumnoId ? `${url}/message/index.php?id=${alumnoId}` : null)),
    };
  });
}

/**
 * Lo leído, para quien mira: las consultas del CRM al momento, los mensajes que el CRM ya
 * tiene fuera, y `puedoCorregir` donde es profesora con su cuenta enlazada.
 */
async function paraLaPersona(userId, datos) {
  const consultas = await consultasAbiertas(datos.projectId, datos.url);
  let mensajes = datos.mensajes;
  if (mensajes.length) {
    const { rows } = await query(
      'SELECT externo_id FROM consulta_mensajes WHERE project_id = $1 AND externo_id = ANY($2::bigint[])',
      [datos.projectId, mensajes.map((m) => m.mensajeId)]);
    const enElCrm = new Set(rows.map((r) => Number(r.externo_id)));
    const conConsulta = new Set(consultas.map((q) => q.alumnoId).filter(Boolean));
    mensajes = mensajes.filter((m) => !enElCrm.has(m.mensajeId) && !conConsulta.has(m.alumnoId));
  }
  const yo = await miCuentaEn(userId, datos.projectId);
  const soyProfesora = (profesoras) => yo != null && (profesoras || []).some((p) => p.id === yo);
  return {
    ...datos,
    consultas,
    mensajes,
    entregas: datos.entregas.map((e) => ({ ...e, puedoCorregir: soyProfesora(e.profesoras) })),
    cursos: datos.cursos.map((k) => ({ ...k, soyProfesora: soyProfesora(k.profesoras) })),
  };
}

/** ¿Tiene su propia cuenta enlazada en algún campus? Entonces también tiene «sus cursos». */
async function tieneCuentaEnlazada(userId) {
  const { rows } = await query(
    `SELECT 1 FROM tutor_campus WHERE tutor_id = $1 AND estado = 'activa' AND moodle_user_id IS NOT NULL LIMIT 1`, [userId]);
  return rows.length > 0;
}

/**
 * GET /tutores/mi-campus/administracion?campus=ID: sus campus y, del elegido (o el primero),
 * todo lo pendiente. Un campus cada vez.
 */
export async function campusAdministracion(req, { campus: pedido = null, refrescar = false, ...opciones } = {}) {
  const todos = await campusDeAdministracion(req);
  const salida = {
    todosLosCampus: todos, elegido: null, leyendo: false, leidoAt: null, campus: null,
    tengoCuentaEnlazada: await tieneCuentaEnlazada(req.user.userId),
  };
  if (!todos.length) return salida;
  const c = (pedido && todos.find((x) => x.projectId === Number(pedido))) || todos[0];
  salida.elegido = c.projectId;
  const { leyendo, copia } = await campusConCopia(c, { refrescar, ...opciones });
  salida.leyendo = leyendo;
  if (copia) {
    salida.leidoAt = new Date(copia.at).toISOString();
    salida.campus = await paraLaPersona(req.user.userId, copia.datos);
  }
  return salida;
}

/** La lista de cursos del campus: de la copia del campus si la hay; si no, se pide (una llamada). */
async function listaDeCursos(c, conexion, opciones) {
  const guardado = copias.get(c.projectId);
  if (guardado && !guardado.datos.error && guardado.datos.cursos.length) return guardado.datos.cursos;
  return cursosDelCampus(conexion, opciones);
}

/** Un curso leído de Moodle: profesoras, alumnos con su % hecho y sus tareas con lo que hay por corregir. */
async function leerCurso(c, curso, conexion, opciones) {
  const url = urlDelCampus(conexion.url);
  const base = {
    projectId: c.projectId, id: curso.id, nombre: curso.nombre, visible: curso.visible !== false,
    url: `${url}/course/view.php?id=${curso.id}`, seguimiento: null, avisoProgreso: null,
    profesoras: [], alumnos: [], tareas: [], error: null,
  };
  let gente;
  try {
    gente = await matriculadosDe(conexion, curso.id, opciones);
  } catch (err) {
    return { ...base, error: mensaje(err, 'No se han podido leer sus alumnos.') };
  }
  const alumnos = gente.filter(esAlumno);
  base.profesoras = gente.filter((g) => g.roles.some((r) => esRolDeTutora(r))).map((g) => ({ id: g.id, nombre: g.nombre }));
  // El seguimiento de finalización lo da la lista de cursos; si no viene, se pregunta igual.
  const seguimiento = curso.seguimiento !== false;
  const { porAlumno, aviso } = await progresoDeAlumnos(conexion, [{ id: curso.id, seguimiento, alumnos }], opciones);
  base.seguimiento = curso.seguimiento ?? null;
  base.avisoProgreso = aviso;
  base.alumnos = alumnos.map((a) => ({
    id: a.id, nombre: a.nombre, email: a.email, ultimoAcceso: a.ultimoAcceso,
    progreso: porAlumno.get(a.id)?.get(curso.id) ?? null,
    mensajeUrl: `${url}/message/index.php?id=${a.id}`,
  })).sort((x, y) => String(x.nombre || '').localeCompare(String(y.nombre || ''), 'es'));

  const { tareas, entregas, sinPermiso, errorDe } = await tareasPorTandas(conexion, [curso.id], opciones);
  const nombres = new Map(alumnos.map((a) => [a.id, a.nombre]));
  base.tareas = (tareas.get(curso.id) || []).map((t) => ({
    id: t.id, nombre: t.nombre, entrega: t.entrega, enGrupo: Boolean(t.enGrupo),
    tareaUrl: `${url}/mod/assign/view.php?id=${t.cmid}`,
    corregirUrl: `${url}/mod/assign/view.php?id=${t.cmid}&action=grading`,
    sinCorregir: t.enGrupo ? [] : (entregas.get(t.id) || []).filter((e) => nombres.has(e.alumnoId))
      .map((e) => ({
        alumnoId: e.alumnoId, alumno: nombres.get(e.alumnoId), entregadaAt: e.entregadaAt,
        corregirUrl: `${url}/mod/assign/view.php?id=${t.cmid}&action=grader&userid=${e.alumnoId}`,
      })),
  }));
  base.error = errorDe.get(curso.id)
    || (sinPermiso.has(curso.id) ? 'Moodle no deja leer las tareas de este curso con el token del campus: revisa sus permisos.' : null);
  return base;
}

/** GET /tutores/mi-campus/administracion/cursos/:projectId/:cursoId — un curso, al abrirlo. */
export async function cursoDeAdministracion(req, projectId, cursoId, { refrescar = false, ...opciones } = {}) {
  const c = await exigirCampus(req, projectId);
  const conexion = await conexionDelCampus(c.projectId);
  if (!conexion) throw new AppError('Este campus no está conectado en Integraciones', 409, 'SIN_CONEXION');
  if (conexion.error) throw new AppError(conexion.error, 409, 'SIN_CONEXION');
  const clave = `${c.projectId}:${Number(cursoId)}`;
  let guardado = copiasCurso.get(clave);
  const edad = guardado ? Date.now() - guardado.at : Infinity;
  if (!guardado || edad >= COPIA_CURSO_MS || (refrescar && edad >= MIN_ENTRE_LECTURAS_MS)) {
    let lista;
    try {
      lista = await listaDeCursos(c, conexion, opciones);
    } catch (err) {
      throw new AppError(mensaje(err, 'No se ha podido leer la lista de cursos del campus.'), 502, 'MOODLE');
    }
    const curso = lista.find((k) => k.id === Number(cursoId));
    if (!curso) throw new AppError('Ese curso no es de este campus', 404, 'NOT_FOUND');
    guardado = { at: Date.now(), datos: await leerCurso(c, curso, conexion, opciones) };
    copiasCurso.set(clave, guardado);
  }
  const datos = guardado.datos;
  const yo = await miCuentaEn(req.user.userId, c.projectId);
  const enElCurso = new Set(datos.alumnos.map((a) => a.id));
  const consultas = (await consultasAbiertas(c.projectId, urlDelCampus(conexion.url)))
    .filter((q) => q.cursoId === datos.id || (q.alumnoId && enElCurso.has(q.alumnoId)));
  return {
    ...datos,
    leidoAt: new Date(guardado.at).toISOString(),
    soyProfesora: yo != null && datos.profesoras.some((p) => p.id === yo),
    consultas,
  };
}
