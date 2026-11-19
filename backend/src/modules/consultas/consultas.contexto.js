/*
  LA FICHA DEL ALUMNO junto a la conversación (#679): lo que la tutora necesita
  para contestar sin salir del CRM.

    · sus cursos en el campus y cuándo entró por última vez;
    · sus entregas SIN CORREGIR en esos cursos, con el enlace para corregirlas;
    · sus otras consultas;
    · los enlaces a Moodle (su perfil, la conversación).

  Se lee de Moodle en el momento con el token del campus. Si el campus no
  contesta, la ficha lo dice y el resto (consultas anteriores) sale igual.
*/
import { query } from '../../shared/config/db.js';
import {
  cursosDe, tareasDeCursos, entregasSinCorregir, urlDelCampus, MoodleError,
} from '../../shared/services/moodle.client.js';
import { conexionDelCampus } from '../tutores/tutor.campus.js';

/** La ficha se pide al abrir cada consulta y lee el campus: un minuto de copia. */
const CACHE_MS = 60_000;
const cache = new Map();

/** Tras poner una nota: que ninguna ficha enseñe la entrega como pendiente. */
export function olvidarFichas() {
  cache.clear();
}

export async function contextoDeLaConsulta(c, { quien = 'admin', userId = null, refrescar = false, ...opciones } = {}) {
  const clave = `${c.id}:${quien}:${userId}`;
  const guardada = cache.get(clave);
  if (!refrescar && guardada && Date.now() - guardada.at < CACHE_MS) return guardada.ficha;
  const ficha = await leerFicha(c, { quien, userId, opciones });
  if (cache.size > 500) cache.clear();
  cache.set(clave, { at: Date.now(), ficha });
  return ficha;
}

async function leerFicha(c, { quien, userId, opciones }) {
  const ficha = { campusUrl: null, perfilUrl: null, conversacionUrl: null, cursos: [], entregas: [], anteriores: [], error: null };

  const { rows } = await query(
    `SELECT id, estado, entrada_at, cerrada_at,
            (SELECT texto FROM consulta_mensajes m WHERE m.consulta_id = c.id ORDER BY m.id LIMIT 1) AS primero
       FROM consultas c
      WHERE project_id = $1 AND alumno_moodle_id = $2 AND id <> $3
        AND ($4::int IS NULL OR tutor_id = $4)
      ORDER BY entrada_at DESC LIMIT 10`,
    [c.project_id, c.alumno_moodle_id, c.id, quien === 'tutor' ? userId : null]);
  ficha.anteriores = rows.map((r) => ({
    id: Number(r.id), estado: r.estado, entradaAt: r.entrada_at,
    resumen: String(r.primero || '').slice(0, 140),
  }));

  if (!c.alumno_moodle_id) return ficha;
  const conexion = await conexionDelCampus(c.project_id);
  if (!conexion || conexion.error) {
    ficha.error = conexion?.error || 'El campus no está conectado: no se pueden leer sus cursos.';
    return ficha;
  }
  const url = urlDelCampus(conexion.url);
  ficha.campusUrl = url;
  ficha.perfilUrl = `${url}/user/profile.php?id=${c.alumno_moodle_id}`;
  // El chat de grupo de la consulta (plugin 1.9.0) o, si no tiene, la conversación privada.
  ficha.conversacionUrl = c.conversacion_grupo_id
    ? `${url}/message/index.php?convid=${c.conversacion_grupo_id}`
    : `${url}/message/index.php?id=${c.alumno_moodle_id}`;

  try {
    const cursos = await cursosDe(conexion, c.alumno_moodle_id, opciones);
    ficha.cursos = cursos.map((k) => ({
      id: k.id, nombre: k.nombre, ultimoAcceso: k.ultimoAcceso ?? null, url: `${url}/course/view.php?id=${k.id}`,
    }));
    const tareas = await tareasDeCursos(conexion, cursos.map((k) => k.id), opciones);
    const lista = [...tareas.entries()].flatMap(([cursoId, ts]) => ts.map((t) => ({ ...t, cursoId })));
    const entregas = await entregasSinCorregir(conexion, lista.map((t) => t.id), opciones);
    const susCursos = await cursosDeLaTutora(conexion, c.project_id, quien === 'tutor' ? userId : null, opciones);
    ficha.entregas = lista.flatMap((t) => (entregas.get(t.id) || [])
      .filter((e) => e.alumnoId === Number(c.alumno_moodle_id))
      .map((e) => ({
        tareaId: t.id, tarea: t.nombre, cursoId: t.cursoId,
        curso: cursos.find((k) => k.id === t.cursoId)?.nombre || null,
        entregadaAt: e.entregadaAt,
        enElCrm: Boolean(t.calificable && !t.enGrupo && susCursos?.has(t.cursoId)),
        corregirUrl: `${url}/mod/assign/view.php?id=${t.cmid}&action=grader&userid=${c.alumno_moodle_id}`,
      })));
  } catch (err) {
    ficha.error = err instanceof MoodleError ? err.message : 'No se ha podido leer su campus.';
  }
  return ficha;
}

/** Los cursos del campus donde está la tutora que mira (null si no es tutora o no está vinculada). */
async function cursosDeLaTutora(conexion, projectId, tutorId, opciones) {
  if (!tutorId) return null;
  const { rows } = await query(
    `SELECT moodle_user_id FROM tutor_campus WHERE tutor_id = $1 AND project_id = $2 AND estado = 'activa' AND moodle_user_id IS NOT NULL`,
    [tutorId, projectId]);
  if (!rows[0]) return null;
  try {
    return new Set((await cursosDe(conexion, Number(rows[0].moodle_user_id), opciones)).map((k) => k.id));
  } catch { return null; }
}
