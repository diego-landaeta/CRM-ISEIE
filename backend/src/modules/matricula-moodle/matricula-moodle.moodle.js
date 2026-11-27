import { llamar, MoodleError, urlDelCampus } from '../../shared/services/moodle.client.js';
import { conexionDelCampus } from '../tutores/tutor.campus.js';

/**
 * Matrícula automática en Moodle (#455, gemela CRM#767) · fase 2: matricular de verdad.
 *
 * Llama a `local_crm_matricular` (plugin `local_crm` 1.12.0, Campus-Moodle#8) por la
 * conexión del plugin del campus (Integraciones), la misma de Consultas y «Mi campus».
 * El plugin busca la cuenta por correo, la crea si no existe SIN mandar nada (los
 * datos de acceso los manda el CRM, decisión de Diego del 23/11), matricula como
 * alumno y, si la cuenta es nueva, devuelve un enlace de un solo uso (7 días) para
 * poner la contraseña.
 *
 * Lo que devuelve `matricularEnMoodle` (lo interpreta `procesar`):
 *
 *   { hecha: true, moodleUserId, nuevo, enlace, cursos, fallidos, campusUrl }
 *        todos los cursos `matriculado`/`ya_estaba`, o algunos (fallidos = los que no:
 *        hecha parcial, con aviso de cuáles).
 *   { hecha: false, sinConexion: true }
 *        el campus no tiene el plugin conectado: como en la fase 1, «lista» y a mano.
 *   { hecha: false, definitivo: true, tipo: 'suspendido'|'rechazada', ambito?, motivo }
 *        no se arregla reintentando (cuenta o matrícula suspendida, correo repetido,
 *        administrador, rol, correo o nombre malos, ningún curso se pudo): aviso ya.
 *        En una suspensión, `ambito` dice qué: 'cuenta' o 'curso' (la matrícula).
 *   { hecha: false, lento: true, motivo }
 *        el campus no está preparado (sin la 1.12.0, token sin permiso o caducado):
 *        aviso una vez y se reintenta despacio, sin quemar los intentos en horas.
 *
 * Un fallo de red o pasajero LANZA: `procesar` lo cuenta como intento y reintenta en
 * una hora, como en la fase 1.
 *
 * EL ENLACE ES UNA CREDENCIAL: quien lo tiene entra en la cuenta del alumno. No se
 * guarda en la base ni se escribe en el registro; solo viaja al correo.
 */

export const FUNCION = 'local_crm_matricular';

/** Rechazos del plugin que no cambian por reintentar (Campus-Moodle#8). */
export const RECHAZOS = new Set([
  'matricular_correo_repetido',
  'matricular_es_admin',
  'matricular_rol_no_alumno',
  'matricular_rol_no_existe',
  'matricular_correo_malo',
  'matricular_sin_nombre',
  'matricular_sin_cursos',
]);

/** El campus no está preparado: se avisa y se espera, no se reintenta cada hora. */
const DE_CONFIGURACION = new Set(['SIN_FUNCION', 'PERMISO', 'TOKEN', 'WS_APAGADOS']);

/**
 * Nombre y apellidos para Moodle, que exige los dos. La ficha solo tiene `nombre`:
 * la primera palabra es el nombre y el resto, los apellidos. Con una sola palabra,
 * un guion en los apellidos (Moodle no admite vacío).
 */
export function partirNombre(completo) {
  const partes = String(completo || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return { nombre: '', apellidos: '' };
  return { nombre: partes[0], apellidos: partes.slice(1).join(' ') || '-' };
}

/**
 * Por qué no se pudo un curso. El plugin no da código por curso, solo el texto
 * (en el idioma del campus): la matrícula suspendida se reconoce por él.
 */
export const esSuspension = (mensaje) => /suspend/i.test(String(mensaje || ''));

/** Solo un enlace del propio campus y por http(s): lo que se manda al alumno. */
function enlaceDelCampus(enlace, campusUrl) {
  const e = String(enlace || '').trim();
  if (!e) return '';
  try {
    const u = new URL(e);
    const c = new URL(campusUrl);
    if (!/^https?:$/.test(u.protocol) || u.host !== c.host) return '';
    return u.toString();
  } catch {
    return '';
  }
}

/** Los parámetros tal como los espera la API REST de Moodle (`cursos[0]=…`). */
export function parametros({ correo, nombre, apellidos, cursoIds }) {
  const p = { correo, nombre, apellidos };
  cursoIds.forEach((id, i) => { p[`cursos[${i}]`] = id; });
  return p;
}

const nombreDelCurso = (c) => c.curso_nombre || `curso id ${c.curso_moodle_id}`;

/**
 * Matricula en Moodle al alumno de `fila` en `cursos` (los de `comprobar`).
 * `deps` solo lo usan las pruebas.
 */
export async function matricularEnMoodle(fila, cursos, { llamarImpl = llamar, conexionImpl = conexionDelCampus } = {}) {
  const conexion = await conexionImpl(fila.project_id);
  if (!conexion) return { hecha: false, sinConexion: true };
  if (conexion.error) return { hecha: false, lento: true, motivo: conexion.error };
  const campusUrl = urlDelCampus(conexion.url);

  // Los cursos de ESTE campus (un producto puede tener cursos en varios campus; el de
  // otro Moodle no se puede pedir con este token).
  const delCampus = cursos.filter((c) => Number(c.project_id ?? fila.project_id) === Number(fila.project_id));
  const deOtro = cursos.filter((c) => !delCampus.includes(c));
  if (!delCampus.length) {
    return {
      hecha: false, definitivo: true, tipo: 'rechazada',
      motivo: `Los cursos de la venta son de otro campus (${deOtro.map(nombreDelCurso).join(', ')}): este no los puede matricular`,
    };
  }
  const cursoIds = [...new Set(delCampus.map((c) => Number(c.curso_moodle_id)))];
  const { nombre, apellidos } = partirNombre(fila.alumno_nombre);

  let r;
  try {
    r = await llamarImpl(conexion, FUNCION, parametros({
      correo: String(fila.alumno_email || '').trim(), nombre, apellidos, cursoIds,
    }));
  } catch (err) {
    if (!(err instanceof MoodleError)) throw err;
    if (err.errorcode && (RECHAZOS.has(err.errorcode) || /^matricular_/.test(err.errorcode))) {
      return { hecha: false, definitivo: true, tipo: 'rechazada', motivo: `El campus ha rechazado la matrícula: ${err.message.replace(/^El campus ha dicho: /, '')}` };
    }
    if (err.codigo === 'SIN_FUNCION') {
      return {
        hecha: false, lento: true,
        motivo: 'El campus no tiene el plugin 1.12.0 (le falta la función de matricular): hay que actualizar el plugin del campus',
      };
    }
    if (DE_CONFIGURACION.has(err.codigo)) return { hecha: false, lento: true, motivo: err.message };
    // No llegó al campus (el freno común, lleno; o la petición, cerrada): el campus no ha
    // dicho nada. Ni es «sin preparar» (`lento` suma un intento, aplaza 24 h y avisa) ni un
    // fallo: se aplaza un rato sin gastar intento (el servicio, con `model.aplazar`).
    if (err.codigo === 'OCUPADO' || err.codigo === 'CANCELADA') return { hecha: false, aplazar: true, motivo: err.message };
    throw err; // red, tiempo, HTTP, un error de Moodle sin código conocido: reintento normal
  }

  if (!r || typeof r !== 'object' || !Array.isArray(r.cursos)) {
    throw new MoodleError('El campus ha contestado a la matrícula sin el formato esperado.', 'NO_ES_MOODLE');
  }

  const porId = new Map(r.cursos.map((c) => [Number(c.id), c]));
  const conResultado = cursos.map((c) => {
    const x = porId.get(Number(c.curso_moodle_id));
    if (!delCampus.includes(c)) return { ...c, resultado: 'error', mensaje: 'Es de otro campus' };
    return { ...c, resultado: x?.resultado || 'error', mensaje: x?.mensaje || (x ? '' : 'El campus no ha dicho nada de este curso') };
  });
  const moodleUserId = Number(r.userid) || null;

  if (r.estado === 'suspendido') {
    return {
      hecha: false, definitivo: true, tipo: 'suspendido', ambito: 'cuenta', moodleUserId,
      motivo: `La cuenta del alumno está suspendida en Moodle${moodleUserId ? ` (id ${moodleUserId})` : ''}: no se reactiva sola. Revísala (¿impago?) y, si procede, reactívala y matricúlale a mano`,
    };
  }

  const bien = conResultado.filter((c) => c.resultado === 'matriculado' || c.resultado === 'ya_estaba');
  const fallidos = conResultado.filter((c) => !bien.includes(c));
  if (!bien.length) {
    const suspendida = fallidos.some((c) => esSuspension(c.mensaje));
    return {
      hecha: false, definitivo: true, tipo: suspendida ? 'suspendido' : 'rechazada', ...(suspendida ? { ambito: 'curso' } : {}), moodleUserId,
      motivo: `No se ha podido matricular en ningún curso: ${fallidos.map((c) => `${nombreDelCurso(c)} (${c.mensaje || 'error'})`).join('; ')}`,
    };
  }

  return {
    hecha: true,
    moodleUserId,
    nuevo: !!r.nuevo,
    enlace: enlaceDelCampus(r.enlace, campusUrl),
    cursos: conResultado,
    fallidos,
    campusUrl,
  };
}
