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
import { pluginMoodleActivo } from '../config/soloEnPruebas.js';

const TIEMPO_MAXIMO_MS = parseInt(process.env.MOODLE_TIMEOUT_MS || '10000', 10);

/** Las funciones que necesita el CRM en el servicio del token. */
export const FUNCIONES_NECESARIAS = ['core_webservice_get_site_info', 'core_user_get_users_by_field'];

/** Error con un mensaje para enseñar tal cual y un código para decidir. */
export class MoodleError extends Error {
  constructor(mensaje, codigo, errorcode = null) {
    super(mensaje);
    this.codigo = codigo;
    // El `errorcode` tal cual lo dijo Moodle («matricular_correo_repetido»…), para
    // quien tenga que distinguir un rechazo de otro (la matrícula automática, #455).
    this.errorcode = errorcode;
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
export async function llamar(conexion, funcion, parametros = {}, opciones = {}) {
  const veces = reintentosBD();
  for (let intento = 0; ; intento++) {
    try {
      return await llamarUnaVez(conexion, funcion, parametros, opciones);
    } catch (err) {
      // «Database connection failed»: el Moodle no ha llegado ni a abrir su base, así que no
      // ha hecho nada y repetir es seguro, también en lo que escribe. Pasa cuando el servidor
      // de los campus tiene sus conexiones a la base llenas (Psiko e ISAEG, 24/11: con 4
      // llamadas a la vez fallaban 14-40 de 96 cursos; de una en una, ninguno).
      if (!(err instanceof MoodleError) || err.codigo !== 'BD_CAMPUS' || intento >= veces) throw err;
      await (opciones.esperarImpl || esperar)(pausaBD() * (intento + 1) + Math.floor(Math.random() * pausaBD()));
    }
  }
}

/** Cuántas veces se repite una llamada que el campus rechaza por su base llena. */
const reintentosBD = () => {
  const n = parseInt(process.env.MOODLE_REINTENTOS_BD ?? '3', 10);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, 5) : 3;
};
/** La pausa (ms) antes de cada repetición; crece con cada intento. */
const pausaBD = () => {
  const n = parseInt(process.env.MOODLE_REINTENTO_MS ?? '700', 10);
  return Number.isInteger(n) && n >= 0 ? n : 700;
};
const esperar = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function llamarUnaVez({ url, token }, funcion, parametros = {}, { fetchImpl = fetch } = {}) {
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
      // Un Moodle no redirige su API. Seguir una redirección permitiría que una dirección
      // pública llevara al CRM a la red interna (la comprobación de la dirección es previa).
      redirect: 'error',
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
  const error = (mensaje, propio) => new MoodleError(mensaje, propio, codigo || null);
  if (codigo === 'invalidtoken') return error('El token del campus no vale (caducado o mal copiado).', 'TOKEN');
  if (codigo === 'accessexception' || codigo === 'servicerequireslogin') {
    return error(`El token no tiene permiso para «${funcion}»: añádela al servicio del token en el campus.`, 'PERMISO');
  }
  // La base del Moodle saturada o caída. El mensaje de Moodle viene en HTML («<p>Error:
  // Database connection failed</p>…»), y así lo veía la tutora en «Mi campus».
  if (codigo === 'dbconnectionfailed') {
    return error('La base de datos del campus no admite más conexiones ahora mismo (Moodle: «Database connection failed»). Pulsa «Actualizar» en unos minutos.', 'BD_CAMPUS');
  }
  if (codigo === 'webservicesnotenabled' || codigo === 'enablewsdescription') {
    return error('El campus tiene los servicios web apagados.', 'WS_APAGADOS');
  }
  if (/invalidrecord|function.*not.*found|codingerror/i.test(`${codigo} ${datos.message || ''}`)) {
    return error(`El servicio del token no tiene la función «${funcion}».`, 'SIN_FUNCION');
  }
  const motivo = motivoDelError(datos) || codigo || 'error sin detalle';
  return error(`El campus ha dicho: ${motivo.replace(/[.\s]+$/, '')}.`, 'MOODLE');
}

/**
 * El motivo del error: el `message`, salvo que sea el genérico de Moodle para un
 * parámetro no válido («Invalid parameter value detected», #689). Ese no explica nada:
 * el motivo de verdad va en `debuginfo`, que Moodle solo manda con la depuración
 * encendida. El plugin 1.10.2 ya pone el motivo en `message`; con uno anterior, o con
 * otra función, se usa `debuginfo` si viene.
 */
function motivoDelError(datos) {
  // Algunos errores de Moodle llegan en HTML: se enseñan como texto.
  const sinHtml = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const mensaje = sinHtml(datos.message);
  const debug = sinHtml(datos.debuginfo);
  const generico = !mensaje || datos.errorcode === 'invalidparameter' || /^invalid parameter value detected\.?$/i.test(mensaje);
  return generico && debug ? debug : mensaje;
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
 * La cuenta del token: el usuario con el que el CRM habla con el campus
 * (`crm_servicio` desde el plugin; en conexiones antiguas, el administrador que
 * creó el token). Nunca es la cuenta de una tutora.
 */
export async function cuentaDelToken(conexion, opciones) {
  const info = await llamar(conexion, 'core_webservice_get_site_info', {}, opciones);
  return { id: Number(info?.userid) || null, esAdministrador: Boolean(info?.userissiteadmin) };
}

/**
 * Si una cuenta cualquiera del campus existe y es administradora del sitio, por el plugin
 * del CRM (`local_crm_cuenta`, 1.10.2; revisión de la #689). La API de Moodle solo lo dice
 * de la cuenta del token. Solo lectura.
 *
 * Con un plugin anterior (o un campus sin el plugin) la función no está: devuelve null y
 * quien llama decide sin saberlo. Cualquier otro fallo sube como siempre.
 *
 * `permitida` (plugin 1.11.7, CRM#1118): es una administradora del sitio de la lista
 * «Administradoras que dan clase» del campus, y el plugin envía y califica como ella en los
 * cursos donde es tutora. Un plugin anterior no lo trae: false, como hasta ahora.
 */
export async function cuentaDelCampus(conexion, moodleUserId, opciones) {
  try {
    const r = await llamar(conexion, 'local_crm_cuenta', { userid: moodleUserId }, opciones);
    return { existe: Boolean(r?.existe), esAdministrador: Boolean(r?.siteadmin), permitida: Boolean(r?.permitida) };
  } catch (err) {
    if (err instanceof MoodleError && (err.codigo === 'SIN_FUNCION' || err.codigo === 'PERMISO')) return null;
    throw err;
  }
}

/** Un usuario del campus por un campo exacto (`id`, `username`, `email`), o null. */
export async function usuarioPor(conexion, campo, valor, opciones) {
  const v = String(valor ?? '').trim();
  if (!v) return null;
  const lista = await llamar(conexion, 'core_user_get_users_by_field', { field: campo, 'values[0]': v }, opciones);
  const u = Array.isArray(lista) ? lista[0] : null;
  return u ? { id: Number(u.id), suspendido: Boolean(u.suspended), nombre: u.fullname || null, email: u.email || null } : null;
}

/**
 * El alumno en el campus, por su id de Moodle si ya se sabe o, si no, por su correo (como
 * `usuarioPorCorreo`), con la última vez que entró al campus (#532). Es la misma función
 * de Moodle; va aparte para no cambiar lo que `usuarioPor` da a quien ya la usa.
 */
export async function alumnoDelCampus(conexion, { moodleId = null, correo = null } = {}, opciones) {
  const email = String(correo || '').trim();
  const pruebas = Number(moodleId) > 0
    ? [['id', Number(moodleId)]]
    : [...new Set([email.toLowerCase(), email])].filter(Boolean).map((v) => ['email', v]);
  for (const [campo, valor] of pruebas) {
    const lista = await llamar(conexion, 'core_user_get_users_by_field', { field: campo, 'values[0]': valor }, opciones);
    const u = Array.isArray(lista) ? lista[0] : null;
    if (u) {
      return {
        id: Number(u.id), nombre: u.fullname || null, suspendido: Boolean(u.suspended),
        // 0 = nunca ha entrado.
        ultimoAcceso: Number(u.lastaccess) > 0 ? new Date(Number(u.lastaccess) * 1000) : null,
      };
    }
  }
  return null;
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
    const u = await usuarioPor(conexion, 'email', v, opciones);
    if (u) return u;
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
  return (r?.conversations || []).map((c) => {
    // Moodle manda con cada conversación su último mensaje (solo ese).
    const u = (c.messages || [])[0];
    return {
      id: Number(c.id),
      miembros: (c.members || []).map((m) => ({ id: Number(m.id), nombre: m.fullname || null })),
      ultimo: u ? { id: Number(u.id), de: Number(u.useridfrom), fecha: new Date(Number(u.timecreated) * 1000) } : null,
    };
  });
}

/** Conversaciones por página al buscar las que esperan respuesta, y el tope por tutora. */
const CONVERSACIONES_POR_PAGINA = 50;
const maxConversaciones = () => {
  const n = parseInt(process.env.MI_CAMPUS_MAX_CONVERSACIONES || '300', 10);
  return Number.isInteger(n) && n > 0 ? n : 300;
};

/**
 * Las conversaciones privadas de una tutora cuyo ÚLTIMO mensaje es del otro (el alumno): las
 * que esperan su respuesta en Moodle, de cualquier fecha. Diego, 24/11: «tienen que tener
 * TODAS las pendientes, no solamente desde que se subió el campus». Solo lee. Moodle las da de
 * la más reciente a la más antigua; se pide página a página hasta el tope.
 */
export async function conversacionesSinResponder(conexion, moodleUserId, opciones) {
  const yo = Number(moodleUserId);
  const pendientes = [];
  const tope = maxConversaciones();
  for (let desde = 0; desde < tope; desde += CONVERSACIONES_POR_PAGINA) {
    const pagina = await conversacionesDe(conexion, yo, { limite: CONVERSACIONES_POR_PAGINA, desde }, opciones);
    for (const c of pagina) {
      // Individual: el otro miembro es el alumno (Moodle no lista al propio usuario).
      const otro = c.miembros.find((m) => m.id !== yo);
      if (!otro || !c.ultimo || c.ultimo.de === yo || c.ultimo.de !== otro.id) continue;
      pendientes.push({ conversacionId: c.id, alumnoId: otro.id, alumno: otro.nombre, mensajeId: c.ultimo.id, desde: c.ultimo.fecha });
    }
    if (pagina.length < CONVERSACIONES_POR_PAGINA) break;
  }
  return pendientes;
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

/**
 * Manda un mensaje privado EN NOMBRE de la tutora, por el plugin del CRM
 * (`local_crm_enviar_mensaje`, #679), con el token del campus: sin el token
 * personal de cada tutora. El plugin solo deja enviar como personal del campus.
 *
 * Con `conversacionId` (plugin 1.9.0) va al chat de grupo del alumno con las tutoras del
 * curso, donde lo ven todas; sin él, a la conversación privada de los dos.
 *
 * Solo en pruebas mientras no se apruebe (PLUGIN_MOODLE_EN_PRODUCCION): apagado no llama
 * a nadie y falla con 'APAGADO', aunque quien llame se haya saltado su propia comprobación.
 */
export async function enviarComoTutor(conexion, desdeMoodleUserId, paraMoodleUserId, texto, { conversacionId = null, ...opciones } = {}) {
  if (!pluginMoodleActivo()) {
    throw new MoodleError('El plugin del CRM en Moodle aún no está aprobado en producción.', 'APAGADO');
  }
  const r = await llamar(conexion, 'local_crm_enviar_mensaje', {
    desde: desdeMoodleUserId, para: paraMoodleUserId, texto,
    ...(conversacionId ? { conversacionid: Number(conversacionId) } : {}),
  }, opciones);
  if (!r || !(Number(r.id) > 0)) throw new MoodleError('El campus no ha aceptado el mensaje.', 'NO_ENVIADO');
  return { id: Number(r.id), conversacionId: Number(r.conversacion_id) || null };
}

/** El texto de un mensaje de Moodle (viene en HTML) como texto normal. */
export function textoDeMoodle(html) {
  return String(html || '')
    // Un enlace con texto propio conserva su dirección; una imagen se dice, no desaparece.
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, url, txt) => {
      const limpio = txt.replace(/<[^>]+>/g, '').trim();
      return !limpio || limpio === url ? url : `${limpio} (${url})`;
    })
    .replace(/<img\s[^>]*>/gi, (img) => {
      const alt = /alt="([^"]*)"/i.exec(img)?.[1]?.trim();
      return alt ? `[Imagen: ${alt}]` : '[Imagen]';
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ''; } })
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
    // Si ese usuario ha terminado el curso según la finalización de Moodle (#532).
    terminado: c.completed === true || Number(c.completed) === 1,
  }));
}

/** Lo que necesita el servicio del token para las notas de la ficha del alumno (#532, plugin 1.10.9). */
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

/** Una nota de Moodle: la cifra (null si no hay) y el texto tal como lo enseña el campus. */
function notaDeMoodle(g) {
  const raw = g?.graderaw === null || g?.graderaw === undefined || g?.graderaw === '' ? null : Number(g.graderaw);
  const texto = String(g?.gradeformatted ?? '').trim();
  return {
    nota: Number.isFinite(raw) ? raw : null,
    // «-» es como Moodle dice «sin nota»: no se repite.
    texto: texto && texto !== '-' ? texto : null,
    maxima: Number.isFinite(Number(g?.grademax)) ? Number(g.grademax) : null,
    porcentaje: String(g?.percentageformatted ?? '').trim().replace(/^-$/, '') || null,
  };
}

/**
 * Las notas de UN alumno en UN curso, como las ve en su informe de calificaciones (#532):
 * la de cada actividad calificada y la final del curso. Solo lee
 * (`gradereport_user_get_grade_items`). Las ocultas al alumno no salen, y las actividades
 * sin nota todavía tampoco: aquí se enseña lo que tiene, no la lista de lo que falta.
 */
export async function notasDelAlumno(conexion, cursoId, moodleUserId, opciones) {
  const r = await llamar(conexion, 'gradereport_user_get_grade_items', { courseid: cursoId, userid: moodleUserId }, opciones);
  const suyas = (r?.usergrades || []).find((u) => Number(u.userid) === Number(moodleUserId));
  const items = (suyas?.gradeitems || []).filter((g) => !(g.gradeishidden === true || Number(g.gradeishidden) === 1));
  const total = items.find((g) => g.itemtype === 'course');
  const finalDelCurso = total ? notaDeMoodle(total) : null;
  return {
    final: finalDelCurso && (finalDelCurso.nota !== null || finalDelCurso.texto) ? finalDelCurso : null,
    actividades: items
      .filter((g) => g.itemtype === 'mod' || g.itemtype === 'manual')
      .map((g) => ({ id: Number(g.id), nombre: g.itemname || null, tipo: g.itemmodule || g.itemtype, ...notaDeMoodle(g) }))
      .filter((g) => g.nota !== null || g.texto),
  };
}

/** El % hecho que da Moodle, redondeado y entre 0 y 100; null si no lo da (sin seguimiento). */
export function progresoDeMoodle(c) {
  const seguimiento = c?.enablecompletion === true || Number(c?.enablecompletion) === 1;
  if (!seguimiento || c.progress === null || c.progress === undefined || c.progress === '') return null;
  const n = Number(c.progress);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null;
}

/**
 * Con qué roles del curso da clase una tutora: «Profesor» y «Profesor sin permiso de
 * edición», y los que añada `MOODLE_ROLES_TUTORA` (nombres cortos separados por comas).
 * En ISEIE las tutoras redactoras están como «Gestor» (`manager`) en sus cursos, y Diego
 * pidió que cuente (24/11/2026): allí `MOODLE_ROLES_TUTORA=manager`. Se lee en cada
 * llamada, para que el .env mande sin reiniciar nada más.
 */
export function esRolDeTutora(rol, env = process.env) {
  if (rol === 'editingteacher' || rol === 'teacher') return true;
  const extra = String(env.MOODLE_ROLES_TUTORA || '').split(',').map((x) => x.trim()).filter(Boolean);
  return extra.includes(rol);
}

/** Roles (nombre corto) del equipo del curso: quien tiene uno de estos no es alumno. */
export const ROLES_DE_EQUIPO = new Set(['editingteacher', 'teacher', 'manager', 'coursecreator']);

/**
 * ¿Es alumno del curso? Quien tiene algún rol y ninguno del equipo, aunque su rol no se
 * llame «student» (un campus puede tener «alumno» u otro rol propio). Lo usan «Mi campus»
 * (tutor.micampus.js, que lee también el aviso de entregas sin corregir) y
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
// Todo LEE salvo `calificarComoTutora`, que escribe la nota en Moodle y solo va con el
// plugin aprobado (PLUGIN_MOODLE_EN_PRODUCCION). Corregir desde el CRM (#408, gemela de
// CRM#681) llega con «Mi campus» de las redactoras (gemela de CRM#1084).

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

/**
 * TODAS las entregas de una tarea, con lo entregado (#681: corregir desde el CRM):
 * el texto en línea y los archivos (con su dirección de Moodle, que solo se abre con
 * el token: el CRM la sirve por su cuenta, el navegador nunca ve el token).
 */
export async function entregasDeTarea(conexion, tareaId, opciones) {
  const r = await llamar(conexion, 'mod_assign_get_submissions', { 'assignmentids[0]': tareaId }, opciones);
  const subs = (r?.assignments || []).find((a) => Number(a.assignmentid) === Number(tareaId))?.submissions || [];
  return subs.map((s) => {
    const plugins = s.plugins || [];
    const texto = plugins.flatMap((p) => p.editorfields || []).map((e) => e.text).filter(Boolean).join('\n\n');
    const archivos = plugins.flatMap((p) => (p.fileareas || []).flatMap((fa) => fa.files || []))
      .filter((f) => f.filename && f.filename !== '.')
      .map((f) => ({ nombre: f.filename, tamano: Number(f.filesize) || null, tipo: f.mimetype || null, url: f.fileurl }));
    return {
      alumnoId: Number(s.userid), estado: s.status, gradingstatus: s.gradingstatus || null,
      entregadaAt: Number(s.timemodified) > 0 ? new Date(Number(s.timemodified) * 1000) : null,
      texto, archivos,
    };
  });
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

/** Las notas puestas en una tarea: { alumnoId: { nota, at } }. */
export async function notasDeTarea(conexion, tareaId, opciones) {
  return (await notasDeTareas(conexion, [tareaId], opciones)).get(Number(tareaId)) || new Map();
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

/**
 * El curso entero, como lo ve la profesora en Moodle: sus secciones (temas) en orden y,
 * en cada una, sus actividades y recursos (tareas, cuestionarios, foros, archivos…), con
 * si están ocultos y sus fechas. Sin los archivos de cada recurso (`excludecontents`):
 * solo la estructura. Los bloques de texto sueltos (`label`) no son actividades y no salen.
 */
export async function contenidoDelCurso(conexion, cursoId, opciones) {
  const r = await llamar(conexion, 'core_course_get_contents', {
    courseid: cursoId, 'options[0][name]': 'excludecontents', 'options[0][value]': 1,
  }, opciones);
  return (Array.isArray(r) ? r : []).map((s) => ({
    id: Number(s.id),
    numero: Number(s.section) || 0,
    nombre: s.name || null,
    visible: Number(s.visible ?? 1) !== 0,
    actividades: (s.modules || []).filter((m) => m.modname !== 'label').map((m) => ({
      cmid: Number(m.id),
      instancia: Number(m.instance) || null,
      tipo: m.modname || null,
      nombre: m.name || null,
      url: m.url || null,
      visible: Number(m.visible ?? 1) !== 0,
      restringida: Boolean(m.availabilityinfo),
      fechas: (m.dates || []).filter((d) => Number(d.timestamp) > 0)
        .map((d) => ({ etiqueta: d.label || null, at: new Date(Number(d.timestamp) * 1000) })),
    })),
  }));
}

/** Tareas por llamada a Moodle: con muchas a la vez, una sola llamada pasa del tiempo de espera. */
const TAREAS_POR_LLAMADA = 20;

/**
 * Crea en el campus el curso de una formación del CRM, o lo actualiza, con una sección
 * por módulo (CRM#1113, plugin local_crm 1.12.0: `local_crm_curso_guardar`). Escribe en
 * Moodle: detrás de PLUGIN_MOODLE_EN_PRODUCCION, como corregir; y quien lo llama, detrás
 * de su propio interruptor (FORMACIONES_MOODLE_EN_PRODUCCION).
 *
 * `secciones`: [{ nombre, resumen }] en orden; el resumen, en HTML. Devuelve
 * { cursoId, nombre, nombreCorto, creado, visible, secciones: [{ numero, id }], sobran }.
 */
export async function guardarCursoEnMoodle(conexion, {
  cursoId = 0, idnumber = '', nombre, nombreCorto = '', categoria = 0, resumen = '', inicio = 0, fin = 0, visible = false, secciones = [],
}, opciones) {
  if (!pluginMoodleActivo()) {
    throw new MoodleError('El plugin del CRM en Moodle aún no está aprobado en producción.', 'APAGADO');
  }
  const params = {
    cursoid: cursoId || 0, idnumber, nombre, nombrecorto: nombreCorto, categoria: categoria || 0,
    resumen, inicio: inicio || 0, fin: fin || 0, visible: visible ? 1 : 0,
  };
  secciones.forEach((s, i) => {
    params[`secciones[${i}][nombre]`] = s.nombre;
    params[`secciones[${i}][resumen]`] = s.resumen || '';
  });
  const r = await llamar(conexion, 'local_crm_curso_guardar', params, opciones);
  if (!r?.cursoid) throw new MoodleError('El campus no ha devuelto el curso.', 'SIN_CURSO');
  return {
    cursoId: Number(r.cursoid),
    nombre: r.nombre,
    nombreCorto: r.nombrecorto,
    creado: Boolean(r.creado),
    visible: Boolean(r.visible),
    secciones: (r.secciones || []).map((x) => ({ numero: Number(x.numero), id: Number(x.id) })),
    sobran: Number(r.sobran) || 0,
  };
}

/**
 * Lo que hace falta saber del campus para crear en él el curso de una formación
 * (CRM#1113, fase 2): sus categorías y los nombres cortos que ya están cogidos. SOLO LEE.
 *
 * Los nombres cortos salen de `core_course_get_courses_by_field`, que está en el servicio
 * del plugin. Las categorías, con su árbol entero, de `core_course_get_categories`; pero el
 * servicio del plugin (1.11.x) no la tiene, y entonces salen de los mismos cursos: solo las
 * que tienen alguno, sin su categoría padre (por eso pueden repetirse nombres, como las
 * facultades de ISEIE, y la pantalla enseña el id al lado).
 *
 * Devuelve { fuente: 'moodle' | 'cursos', categorias: [{ id, nombre, ruta, cursos }], cortos: [] }.
 */
export async function categoriasDelCampus(conexion, opciones) {
  const r = await llamar(conexion, 'core_course_get_courses_by_field', {}, opciones);
  const cursos = (Array.isArray(r?.courses) ? r.courses : []).filter((c) => c && c.format !== 'site' && Number(c.id) > 1);
  const cortos = cursos.map((c) => String(c.shortname || '').trim()).filter(Boolean);
  let categorias = null;
  try {
    const cats = await llamar(conexion, 'core_course_get_categories', {}, opciones);
    if (Array.isArray(cats)) {
      const porId = new Map(cats.map((c) => [Number(c.id), c]));
      const ruta = (c) => {
        const partes = [];
        for (let x = c, n = 0; x && n < 20; x = porId.get(Number(x.parent)), n += 1) partes.unshift(String(x.name));
        return partes.join(' › ');
      };
      categorias = cats.map((c) => ({
        id: Number(c.id), nombre: String(c.name), ruta: ruta(c), profundidad: Number(c.depth) || 1, cursos: Number(c.coursecount) || 0,
      }));
    }
  } catch (err) {
    // Al token le falta la función: no es que el campus falle. Lo demás, sí se dice.
    if (!(err instanceof MoodleError) || !['PERMISO', 'SIN_FUNCION'].includes(err.codigo)) throw err;
  }
  const fuente = categorias ? 'moodle' : 'cursos';
  if (!categorias) {
    const porId = new Map();
    for (const c of cursos) {
      const id = Number(c.categoryid);
      if (!(id > 0)) continue;
      const o = porId.get(id) || { id, nombre: String(c.categoryname || `Categoría ${id}`), ruta: null, profundidad: null, cursos: 0 };
      o.cursos += 1;
      porId.set(id, o);
    }
    categorias = [...porId.values()];
  }
  categorias.sort((a, b) => (a.ruta || a.nombre).localeCompare(b.ruta || b.nombre, 'es') || a.id - b.id);
  return { fuente, categorias, cortos };
}

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

/**
 * Califica a nombre de la tutora, por el plugin (`local_crm_calificar`). ESCRIBE en
 * Moodle: solo en pruebas mientras no se apruebe (PLUGIN_MOODLE_EN_PRODUCCION). Apagado
 * no llama a nadie y falla con 'APAGADO', aunque quien llame se haya saltado su propia
 * comprobación (como `enviarComoTutor`).
 */
export async function calificarComoTutora(conexion, { desde, tarea, alumno, nota, comentario }, opciones) {
  if (!pluginMoodleActivo()) {
    throw new MoodleError('El plugin del CRM en Moodle aún no está aprobado en producción.', 'APAGADO');
  }
  const r = await llamar(conexion, 'local_crm_calificar', { desde, tarea, alumno, nota, comentario: comentario || '' }, opciones);
  if (!r?.ok) throw new MoodleError('El campus no ha guardado la nota.', 'NO_CALIFICADO');
  return { nota: Number(r.nota), maxima: Number(r.maxima), comentario: Boolean(r.comentario) };
}
