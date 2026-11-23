/*
  EL AVANCE EN MOODLE, EN LA FICHA DEL ALUMNO (#532): que la comercial o la tutora
  sepa cómo va sin entrar en el campus.

  Por cada campus del alumno que tenga Moodle conectado y cada curso en el que esté
  matriculado allí:

    · el curso, el campus y la fecha de matrícula (la de la venta de ese curso en el CRM);
    · su último acceso al curso (y al campus);
    · el % hecho, el que da Moodle con la finalización de actividades. Si el curso no
      tiene la finalización activada, «sin seguimiento» (null), nunca un 0 %;
    · sus notas: las de cada actividad calificada y la final del curso;
    · el estado: activo · sin acceso desde hace más de X días (o nunca) · terminado.

  Va por la MISMA conexión que Consultas y «Mi campus» (`conexionDelCampus`: el token
  del servicio del plugin `local_crm`), sin una tercera. Las funciones son de solo
  lectura: `core_user_get_users_by_field`, `core_enrol_get_users_courses` (ya da el %
  con `progresoDeMoodle`, si lo terminó y el último acceso) y, desde el plugin 1.10.9,
  `gradereport_user_get_grade_items`. Con un plugin anterior no hay notas: se dice, y el
  resto sale igual.

  Para no castigar al campus, lo leído se guarda unos minutos por campus y alumno;
  «Actualizar» lo vuelve a pedir.

  GEMELA de CRM#871: en ISEIE `moodle_cursos_producto` llega con la migración 311 y
  `conexionDelCampus` es la misma de Consultas y «Mi campus» (#560). Si un curso no está
  enlazado a su producto, la fecha de matrícula se queda en null (la consulta lo tolera).
*/
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import {
  alumnoDelCampus, cursosDe, notasDelAlumno, urlDelCampus, MoodleError,
} from '../../shared/services/moodle.client.js';
import { conexionDelCampus } from '../tutores/tutor.campus.js';

const CACHE_MS = 5 * 60 * 1000;
/** Cursos de los que se piden notas por campus: una llamada por curso. */
const MAX_CURSOS_CON_NOTAS = 15;
const PARALELO = 4;
const cache = new Map();

/** Días sin entrar a partir de los cuales el curso sale como «sin acceso» (14 de serie). */
export function diasSinAccesoMaximos(env = process.env) {
  const n = parseInt(env.AVANCE_MOODLE_DIAS_SIN_ACCESO, 10);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : 14;
}

/**
 * El estado del alumno en un curso:
 *   · terminado   Moodle lo da por terminado (finalización del curso);
 *   · sin_acceso  nunca ha entrado (`dias` null) o lleva más de `maximo` días sin entrar;
 *   · activo      el resto.
 */
export function estadoDelCurso({ terminado, ultimoAcceso }, { ahora = new Date(), maximo = diasSinAccesoMaximos() } = {}) {
  if (terminado) return { estado: 'terminado', dias: null };
  if (!ultimoAcceso) return { estado: 'sin_acceso', dias: null };
  const dias = Math.max(0, Math.floor((ahora.getTime() - new Date(ultimoAcceso).getTime()) / 86_400_000));
  return { estado: dias > maximo ? 'sin_acceso' : 'activo', dias };
}

/** Los campus del alumno con Moodle conectado: el de su ficha y los de sus ventas. */
async function campusDelAlumno(lead) {
  const { rows } = await query(
    `SELECT p.id, p.nombre
       FROM projects p
      WHERE p.id IN (SELECT $2::int UNION SELECT project_id FROM conversions WHERE lead_id = $1)
        AND EXISTS (SELECT 1 FROM project_integrations i
                     WHERE i.project_id = p.id AND i.provider = 'moodle' AND i.active = true
                       AND i.encrypted_value IS NOT NULL)
      ORDER BY p.nombre, p.id`,
    [lead.id, lead.project_id]);
  return rows.map((r) => ({ id: Number(r.id), nombre: r.nombre }));
}

/**
 * La fecha de matrícula de cada curso de Moodle: la primera venta de este alumno de un
 * producto que es ese curso (`moodle_cursos_producto`, #767). { 'campus:curso': fecha }.
 * Sin la migración 311 aplicada no hay cómo saberlo: vacío, no error.
 */
async function fechasDeMatricula(leadId) {
  try {
    const { rows } = await query(
      `WITH prods AS (
         SELECT c.fecha_conversion, c.producto_contratado_id AS product_id
           FROM conversions c WHERE c.lead_id = $1 AND c.producto_contratado_id IS NOT NULL
         UNION ALL
         SELECT c.fecha_conversion, ci.product_id
           FROM conversions c JOIN conversion_items ci ON ci.conversion_id = c.id
          WHERE c.lead_id = $1 AND ci.product_id IS NOT NULL
       )
       SELECT m.project_id, m.curso_moodle_id, MIN(p.fecha_conversion) AS fecha
         FROM prods p JOIN moodle_cursos_producto m ON m.product_id = p.product_id
        GROUP BY m.project_id, m.curso_moodle_id`,
      [leadId]);
    return new Map(rows.map((r) => [`${r.project_id}:${r.curso_moodle_id}`, r.fecha]));
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') return new Map();
    throw err;
  }
}

/** De `n` en `n` a la vez, en orden. */
async function porTandas(lista, n, fn) {
  const fuera = new Array(lista.length);
  for (let i = 0; i < lista.length; i += n) {
    const tanda = await Promise.all(lista.slice(i, i + n).map((x, j) => fn(x, i + j)));
    tanda.forEach((r, j) => { fuera[i + j] = r; });
  }
  return fuera;
}

/** Lo que dice el campus de un alumno, sin el estado (que depende del día) ni las fechas del CRM. */
async function leerDelCampus(campus, correo, opciones) {
  const conexion = await conexionDelCampus(campus.id);
  if (!conexion) return { error: 'El campus no tiene Moodle conectado.' };
  if (conexion.error) return { error: conexion.error };
  const url = urlDelCampus(conexion.url);
  const fuera = { campusUrl: url, alumno: null, cursos: [], error: null, avisoNotas: null };
  try {
    const alumno = await alumnoDelCampus(conexion, { correo }, opciones);
    if (!alumno) return { ...fuera, error: 'No hay ninguna cuenta en este campus con el correo del alumno.' };
    fuera.alumno = {
      moodleId: alumno.id, suspendido: alumno.suspendido, ultimoAcceso: alumno.ultimoAcceso,
      perfilUrl: `${url}/user/profile.php?id=${alumno.id}`,
    };
    const cursos = await cursosDe(conexion, alumno.id, opciones);
    let notasSinPermiso = null;
    const notas = await porTandas(cursos.slice(0, MAX_CURSOS_CON_NOTAS), PARALELO, async (k) => {
      if (notasSinPermiso) return null;
      try {
        return await notasDelAlumno(conexion, k.id, alumno.id, opciones);
      } catch (err) {
        // Sin la función en el servicio del token (plugin anterior a la 1.10.9), ningún
        // curso la tendrá: se dice una vez y no se insiste.
        if (err instanceof MoodleError && ['SIN_FUNCION', 'PERMISO'].includes(err.codigo)) {
          notasSinPermiso = 'Las notas necesitan el plugin del CRM 1.10.9 o posterior en este campus.';
          return null;
        }
        if (err instanceof MoodleError) return { error: err.message };
        throw err;
      }
    });
    fuera.avisoNotas = notasSinPermiso
      || (cursos.length > MAX_CURSOS_CON_NOTAS ? `Notas solo de los ${MAX_CURSOS_CON_NOTAS} primeros cursos.` : null);
    fuera.cursos = cursos.map((k, i) => ({
      id: k.id, nombre: k.nombre, url: `${url}/course/view.php?id=${k.id}`,
      ultimoAcceso: k.ultimoAcceso, seguimiento: k.seguimiento, progreso: k.progreso, terminado: k.terminado,
      notas: notas[i] && !notas[i].error ? notas[i] : null,
      errorNotas: notas[i]?.error || null,
    }));
  } catch (err) {
    if (!(err instanceof MoodleError)) logger.warn({ projectId: campus.id, err: err.message }, 'leads/avance-moodle: fallo al leer el campus');
    fuera.error = err instanceof MoodleError ? err.message : 'No se ha podido leer el campus.';
  }
  return fuera;
}

/** Para las pruebas y para quien cambie algo en Moodle a mano. */
export function olvidarAvances() {
  cache.clear();
}

/**
 * El avance en Moodle de un alumno (un lead), en los campus que `campusPermitidos` deje
 * (null = todos los suyos). Quien llama ya ha comprobado que puede ver este lead.
 */
export async function avanceDelAlumno(lead, { campusPermitidos = null, refrescar = false, ahora = new Date(), ...opciones } = {}) {
  const maximo = diasSinAccesoMaximos();
  const todos = await campusDelAlumno(lead);
  const campus = campusPermitidos ? todos.filter((c) => campusPermitidos.includes(c.id)) : todos;
  const correo = String(lead.email || '').trim();
  const fechas = campus.length ? await fechasDeMatricula(lead.id) : new Map();

  const bloques = await porTandas(campus, PARALELO, async (c) => {
    const base = { projectId: c.id, campus: c.nombre };
    if (!correo) return { ...base, campusUrl: null, alumno: null, cursos: [], avisoNotas: null, error: 'El alumno no tiene correo: no se puede buscar en el campus.' };
    const clave = `${c.id}:${correo.toLowerCase()}`;
    let leido = cache.get(clave);
    if (refrescar || !leido || Date.now() - leido.at > CACHE_MS) {
      leido = { at: Date.now(), datos: await leerDelCampus(c, correo, opciones) };
      if (cache.size > 500) cache.clear();
      // Un campus caído no se guarda: al volver a abrir la ficha se reintenta.
      if (!leido.datos.error || leido.datos.alumno) cache.set(clave, leido);
    }
    const d = leido.datos;
    return {
      ...base,
      campusUrl: d.campusUrl || null,
      alumno: d.alumno || null,
      error: d.error || null,
      avisoNotas: d.avisoNotas || null,
      leidoAt: new Date(leido.at),
      cursos: (d.cursos || []).map((k) => {
        const { estado, dias } = estadoDelCurso(k, { ahora, maximo });
        return { ...k, matriculadoEl: fechas.get(`${c.id}:${k.id}`) || null, estado, diasSinAcceso: dias };
      }),
    };
  });
  return { disponible: true, diasSinAccesoMaximos: maximo, campus: bloques };
}
