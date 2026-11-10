import { llamarMoodle, ErrorMoodle } from '../mcp/mcp.moodle.cliente.js';

/**
 * Probar una conexión a Moodle ANTES de guardarla (#335).
 *
 * Conectar un campus es dar su dirección y un token. Para que quien lo hace sepa si ha
 * funcionado, aquí se comprueba contra el propio Moodle:
 *
 *   · Si no puede ni leer los cursos (token inválido, caducado, Moodle apagado, o sin la
 *     función de leer cursos), la conexión NO sirve: se lanza el error y no se guarda nada.
 *   · Si lee los cursos pero al servicio del token le faltan funciones de las demás, la
 *     conexión sirve a medias: se guarda y se dice QUÉ se pierde con cada una que falta.
 *
 * Todo es lectura: solo se llama a funciones de la lista cerrada de `mcp.moodle.cliente.js`.
 */

/** Qué se pierde cuando al token le falta cada función (para decírselo a quien conecta). */
export const CONSECUENCIA = Object.freeze({
  core_course_get_categories: 'no se podrá filtrar por categoría',
  core_enrol_get_enrolled_users: 'no se contarán los alumnos',
  core_course_get_contents: 'no se verá el contenido de los cursos ni sus recursos externos',
  mod_url_get_urls_by_courses: 'no se verán los enlaces de los módulos URL',
});

export async function probarConexion(cred, { signal } = {}) {
  // 1 · Lo imprescindible. Si falla, lanza ErrorMoodle con un mensaje que se puede enseñar.
  const r = await llamarMoodle(cred, 'core_course_get_courses_by_field', {}, { signal });
  if (!r || !Array.isArray(r.courses)) {
    throw new ErrorMoodle('respuesta_no_valida', 'Moodle no devolvió la lista de cursos con el formato esperado');
  }
  const cursos = r.courses.filter((c) => c && c.format !== 'site');

  // 2 · Lo demás: una llamada de prueba a cada función. Solo cuenta lo que Moodle dice que
  // «este token no tiene permiso para esto»; otro fallo (un curso raro) no se confunde con eso.
  const faltan = [];
  const probar = async (funcion, params) => {
    try {
      await llamarMoodle(cred, funcion, params, { signal });
    } catch (err) {
      if (signal?.aborted || !(err instanceof ErrorMoodle)) throw err;
      if (err.codigo === 'sin_permiso') faltan.push(funcion);
    }
  };
  await probar('core_course_get_categories', {});
  const primero = cursos[0];
  if (primero) {
    await probar('core_enrol_get_enrolled_users', { courseid: primero.id, options: [{ name: 'limitnumber', value: 1 }] });
    await probar('core_course_get_contents', { courseid: primero.id });
    await probar('mod_url_get_urls_by_courses', { courseids: [primero.id] });
  }

  return {
    cursos: cursos.length,
    faltan: faltan.map((funcion) => ({ funcion, consecuencia: CONSECUENCIA[funcion] })),
  };
}
