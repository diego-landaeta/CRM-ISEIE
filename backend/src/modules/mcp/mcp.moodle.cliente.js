import { query } from '../../shared/config/db.js';
import { decrypt } from '../../shared/utils/crypto.js';
import { logger } from '../../shared/utils/logger.js';
import { marcarUso } from '../credentials/credentials.model.js';
import { enteroEnv } from './mcp.config.js';

/**
 * El cliente de los Moodle de los campus (#335), SOLO LECTURA.
 *
 * COMO SE HA PROBADO
 *
 * Con `fetch` simulado (tests/mcpMoodle.test.js) y, el 21/10, contra el Moodle
 * REAL de Psiko con un servicio propio de solo lectura. Salieron dos cosas que
 * ningun simulacro habia previsto: el oEmbed de YouTube da 404 a las direcciones
 * `/embed/ID`, y un curso con la finalizacion «activada» puede no tener criterios
 * (`nocriteriaset`). Si un Moodle responde otra cosa, el sintoma es un error
 * claro por campus, nunca un cero.
 *
 * LA REGLA DE ESTE FICHERO
 *
 *   El token de Moodle es un secreto. Va en el CUERPO de un POST (nunca en la
 *   URL: asi no esta en ningun mensaje de error de red, ni en el log de un
 *   proxy), no se escribe en el log y NUNCA se devuelve, ni dentro de un error.
 *   Los mensajes que salen de aqui se fabrican con texto nuestro y el codigo de
 *   error de Moodle; la URL de la peticion no sale jamas.
 *
 * Donde vive: en el sistema de credenciales (cifrado AES-256), servicio
 * `moodle`, una por campus. El valor es un JSON: {"url":"https://…","token":"…"}.
 */

/**
 * Las UNICAS funciones de Moodle que se pueden llamar. Todas empiezan por
 * «get»: ninguna escribe. `llamarMoodle` se niega a lanzar cualquier otra, y
 * una prueba lo vigila. Para anadir una, hay que anadirla AQUI, a la vista.
 */
export const FUNCIONES_MOODLE = Object.freeze([
  'core_course_get_courses_by_field',
  'core_course_get_categories',
  'core_enrol_get_enrolled_users',
  'core_course_get_contents',
  'mod_url_get_urls_by_courses',
  // «Terminados» (#335): Moodle solo lo dice alumno por alumno.
  'core_completion_get_course_completion_status',
]);

export const SERVICIO_MOODLE = 'moodle';

/** Una peticion a Moodle no espera mas de esto (MCP_MOODLE_TIMEOUT_MS, 8 s). */
export const timeoutMoodleMs = () => enteroEnv('MCP_MOODLE_TIMEOUT_MS', 8000);

/** Un fallo de UN campus. El mensaje es nuestro y seguro de ensenar. */
export class ErrorMoodle extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorMoodle';
    this.codigo = codigo;
  }
}

/** Cuanto texto de un mensaje de Moodle se deja pasar. */
const MAX_MENSAJE = 200;

/**
 * Quita de un texto lo que pueda ser el token, aunque sea en un trozo de URL.
 * Se aplica a TODO mensaje que venga de fuera (de Moodle o de la red) antes de
 * enseñarlo.
 */
export function limpiarSecretos(texto, token = null) {
  let s = String(texto ?? '');
  if (token && String(token).length >= 4) s = s.split(String(token)).join('[token]');
  s = s.replace(/(wstoken|token|moodlewssettingtoken)=[^&\s"'<>]+/gi, '$1=[token]');
  return s.slice(0, MAX_MENSAJE);
}

// ─── Credenciales ─────────────────────────────────────────────────────────

/**
 * La URL base del Moodle, validada: solo http(s), sin usuario ni contrasena en
 * ella, y sin parte de «server.php» (se pone aqui).
 */
export function normalizarUrlMoodle(url) {
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  u.search = '';
  u.hash = '';
  const ruta = u.pathname.replace(/\/webservice\/.*$/i, '').replace(/\/+$/, '');
  return `${u.origin}${ruta}`;
}

/**
 * Lee el valor guardado: {url, token}. Devuelve {url, token} o lanza un
 * ErrorMoodle SIN el valor dentro (un JSON mal escrito suele llevar el token).
 */
export function leerValorMoodle(valor) {
  let o;
  try {
    o = JSON.parse(valor);
  } catch {
    throw new ErrorMoodle('credencial_mal_formada', 'la credencial de Moodle no es un JSON con «url» y «token»');
  }
  const url = normalizarUrlMoodle(o?.url ?? o?.sitio ?? '');
  const token = typeof (o?.token ?? o?.wstoken) === 'string' ? (o.token ?? o.wstoken).trim() : '';
  if (!url) throw new ErrorMoodle('credencial_mal_formada', 'la URL de Moodle de la credencial no es válida (debe ser http o https)');
  if (!token) throw new ErrorMoodle('credencial_mal_formada', 'la credencial de Moodle no trae «token»');
  return { url, token };
}

/**
 * Qué campus tienen una credencial `moodle` activa de produccion. Solo EXISTENCIA:
 * no se descifra nada. Es lo que enseña la pantalla Conexion → MCP para que se vea,
 * de un vistazo, en cuales puede Claude consultar Moodle.
 */
export async function campusConMoodle(projectIds) {
  if (!projectIds?.length) return new Set();
  try {
    const { rows } = await query(
      `SELECT DISTINCT project_id
         FROM api_credentials
        WHERE service = $1 AND project_id = ANY($2::int[]) AND active = true
          AND COALESCE(metadata->>'entorno', 'produccion') = 'produccion'`,
      [SERVICIO_MOODLE, projectIds]
    );
    return new Set(rows.map((r) => Number(r.project_id)));
  } catch (err) {
    // 22P02: el enum aun no tiene «moodle» (falta la migracion 220): ninguno.
    if (err?.code === '22P02') return new Set();
    throw err;
  }
}

/**
 * Las credenciales `moodle` de varios campus de una vez, en UNA consulta de
 * lectura, solo las de produccion. Devuelve Map(project_id → {url, token} |
 * ErrorMoodle). Un campus sin credencial no esta en el mapa.
 *
 * La lectura del valor cifrado pasa por aqui y no por `getDecryptedValue`
 * porque pide varios campus a la vez; marca el uso igual que aquella.
 */
export async function credencialesMoodle(projectIds) {
  const resultado = new Map();
  let rows;
  try {
    ({ rows } = await query(
      `SELECT project_id, encrypted_value, iv, auth_tag
         FROM api_credentials
        WHERE service = $1 AND project_id = ANY($2::int[]) AND active = true
          AND COALESCE(metadata->>'entorno', 'produccion') = 'produccion'`,
      [SERVICIO_MOODLE, projectIds]
    ));
  } catch (err) {
    // 22P02: el enum de servicios aun no tiene «moodle» (falta la migracion
    // 220). Entonces no hay ninguna configurada, que es lo cierto.
    if (err?.code === '22P02') return resultado;
    throw err;
  }
  for (const r of rows) {
    const id = Number(r.project_id);
    if (!projectIds.includes(id)) continue;
    try {
      resultado.set(id, leerValorMoodle(decrypt(r.encrypted_value, r.iv, r.auth_tag)));
      marcarUso(SERVICIO_MOODLE, id);
    } catch (err) {
      if (err instanceof ErrorMoodle) {
        resultado.set(id, err);
      } else {
        // No se descifra (clave del servidor cambiada, fila corrupta). Sin el
        // valor ni el mensaje de la libreria en la respuesta.
        logger.warn({ projectId: id }, 'MCP Moodle: no se pudo descifrar la credencial');
        resultado.set(id, new ErrorMoodle('credencial_ilegible', 'no se pudo leer la credencial de Moodle guardada'));
      }
    }
  }
  return resultado;
}

// ─── Llamadas ─────────────────────────────────────────────────────────────

/** `{a:[1,2], b:{c:3}}` → `a[0]=1&a[1]=2&b[c]=3`, como los espera el REST de Moodle. */
export function aplanarParametros(params, prefijo = '', salida = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const clave = prefijo ? `${prefijo}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (x !== null && typeof x === 'object') aplanarParametros(x, `${clave}[${i}]`, salida);
        else salida.append(`${clave}[${i}]`, String(x));
      });
    } else if (typeof v === 'object') {
      aplanarParametros(v, clave, salida);
    } else {
      salida.append(clave, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    }
  }
  return salida;
}

/** Une la señal de la herramienta (el tope global) con el tiempo de ESTA peticion. */
function senalCombinada(signal, ms) {
  const tiempo = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, tiempo]) : tiempo;
}

/**
 * Una llamada a Moodle. Devuelve el JSON ya decodificado o lanza ErrorMoodle.
 *
 * Moodle contesta SIEMPRE HTTP 200, tambien cuando falla: el fallo viene como
 * `{exception, errorcode, message}` (o `{error, errorcode}` si los servicios web
 * ni estan activados). Eso se trata como error, no como respuesta.
 */
export async function llamarMoodle({ url, token }, funcion, params = {}, { signal } = {}) {
  if (!FUNCIONES_MOODLE.includes(funcion)) {
    // Un error de programacion, no de Moodle: no llega a la red.
    throw new Error(`Función de Moodle no permitida (solo lectura): ${funcion}`);
  }
  const cuerpo = aplanarParametros(params);
  cuerpo.set('wstoken', token);
  cuerpo.set('wsfunction', funcion);
  cuerpo.set('moodlewsrestformat', 'json');

  let res;
  try {
    res = await fetch(`${url}/webservice/rest/server.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: cuerpo.toString(),
      // Nunca se sigue una redireccion: un 307 reenviaria el token a otro host.
      redirect: 'manual',
      signal: senalCombinada(signal, timeoutMoodleMs()),
    });
  } catch (err) {
    // Aqui NO se usa err.message: el de Node lleva a veces la URL.
    if (signal?.aborted) throw err;
    const motivo = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'no ha contestado a tiempo' : 'no responde';
    throw new ErrorMoodle('sin_respuesta', `Moodle ${motivo}`);
  }

  if (res.status >= 300 && res.status < 400) {
    throw new ErrorMoodle('redireccion', 'Moodle redirige la petición: la URL guardada no es la final (¿http en vez de https?)');
  }
  if (res.status < 200 || res.status >= 300) {
    throw new ErrorMoodle('http', `Moodle contestó HTTP ${res.status}`);
  }

  let texto;
  try {
    texto = await res.text();
  } catch {
    throw new ErrorMoodle('sin_respuesta', 'Moodle cortó la respuesta');
  }
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new ErrorMoodle('respuesta_no_valida', 'Moodle no contestó JSON (¿es la URL del Moodle y tiene los servicios web activados?)');
  }

  if (datos && typeof datos === 'object' && !Array.isArray(datos) && (datos.exception || datos.errorcode)) {
    throw errorDeExcepcion(datos, funcion, token);
  }
  return datos;
}

/** Traduce `{exception, errorcode, message}` de Moodle a algo que se entienda. */
function errorDeExcepcion(d, funcion, token) {
  const codigo = String(d.errorcode || d.exception || 'desconocido').slice(0, 60);
  const tokenMalo = ['invalidtoken', 'invalidlogin', 'tokenexpired'];
  if (tokenMalo.includes(codigo)) {
    return new ErrorMoodle('token_no_valido', 'token no válido o caducado');
  }
  if (['accessexception', 'nopermissions', 'webservice_access_exception', 'servicenotavailable', 'accessdenied'].includes(codigo)
    || /access control exception|not allowed|no tiene permiso/i.test(String(d.message || d.error || ''))) {
    return new ErrorMoodle('sin_permiso', `el token no tiene permiso para «${funcion}» (Moodle: ${codigo})`);
  }
  if (codigo === 'enablewsdescription') {
    return new ErrorMoodle('servicios_web_apagados', 'los servicios web no están activados en ese Moodle');
  }
  const detalle = limpiarSecretos(d.message || d.error || '', token);
  const e = new ErrorMoodle('moodle', `Moodle devolvió un error (${codigo})${detalle ? `: ${detalle}` : ''}`);
  // El codigo de Moodle, para quien necesite distinguir (p. ej. `nocriteriaset`).
  e.moodle = codigo;
  return e;
}
