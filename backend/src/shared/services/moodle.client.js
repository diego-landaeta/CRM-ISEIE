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
    // Las 12 que usa el CRM, por grupo (CRM#925). Sin la lista, null: no se sabe.
    grupos: info?.functions
      ? GRUPOS_DE_FUNCIONES.map((g) => ({ clave: g.clave, titulo: g.titulo, total: g.funciones.length, faltan: g.funciones.filter((f) => !tiene.has(f)) }))
      : null,
    // «Puede descargar archivos» del servicio: sin él no se abren las entregas de
    // «Mi campus». Moodle lo dice en `downloadfiles` (0/1); si no viene, null.
    descargas: info?.downloadfiles === undefined || info?.downloadfiles === null ? null : Number(info.downloadfiles) === 1,
  };
}

/**
 * Lo que le falta al servicio del token, por grupo (CRM#925), a partir de lo que
 * devuelve `infoDelCampus` (o de lo guardado tras «Probar conexión»). Las de
 * «Consultas» solo cuentan con «Leer las consultas» encendido. Lista vacía: no
 * falta nada (o no se sabe).
 */
export function faltasDeFunciones(funciones, { consultas = false } = {}) {
  const grupos = Array.isArray(funciones?.grupos) ? funciones.grupos : [];
  const faltas = grupos
    .filter((g) => Array.isArray(g.faltan) && g.faltan.length > 0 && (g.clave !== 'consultas' || consultas))
    .map((g) => ({ clave: g.clave, titulo: g.titulo, faltan: g.faltan }));
  if (funciones?.descargas === false) faltas.push({ clave: 'descargas', titulo: 'Puede descargar archivos', faltan: [] });
  return faltas;
}

/**
 * Las faltas en una frase que quepa en un motivo (`limpiarMotivo` corta a 300): con
 * los nombres de cada función y, si no cabe, el grupo más largo pasa a «N funciones».
 * Con `tope: Infinity`, todas con su nombre (el mensaje de «Probar conexión»).
 */
export function textoDeFaltas(faltas, { tope = 290 } = {}) {
  if (!faltas?.length) return '';
  const partes = faltas.map((f) => (f.clave === 'descargas'
    ? { larga: '«Puede descargar archivos» sin marcar', corta: '«Puede descargar archivos» sin marcar' }
    : { larga: `${f.titulo}: ${f.faltan.join(', ')}`, corta: `${f.titulo}: ${f.faltan.length} ${f.faltan.length === 1 ? 'función' : 'funciones'}` }));
  const usadas = partes.map((p) => p.larga);
  const frase = () => `Faltan en el servicio — ${usadas.join(' · ')}.`;
  // De la más larga a la más corta, hasta que quepa.
  const orden = partes.map((p, i) => i).sort((a, b) => partes[b].larga.length - partes[a].larga.length);
  for (const i of orden) {
    if (frase().length <= tope) break;
    usadas[i] = partes[i].corta;
  }
  return frase();
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

/** Los cursos en los que está matriculado un usuario (para el tutor: los que imparte). */
export async function cursosDe(conexion, moodleUserId, opciones) {
  const r = await llamar(conexion, 'core_enrol_get_users_courses', { userid: moodleUserId }, opciones);
  return (Array.isArray(r) ? r : []).map((c) => ({ id: Number(c.id), nombre: c.fullname || c.shortname || null }));
}

/** Lo que necesita el servicio del token para las notas de la ficha del alumno (#532, plugin 1.10.9). Se comprueba ya, aunque la ficha con notas aún no esté en producción. */
export const FUNCIONES_NOTAS = ['gradereport_user_get_grade_items'];

/** Lo que usa «Tutores › Mi campus» (#681): cursos, alumnos, tareas, entregas, sus notas y el temario. */
export const FUNCIONES_MI_CAMPUS = [
  ...FUNCIONES_ALUMNOS,
  'mod_assign_get_assignments', 'mod_assign_get_submissions', 'mod_assign_get_grades', 'core_course_get_contents',
];

/** El aviso de entregas sin corregir de los cursos sin tutora (#769): todos los cursos del campus. */
export const FUNCIONES_AVISOS = ['core_course_get_courses_by_field'];

/**
 * LAS 12 FUNCIONES que el CRM pide al Moodle de un campus, por grupo (CRM#925).
 * «Probar conexión» y «Comprobar ahora» dicen cuáles faltan de cada grupo: antes
 * solo miraban las dos primeras y un campus salía en verde con «Mi campus» vacío.
 * El tutorial de Integraciones › Campus (Moodle) repite la lista: si cambia
 * aquí, cambia allí (`frontend/src/modules/accounting/lib/funcionesMoodle.ts`).
 */
export const GRUPOS_DE_FUNCIONES = [
  { clave: 'base', titulo: 'Conexión', funciones: FUNCIONES_NECESARIAS },
  { clave: 'mi_campus', titulo: 'Mi campus', funciones: FUNCIONES_MI_CAMPUS },
  { clave: 'consultas', titulo: 'Consultas', funciones: FUNCIONES_CONSULTAS },
  { clave: 'notas', titulo: 'Notas y avisos', funciones: [...FUNCIONES_NOTAS, ...FUNCIONES_AVISOS] },
];

/**
 * Los matriculados ACTIVOS de un curso, con su rol y su último acceso. Solo
 * activos (decisión 8: fuera bajas): `onlyactive`.
 */
export async function matriculadosDe(conexion, cursoId, opciones) {
  const r = await llamar(conexion, 'core_enrol_get_enrolled_users', {
    courseid: cursoId,
    'options[0][name]': 'onlyactive', 'options[0][value]': 1,
    'options[1][name]': 'userfields', 'options[1][value]': 'id,fullname,email,lastaccess,lastcourseaccess,roles',
  }, opciones);
  return (Array.isArray(r) ? r : []).map((u) => ({
    id: Number(u.id),
    nombre: u.fullname || null,
    email: u.email || null,
    roles: (u.roles || []).map((x) => x.shortname),
    // 0 = nunca ha entrado.
    ultimoAcceso: Number(u.lastcourseaccess || u.lastaccess) > 0 ? new Date(Number(u.lastcourseaccess || u.lastaccess) * 1000) : null,
  }));
}
