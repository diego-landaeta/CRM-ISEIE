/*
  El campus (Moodle) de un proyecto, visto desde el CRM (#187).

  Consultas de alumnos necesita hablar con el Moodle de cada campus. Para la fase 1
  basta con dos preguntas, las dos de solo lectura:

    · ¿el token vale?            core_webservice_get_site_info
    · ¿este correo es usuario?   core_user_get_users_by_field (field = email)

  Cada campus se da de alta en Integraciones de su proyecto (provider «moodle»):
  la dirección del campus va en `config_public.url` y el token, cifrado, como el
  resto de claves (#185: «Integraciones por proyecto… ahí se da de alta cada
  campus»). Nunca viaja al navegador.

  Las funciones las tiene que tener el servicio externo del token en el Moodle;
  si falta una, Moodle contesta con una excepción y aquí se traduce a algo que se
  entienda, no a «error».
*/

const TIEMPO_MAXIMO_MS = parseInt(process.env.MOODLE_TIMEOUT_MS || '10000', 10);

/** Las funciones que necesita el CRM en el servicio del token. */
export const FUNCIONES_NECESARIAS = ['core_webservice_get_site_info', 'core_user_get_users_by_field'];

/** Error con un mensaje para enseñar tal cual y un código para decidir. */
export class MoodleError extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.codigo = codigo;
  }
}

/** La dirección del campus, sin barra al final y sin «/webservice/…» si la pegaron entera. */
export function urlDelCampus(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  u = u.replace(/\/webservice\/rest\/server\.php.*$/i, '').replace(/\/+$/, '');
  return u;
}

/**
 * Una llamada a la API REST de Moodle.
 *
 * Moodle contesta 200 también cuando falla: el fallo viene dentro, como
 * `{ exception, errorcode, message }`. Por eso se mira el cuerpo, no el estado.
 */
export async function llamar({ url, token }, funcion, parametros = {}, { fetchImpl = fetch } = {}) {
  const base = urlDelCampus(url);
  if (!base) throw new MoodleError('Falta la dirección del campus.', 'SIN_URL');
  if (!token) throw new MoodleError('Falta el token del campus.', 'SIN_TOKEN');

  const cuerpo = new URLSearchParams({ wstoken: token, wsfunction: funcion, moodlewsrestformat: 'json' });
  for (const [k, v] of Object.entries(parametros)) cuerpo.append(k, String(v));

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS);
  let r;
  try {
    r = await fetchImpl(`${base}/webservice/rest/server.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: cuerpo.toString(),
      signal: control.signal,
    });
  } catch (err) {
    const tarde = err?.name === 'AbortError';
    throw new MoodleError(
      tarde ? `El campus no ha contestado en ${Math.round(TIEMPO_MAXIMO_MS / 1000)} s.` : `No se ha podido llegar al campus (${base}).`,
      tarde ? 'TIEMPO' : 'SIN_RED');
  } finally {
    clearTimeout(reloj);
  }

  if (!r.ok) throw new MoodleError(`El campus ha contestado con un error HTTP ${r.status}.`, 'HTTP');
  let datos;
  try { datos = await r.json(); } catch {
    throw new MoodleError('El campus no ha contestado como un Moodle: revisa la dirección.', 'NO_ES_MOODLE');
  }
  if (datos && typeof datos === 'object' && !Array.isArray(datos) && datos.exception) {
    throw traducir(datos, funcion);
  }
  return datos;
}

/** Lo que dice Moodle, en palabras de quien tiene que arreglarlo. */
function traducir(datos, funcion) {
  const codigo = datos.errorcode || '';
  if (codigo === 'invalidtoken') return new MoodleError('El token del campus no vale (caducado o mal copiado).', 'TOKEN');
  if (codigo === 'accessexception' || codigo === 'servicerequireslogin') {
    return new MoodleError(`El token no tiene permiso para «${funcion}»: añádela al servicio del token en el campus.`, 'PERMISO');
  }
  if (codigo === 'webservicesnotenabled' || codigo === 'enablewsdescription') {
    return new MoodleError('El campus tiene los servicios web apagados.', 'WS_APAGADOS');
  }
  if (/invalidrecord|function.*not.*found|codingerror/i.test(`${codigo} ${datos.message || ''}`)) {
    return new MoodleError(`El servicio del token no tiene la función «${funcion}».`, 'SIN_FUNCION');
  }
  return new MoodleError(`El campus ha dicho: ${datos.message || codigo || 'error sin detalle'}.`, 'MOODLE');
}

/** «¿El token vale?» Devuelve el nombre del sitio, la versión y si están las funciones. */
export async function infoDelCampus(conexion, opciones) {
  const info = await llamar(conexion, 'core_webservice_get_site_info', {}, opciones);
  const tiene = new Set((info?.functions || []).map((f) => f.name));
  return {
    sitio: info?.sitename || null,
    version: info?.release || null,
    // Sin la lista (algunos Moodle no la dan) no se puede decir que falte nada.
    faltan: info?.functions ? FUNCIONES_NECESARIAS.filter((f) => !tiene.has(f)) : [],
    // Las de leer la mensajería (#188): solo cuentan si el campus lee consultas.
    // y las de los matriculados (#189), que también usa leer consultas.
    faltanConsultas: info?.functions ? [...FUNCIONES_CONSULTAS, ...FUNCIONES_ALUMNOS].filter((f) => !tiene.has(f)) : [],
  };
}

/**
 * El usuario del campus con ese correo, o null si no hay ninguno.
 *
 * Moodle busca el correo tal cual se guardó: se pregunta en minúsculas, que es
 * como lo guarda al crear la cuenta, y si no aparece, tal como viene.
 */
export async function usuarioPorCorreo(conexion, correo, opciones) {
  const email = String(correo || '').trim();
  if (!email) return null;
  const variantes = [...new Set([email.toLowerCase(), email])];
  for (const v of variantes) {
    const lista = await llamar(conexion, 'core_user_get_users_by_field',
      { field: 'email', 'values[0]': v }, opciones);
    const u = Array.isArray(lista) ? lista[0] : null;
    if (u) return { id: Number(u.id), suspendido: Boolean(u.suspended), nombre: u.fullname || null };
  }
  return null;
}

/**
 * El estado de la matrícula del tutor a partir de lo que dice el campus.
 *
 *   · es usuario y no está suspendido      → activa
 *   · es usuario pero está suspendido      → baja
 *   · no es usuario y antes estaba activa  → baja  (le han dado de baja)
 *   · no es usuario                        → pendiente (de matrícula)
 */
export function estadoDeLaMatricula(usuario, estadoAnterior = null) {
  if (usuario) return usuario.suspendido ? 'baja' : 'activa';
  if (estadoAnterior === 'activa' || estadoAnterior === 'baja') return 'baja';
  return 'pendiente';
}

// ─── Consultas de alumnos, fase 2 (#188): la mensajería del campus ──────────

/**
 * Lo que necesita el token del CAMPUS para leer las consultas (además de las de
 * la fase 1). Leer conversaciones de otro usuario pide que el usuario del token
 * pueda leer todos los mensajes (`moodle/site:readallmessages`): un
 * administrador del campus lo puede.
 */
export const FUNCIONES_CONSULTAS = ['core_message_get_conversations', 'core_message_get_conversation_messages'];

/** Lo que necesita el token de cada TUTOR para responder en su nombre. */
export const FUNCIONES_RESPUESTA = ['core_message_send_instant_messages'];

/**
 * Las conversaciones privadas (individuales) de un usuario del campus, con sus
 * miembros. Es por donde preguntan hoy los alumnos: el «Chat» del curso lleva a
 * la mensajería privada con su tutor (estudio de la fase 0).
 */
export async function conversacionesDe(conexion, moodleUserId, { limite = 50, desde = 0 } = {}, opciones) {
  const r = await llamar(conexion, 'core_message_get_conversations', {
    userid: moodleUserId, type: 1, limitfrom: desde, limitnum: limite,
  }, opciones);
  return (r?.conversations || []).map((c) => ({
    id: Number(c.id),
    miembros: (c.members || []).map((m) => ({ id: Number(m.id), nombre: m.fullname || null })),
  }));
}

/**
 * Los mensajes de una conversación desde una fecha (segundos Unix), del más
 * antiguo al más nuevo, para meterlos en orden.
 */
export async function mensajesDeConversacion(conexion, moodleUserId, conversacionId, { desde = 0, limite = 100 } = {}, opciones) {
  const r = await llamar(conexion, 'core_message_get_conversation_messages', {
    currentuserid: moodleUserId, convid: conversacionId, limitfrom: 0, limitnum: limite,
    newest: 0, timefrom: Math.max(0, Math.floor(desde)),
  }, opciones);
  return (r?.messages || [])
    .map((m) => ({
      id: Number(m.id),
      de: Number(m.useridfrom),
      texto: textoDeMoodle(m.text),
      fecha: new Date(Number(m.timecreated) * 1000),
    }))
    .sort((a, b) => a.fecha - b.fecha || a.id - b.id);
}

/** Un usuario del campus por su id: nombre y correo. */
export async function usuarioPorId(conexion, moodleUserId, opciones) {
  const lista = await llamar(conexion, 'core_user_get_users_by_field',
    { field: 'id', 'values[0]': moodleUserId }, opciones);
  const u = Array.isArray(lista) ? lista[0] : null;
  return u ? { id: Number(u.id), nombre: u.fullname || null, email: u.email || null } : null;
}

/**
 * Manda un mensaje privado DESDE el usuario del token (el tutor) al alumno.
 * Moodle contesta una lista con `msgid` (-1 si no lo ha aceptado) y, si falla,
 * `errormessage`.
 */
export async function enviarMensaje(conexion, paraMoodleUserId, texto, opciones) {
  const r = await llamar(conexion, 'core_message_send_instant_messages', {
    'messages[0][touserid]': paraMoodleUserId,
    'messages[0][text]': texto,
    // 1 = HTML: el texto llega ya escapado (`textoParaElCampus`) y los adjuntos
    // como enlaces que se pueden pulsar. En texto plano (2) Moodle no los enlaza.
    'messages[0][textformat]': 1,
  }, opciones);
  const m = Array.isArray(r) ? r[0] : null;
  if (!m || Number(m.msgid) <= 0) {
    throw new MoodleError(`El campus no ha aceptado el mensaje${m?.errormessage ? `: ${m.errormessage}` : '.'}`, 'NO_ENVIADO');
  }
  // La conversación donde ha quedado (Moodle la abre si no existía).
  return { id: Number(m.msgid), conversacionId: Number(m.conversationid) || null };
}

/** El texto de un mensaje de Moodle (viene en HTML) como texto normal. */
export function textoDeMoodle(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Consultas de alumnos, fase 3 (#189): los alumnos de cada tutor ─────────

/** Lo que necesita el token del CAMPUS para leer los matriculados (además de lo anterior). */
export const FUNCIONES_ALUMNOS = ['core_enrol_get_users_courses', 'core_enrol_get_enrolled_users'];

/**
 * Los cursos en los que está matriculado un usuario (para el tutor: los que imparte).
 *
 * Es la misma llamada que da el avance de un alumno (#532, #681): Moodle añade a cada
 * curso si tiene la finalización activada (`enablecompletion`) y el % de actividades
 * hechas por ESE usuario (`progress`). `progreso` es null si el curso no tiene
 * seguimiento o ninguna actividad con finalización: no se sabe, que no es «0 %».
 */
export async function cursosDe(conexion, moodleUserId, opciones) {
  const r = await llamar(conexion, 'core_enrol_get_users_courses', { userid: moodleUserId }, opciones);
  return (Array.isArray(r) ? r : []).map((c) => ({
    id: Number(c.id), nombre: c.fullname || c.shortname || null,
    // La última vez que ESE usuario entró al curso (0 = nunca).
    ultimoAcceso: Number(c.lastaccess) > 0 ? new Date(Number(c.lastaccess) * 1000) : null,
    seguimiento: c.enablecompletion === true || Number(c.enablecompletion) === 1,
    progreso: progresoDeMoodle(c),
  }));
}

/** El % hecho que da Moodle, redondeado y entre 0 y 100; null si no lo da (sin seguimiento). */
export function progresoDeMoodle(c) {
  const seguimiento = c?.enablecompletion === true || Number(c?.enablecompletion) === 1;
  if (!seguimiento || c.progress === null || c.progress === undefined || c.progress === '') return null;
  const n = Number(c.progress);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null;
}

/** Roles (nombre corto) del equipo del curso: quien tiene uno de estos no es alumno. */
export const ROLES_DE_EQUIPO = new Set(['editingteacher', 'teacher', 'manager', 'coursecreator']);

/**
 * ¿Es alumno del curso? Quien tiene algún rol y ninguno del equipo, aunque su rol no se
 * llame «student» (un campus puede tener «alumno» u otro rol propio). Lo usan «Mi campus»
 * (tutor.micampus.js, que de momento solo lee el aviso de entregas sin corregir) y
 * «Alumnos sin mensajes»: los dos tienen que contar a los mismos.
 */
export const esAlumno = (g) => (g.roles || []).length > 0 && !g.roles.some((r) => ROLES_DE_EQUIPO.has(r));

/**
 * TODOS los cursos del campus (#457: las entregas de cursos sin tutora vinculada en el
 * CRM). Sin el curso «sitio» de Moodle. En el 360 la añade al servicio el plugin 1.10.8;
 * aquí no hay plugin: el servicio del token del campus (Integraciones › Moodle) tiene que
 * tenerla. Si no la tiene, Moodle la niega y quien llama se salta el campus.
 */
export async function cursosDelCampus(conexion, opciones) {
  const r = await llamar(conexion, 'core_course_get_courses_by_field', {}, opciones);
  return (Array.isArray(r?.courses) ? r.courses : [])
    .filter((c) => c && c.format !== 'site' && Number(c.id) > 1)
    .map((c) => ({
      id: Number(c.id),
      nombre: c.displayname || c.fullname || c.shortname || null,
      visible: c.visible === undefined ? true : Number(c.visible) === 1 || c.visible === true,
    }));
}

/**
 * Los matriculados ACTIVOS de un curso, con su rol y su último acceso. Solo
 * activos (decisión 8: fuera bajas): `onlyactive`.
 */
export async function matriculadosDe(conexion, cursoId, opciones) {
  const r = await llamar(conexion, 'core_enrol_get_enrolled_users', {
    courseid: cursoId,
    'options[0][name]': 'onlyactive', 'options[0][value]': 1,
    'options[1][name]': 'userfields', 'options[1][value]': 'id,fullname,email,lastaccess,lastcourseaccess,roles,groups',
  }, opciones);
  return (Array.isArray(r) ? r : []).map((u) => ({
    id: Number(u.id),
    nombre: u.fullname || null,
    email: u.email || null,
    roles: (u.roles || []).map((x) => x.shortname),
    // Sus grupos en el curso (para los cursos con grupos separados).
    grupos: (u.groups || []).map((g) => Number(g.id)),
    // 0 = nunca ha entrado.
    ultimoAcceso: Number(u.lastcourseaccess || u.lastaccess) > 0 ? new Date(Number(u.lastcourseaccess || u.lastaccess) * 1000) : null,
  }));
}

// ─── Las tareas (#457, de la parte 7 de la #681 y la #769 del CRM 360) ─────────
//
// Solo LECTURA, con el token del campus: lo que necesita el aviso de entregas sin
// corregir. En el 360 aquí van también `entregasDeTarea`, `notasDeTarea`,
// `contenidoDelCurso` y `calificarComoTutora` (corregir desde el CRM, parte 4 de la
// #689); llegan con el porte de la #406/#408.

/** Las tareas (mod_assign) de esos cursos, en UNA llamada: { cursoId: [{ id, cmid, nombre, entrega }] }. */
export async function tareasDeCursos(conexion, cursoIds, opciones) {
  if (!cursoIds.length) return new Map();
  // Sin `includenotenrolledcourses`, Moodle solo devuelve los cursos en los que
  // está MATRICULADO el usuario del token. El del campus es un administrador que
  // no lo está en ninguno: salía todo vacío («User is not enrolled»).
  const params = { includenotenrolledcourses: 1 };
  cursoIds.forEach((id, i) => { params[`courseids[${i}]`] = id; });
  const r = await llamar(conexion, 'mod_assign_get_assignments', params, opciones);
  const porCurso = new Map();
  for (const c of r?.courses || []) {
    porCurso.set(Number(c.id), (c.assignments || []).map((a) => ({
      id: Number(a.id), cmid: Number(a.cmid), nombre: a.name || null,
      entrega: Number(a.duedate) > 0 ? new Date(Number(a.duedate) * 1000) : null,
      // «Recordarme calificar antes de» de la tarea (#769): si va antes que el plazo de
      // administración, el aviso a administración sale en esa fecha.
      calificarAntes: Number(a.gradingduedate) > 0 ? new Date(Number(a.gradingduedate) * 1000) : null,
      // La nota máxima (0 = sin nota numérica: escala o sin calificar).
      notaMax: Number(a.grade) > 0 ? Number(a.grade) : 0,
      // Con escala (grade < 0) o sin nota (0) una cifra no vale: se corrige en Moodle.
      calificable: Number(a.grade) > 0,
      // Entrega en grupo: Moodle la guarda a nombre del grupo (userid 0), no de cada alumno.
      enGrupo: Number(a.teamsubmission) === 1,
      // Flujo de calificación: los estados son otros («released», «inmarking»…).
      flujo: Number(a.markingworkflow) === 1,
      // ¿Admite comentario de retroalimentación? Si está apagado, Moodle tira el comentario sin avisar.
      comentarios: (a.configs || []).some((c) => c.plugin === 'comments' && c.subtype === 'assignfeedback' && c.name === 'enabled' && String(c.value) === '1'),
      enunciado: a.intro || null,
    })));
  }
  // Los cursos que Moodle no ha dejado leer (vienen como aviso, no como error):
  // quien llama tiene que decirlo, no enseñar un «0 por corregir» que miente.
  porCurso.sinPermiso = new Set((r?.warnings || [])
    .filter((w) => w.item === 'course' && w.itemid).map((w) => Number(w.itemid)));
  return porCurso;
}

/** Estados de `gradingstatus` que son «ya corregida» (sin flujo: graded; con flujo: los de después de calificar). */
export const YA_CORREGIDA = new Set(['graded', 'released', 'readyforrelease']);

/** Las notas de varias tareas, en una llamada: { tareaId: { alumnoId: { nota, at } } }. */
async function notasDeTareas(conexion, tareaIds, opciones) {
  const params = {};
  tareaIds.forEach((id, i) => { params[`assignmentids[${i}]`] = id; });
  const r = await llamar(conexion, 'mod_assign_get_grades', params, opciones);
  const porTarea = new Map();
  for (const a of r?.assignments || []) {
    porTarea.set(Number(a.assignmentid), new Map((a.grades || [])
      .filter((g) => g.grade !== null && g.grade !== '' && Number(g.grade) >= 0)
      .map((g) => [Number(g.userid), { nota: Number(g.grade), at: Number(g.timemodified) > 0 ? new Date(Number(g.timemodified) * 1000) : null }])));
  }
  return porTarea;
}

/**
 * ¿Está por corregir? Entregada y, o sin corregir, o vuelta a entregar después de la
 * nota (Moodle la sigue llamando «graded» aunque la entrega sea posterior).
 */
export function porCorregir(entrega, nota) {
  if (entrega?.estado !== 'submitted') return false;
  if (!YA_CORREGIDA.has(entrega.gradingstatus) && !nota) return true;
  return Boolean(nota?.at && entrega.entregadaAt && entrega.entregadaAt > nota.at);
}

/** Tareas por llamada a Moodle: con muchas a la vez, una sola llamada pasa del tiempo de espera. */
const TAREAS_POR_LLAMADA = 20;

/**
 * Las entregas POR CORREGIR de esas tareas: { tareaId: [{ alumnoId, entregadaAt }] }.
 * Por tandas de `TAREAS_POR_LLAMADA` (entregas y notas de cada tanda a la vez).
 */
export async function entregasSinCorregir(conexion, tareaIds, opciones) {
  const porTarea = new Map();
  for (let i = 0; i < tareaIds.length; i += TAREAS_POR_LLAMADA) {
    const tanda = tareaIds.slice(i, i + TAREAS_POR_LLAMADA);
    const params = { status: 'submitted' };
    tanda.forEach((id, j) => { params[`assignmentids[${j}]`] = id; });
    const [r, notas] = await Promise.all([
      llamar(conexion, 'mod_assign_get_submissions', params, opciones),
      notasDeTareas(conexion, tanda, opciones),
    ]);
    for (const a of r?.assignments || []) {
      const notasDeEsta = notas.get(Number(a.assignmentid)) || new Map();
      porTarea.set(Number(a.assignmentid), (a.submissions || [])
        .map((s) => ({
          alumnoId: Number(s.userid), estado: s.status, gradingstatus: s.gradingstatus || null,
          entregadaAt: Number(s.timemodified) > 0 ? new Date(Number(s.timemodified) * 1000) : null,
        }))
        .filter((e) => e.alumnoId > 0 && porCorregir(e, notasDeEsta.get(e.alumnoId)))
        .map((e) => ({ alumnoId: e.alumnoId, entregadaAt: e.entregadaAt })));
    }
  }
  return porTarea;
}
