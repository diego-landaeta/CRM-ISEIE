/*
  CORREGIR DESDE EL CRM (#408, gemela de CRM#681; llega con CRM#1084).

  La tutora abre una tarea de su curso, ve lo que ha entregado cada alumno (el texto
  y los archivos) y le pone nota y comentario. La nota se guarda en Moodle a nombre
  de ella, por el plugin (`local_crm_calificar`): el alumno la ve en su campus como
  si la hubiera puesto allí.

  Puertas:
    · solo la tutora que es PROFESORA de ese curso en ese campus (se mira en Moodle);
    · los archivos se sirven desde el CRM con el token del campus: el navegador nunca
      ve el token, y solo se sirven archivos de entregas de sus tareas (nunca una
      dirección que mande el navegador).
*/
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import {
  matriculadosDe, tareasDeCursos, entregasDeTarea, notasDeTarea, calificarComoTutora,
  textoDeMoodle, urlDelCampus, porCorregir, contenidoDelCurso, entregasSinCorregir, cursosDe, MoodleError, esRolDeTutora,
} from '../../shared/services/moodle.client.js';
import { conexionDelCampus } from './tutor.campus.js';
import { olvidarMiCampus, alumnosDe } from './tutor.micampus.js';
import { textoParaElCampus } from '../consultas/consultas.service.js';
import { olvidarFichas } from '../consultas/consultas.contexto.js';

const comoAppError = (err, porDefecto) => new AppError(err instanceof MoodleError ? err.message : porDefecto, 502, 'MOODLE');

/** La conexión del campus y la tutora como profesora de ese curso, o 403/404. */
async function comoProfesora(tutorId, projectId, cursoId) {
  const { rows } = await query(
    `SELECT moodle_user_id FROM tutor_campus WHERE tutor_id = $1 AND project_id = $2 AND estado = 'activa' AND moodle_user_id IS NOT NULL`,
    [tutorId, projectId]);
  if (!rows[0]) throw new AppError('No estás dada de alta en este campus', 403, 'FORBIDDEN');
  const moodleId = Number(rows[0].moodle_user_id);
  const conexion = await conexionDelCampus(projectId);
  if (!conexion || conexion.error) throw new AppError(conexion?.error || 'El campus no está conectado', 409, 'SIN_CONEXION');
  let gente;
  try { gente = await matriculadosDe(conexion, cursoId); } catch (err) { throw comoAppError(err, 'No se ha podido leer el curso.'); }
  const yo = gente.find((g) => g.id === moodleId);
  if (!yo || !yo.roles.some((r) => esRolDeTutora(r))) throw new AppError('No eres profesora de este curso', 403, 'FORBIDDEN');
  return { conexion, moodleId, alumnos: alumnosDe(gente, yo) };
}

/** La tarea, si es de ese curso (o 404). */
async function tareaDelCurso(conexion, cursoId, tareaId) {
  const tarea = (await tareasDeCursos(conexion, [cursoId])).get(Number(cursoId))?.find((x) => x.id === Number(tareaId));
  if (!tarea) throw new AppError('Esa tarea no es de este curso', 404, 'NOT_FOUND');
  return tarea;
}

/** La tarea con TODAS las entregas de sus alumnos (también quien no ha entregado). */
export async function verTarea(tutorId, projectId, cursoId, tareaId) {
  const { conexion, alumnos } = await comoProfesora(tutorId, projectId, cursoId);
  let tarea; let entregas; let notas;
  try {
    tarea = await tareaDelCurso(conexion, cursoId, tareaId);
    [entregas, notas] = await Promise.all([entregasDeTarea(conexion, tareaId), notasDeTarea(conexion, tareaId)]);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw comoAppError(err, 'No se ha podido leer la tarea.');
  }
  const base = urlDelCampus(conexion.url);
  const porAlumno = new Map(entregas.map((e) => [e.alumnoId, e]));
  // El último mensaje del chat con cada alumno (Consultas), para verlo en la lista.
  const { rows: ultimos } = await query(
    `SELECT DISTINCT ON (c.alumno_moodle_id) c.alumno_moodle_id, c.id AS consulta_id, m.texto, m.escrito_at, m.autor
       FROM consulta_mensajes m JOIN consultas c ON c.id = m.consulta_id
      WHERE c.project_id = $1 AND c.alumno_moodle_id = ANY($2::bigint[]) AND c.tutor_id = $3
      ORDER BY c.alumno_moodle_id, m.escrito_at DESC, m.id DESC`,
    [projectId, alumnos.map((a) => a.id), tutorId]);
  const ultimoDe = new Map(ultimos.map((u) => [Number(u.alumno_moodle_id), {
    consultaId: Number(u.consulta_id), texto: String(u.texto || '').slice(0, 200), at: u.escrito_at, deTutora: u.autor === 'tutor',
  }]));
  const filas = alumnos.map((a) => {
    const e = porAlumno.get(a.id);
    const entregada = e?.estado === 'submitted';
    const nota = notas.get(a.id);
    // Vuelta a entregar después de la nota = otra vez por corregir.
    const estado = !entregada ? 'sin_entregar' : (porCorregir(e, nota) ? 'sin_corregir' : 'calificada');
    return {
      alumnoId: a.id, alumno: a.nombre, email: a.email, estado,
      entregadaAt: entregada ? e.entregadaAt : null,
      texto: entregada ? textoDeMoodle(e.texto) : '',
      archivos: entregada ? e.archivos.map((f) => ({ nombre: f.nombre, tamano: f.tamano, tipo: f.tipo })) : [],
      nota: nota?.nota ?? null,
      ultimoMensaje: ultimoDe.get(a.id) || null,
    };
  }).sort((x, y) => ['sin_corregir', 'calificada', 'sin_entregar'].indexOf(x.estado) - ['sin_corregir', 'calificada', 'sin_entregar'].indexOf(y.estado)
    || String(x.alumno || '').localeCompare(String(y.alumno || ''), 'es'));
  return {
    tarea: {
      id: tarea.id, nombre: tarea.nombre, notaMax: tarea.notaMax, entrega: tarea.entrega, comentarios: Boolean(tarea.comentarios),
      // Lo que no se puede corregir desde el CRM (se dice y se enlaza a Moodle).
      calificable: Boolean(tarea.calificable), enGrupo: Boolean(tarea.enGrupo),
      enunciado: tarea.enunciado ? textoDeMoodle(tarea.enunciado) : '',
      moodleUrl: `${base}/mod/assign/view.php?id=${tarea.cmid}&action=grading`,
    },
    entregas: filas,
  };
}

/**
 * El curso entero (#681, «ver el módulo del campus completo»): sus temas y todas sus
 * actividades, y en las tareas cuántas tiene por corregir. Solo para la profesora del curso.
 */
export async function verCurso(tutorId, projectId, cursoId) {
  const { conexion, moodleId, alumnos } = await comoProfesora(tutorId, projectId, cursoId);
  const base = urlDelCampus(conexion.url);
  let secciones; let tareas; let entregas; let suyos;
  try {
    [secciones, tareas, suyos] = await Promise.all([
      contenidoDelCurso(conexion, cursoId),
      tareasDeCursos(conexion, [cursoId]),
      cursosDe(conexion, moodleId),
    ]);
    const lista = tareas.get(Number(cursoId)) || [];
    entregas = await entregasSinCorregir(conexion, lista.map((x) => x.id));
  } catch (err) {
    // Un campus con el plugin de antes de la 1.5.0 no deja leer el contenido del curso.
    if (err instanceof MoodleError && /access|acceso|function|función/i.test(`${err.codigo} ${err.message}`)) {
      throw new AppError('Para ver el curso completo hay que actualizar el plugin del CRM de este campus a la versión 1.5.0.', 409, 'PLUGIN_ANTIGUO');
    }
    throw comoAppError(err, 'No se ha podido leer el curso.');
  }
  const deLaTarea = new Map((tareas.get(Number(cursoId)) || []).map((x) => [x.cmid, x]));
  const misAlumnos = new Set(alumnos.map((a) => a.id));
  const curso = suyos.find((k) => k.id === Number(cursoId));
  return {
    curso: { id: Number(cursoId), nombre: curso?.nombre || null, url: `${base}/course/view.php?id=${cursoId}`, alumnos: alumnos.length },
    secciones: secciones.map((s) => ({
      ...s,
      actividades: s.actividades.map((a) => {
        const tarea = a.tipo === 'assign' ? deLaTarea.get(a.cmid) : null;
        return {
          ...a,
          url: a.url || `${base}/mod/${a.tipo}/view.php?id=${a.cmid}`,
          tarea: tarea ? {
            id: tarea.id,
            porCorregir: tarea.enGrupo ? 0 : (entregas.get(tarea.id) || []).filter((e) => misAlumnos.has(e.alumnoId)).length,
            corregibleEnElCrm: Boolean(tarea.calificable && !tarea.enGrupo),
          } : null,
        };
      }),
    })),
  };
}

/** Pone la nota (y el comentario) a nombre de la tutora. */
export async function calificar(tutorId, projectId, cursoId, tareaId, { alumnoId, nota, comentario }) {
  const { conexion, moodleId, alumnos } = await comoProfesora(tutorId, projectId, cursoId);
  if (!alumnos.some((a) => a.id === Number(alumnoId))) throw new AppError('Ese alumno no está entre los tuyos en este curso (o es de otro grupo)', 404, 'NOT_FOUND');
  let tarea;
  try { tarea = await tareaDelCurso(conexion, cursoId, tareaId); } catch (err) {
    if (err instanceof AppError) throw err;
    throw comoAppError(err, 'No se ha podido leer la tarea.');
  }
  if (!tarea.calificable) throw new AppError('Esta tarea se califica con escala o sin nota: corrígela en el campus.', 409, 'NO_CALIFICABLE');
  if (tarea.enGrupo) throw new AppError('Es una tarea en grupo: corrígela en el campus.', 409, 'NO_CALIFICABLE');
  if (Number(nota) > tarea.notaMax) throw new AppError(`La nota máxima de esta tarea es ${tarea.notaMax}`, 400, 'VALIDATION_ERROR');
  let r;
  try {
    r = await calificarComoTutora(conexion, {
      desde: moodleId, tarea: Number(tareaId), alumno: Number(alumnoId), nota: Number(nota),
      comentario: String(comentario || '').trim() ? textoParaElCampus(comentario) : '',
    });
  } catch (err) { throw comoAppError(err, 'No se ha podido guardar la nota en el campus.'); }
  olvidarMiCampus(tutorId);
  olvidarFichas();
  return r;
}

/** Tipos que el navegador puede abrir en línea sin ejecutar nada. El resto, a descargar. */
const EN_LINEA = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']);
const MAX_ARCHIVO = 50 * 1024 * 1024;
const ESPERA_ARCHIVO_MS = 30_000;

/** ¿Es una dirección de archivos de ESE campus? Mismo origen y ruta de pluginfile bajo su base. */
export function esArchivoDelCampus(destino, base) {
  const raiz = new URL(base);
  if (destino.origin !== raiz.origin) return false;
  const prefijo = raiz.pathname.replace(/\/+$/, '');
  return destino.pathname.startsWith(`${prefijo}/pluginfile.php/`) || destino.pathname.startsWith(`${prefijo}/webservice/pluginfile.php/`);
}

/**
 * Un archivo entregado en una tarea de la tutora, servido desde el CRM con el token del
 * campus. No acepta direcciones: se pide por alumno y posición, y la dirección sale de
 * Moodle. Así solo se sirven archivos de entregas de SUS cursos, y nunca otra cosa.
 */
export async function archivo(tutorId, projectId, cursoId, tareaId, alumnoId, posicion, { fetchImpl = fetch } = {}) {
  const { conexion, alumnos } = await comoProfesora(tutorId, projectId, cursoId);
  if (!alumnos.some((a) => a.id === Number(alumnoId))) throw new AppError('Ese alumno no está entre los tuyos en este curso (o es de otro grupo)', 404, 'NOT_FOUND');
  let entrega;
  try {
    await tareaDelCurso(conexion, cursoId, tareaId);
    entrega = (await entregasDeTarea(conexion, tareaId)).find((e) => e.alumnoId === Number(alumnoId));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw comoAppError(err, 'No se ha podido leer la entrega.');
  }
  const f = entrega?.archivos?.[Number(posicion)];
  if (!f?.url) throw new AppError('Ese archivo no está en la entrega', 404, 'NOT_FOUND');
  let destino;
  try { destino = new URL(f.url); } catch { throw new AppError('El campus ha dado una dirección no válida', 502, 'MOODLE'); }
  if (!esArchivoDelCampus(destino, urlDelCampus(conexion.url))) throw new AppError('Ese archivo no es de este campus', 502, 'MOODLE');
  destino.pathname = destino.pathname.replace(/\/pluginfile\.php\//, '/webservice/pluginfile.php/').replace('/webservice/webservice/', '/webservice/');
  destino.searchParams.set('token', conexion.token);

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ESPERA_ARCHIVO_MS);
  try {
    let r;
    try { r = await fetchImpl(destino.toString(), { signal: control.signal, redirect: 'error' }); } catch {
      throw new AppError('El campus no ha respondido', 502, 'MOODLE');
    }
    if (!r.ok) throw new AppError(`El campus no ha dado el archivo (HTTP ${r.status})`, 502, 'MOODLE');
    if (Number(r.headers.get('content-length')) > MAX_ARCHIVO) throw new AppError('El archivo es demasiado grande para abrirlo desde el CRM', 413, 'DEMASIADO_GRANDE');
    const cuerpo = await leerConTope(r, MAX_ARCHIVO);
    const tipo = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    // Moodle contesta los errores de pluginfile con un 200 y un JSON: no es el archivo.
    if (tipo === 'application/json' && /"errorcode"/.test(cuerpo.subarray(0, 2000).toString('utf8'))) {
      throw new AppError('El campus no deja descargar el archivo con su token (revisa «Descargar archivos» en el servicio CRM).', 502, 'MOODLE');
    }
    const enLinea = EN_LINEA.has(tipo);
    return { cuerpo, tipo: enLinea ? tipo : 'application/octet-stream', enLinea, nombre: f.nombre || 'archivo' };
  } finally { clearTimeout(reloj); }
}

/** El cuerpo de la respuesta, cortando en cuanto pasa de `tope` bytes. */
async function leerConTope(r, tope) {
  if (!r.body?.getReader) {
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > tope) throw new AppError('El archivo es demasiado grande para abrirlo desde el CRM', 413, 'DEMASIADO_GRANDE');
    return b;
  }
  const lector = r.body.getReader();
  const trozos = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > tope) {
      await lector.cancel().catch(() => {});
      throw new AppError('El archivo es demasiado grande para abrirlo desde el CRM', 413, 'DEMASIADO_GRANDE');
    }
    trozos.push(value);
  }
  return Buffer.concat(trozos);
}
