// El correo de «cambio de estado» del tablero (Diego, 26/10/2026: «uno para
// cuando cambian el status»).
//
// A quién: el responsable, el supervisor y quien la creó, quitando a quien hizo
// el cambio y a quien ya recibió por ese cambio su correo propio («Tarea
// devuelta», «Tarea completada», «Para revisar»): dos correos por lo mismo
// enseñan a no abrir ninguno.
//
// Agrupado: si en ~2 minutos la tarea se mueve varias veces (arrastrarla de
// columna en columna, equivocarse y volver), sale UN correo con el estado de
// antes de la ráfaga y el último. El cambio espera en `task_status_notices`
// (migración 240), no en memoria: un reinicio en medio no se lo come. Si la
// migración no está, sale al momento, sin agrupar.
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import * as taskModel from './tasks.model.js';
import { enviarCorreoCambioEstado, AVISO_TAREA_ESTADO } from './tasks.emails.js';

/** La ventana para agrupar, en segundos (TAREAS_ESTADO_AGRUPAR_SEG, 120 por defecto). */
export const ventanaMs = () => {
  const s = parseInt(process.env.TAREAS_ESTADO_AGRUPAR_SEG || '120', 10);
  return (Number.isFinite(s) && s >= 0 ? s : 120) * 1000;
};

let hayTabla = null;
async function tablaLista() {
  if (hayTabla) return true;
  try {
    const { rows: [r] } = await query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_schema = 'public' AND table_name = 'task_status_notices') AS hay`);
    hayTabla = r?.hay === true;
    if (!hayTabla) logger.warn('Tareas: falta la migración 240, los cambios de estado salen sin agrupar');
  } catch {
    hayTabla = false;
  }
  return hayTabla;
}
/** Solo para las pruebas. */
export function _olvidarTabla() { hayTabla = null; }

/**
 * A quién le toca el correo de un cambio: responsable, supervisor y creador, sin
 * quien lo hizo ni quien ya tiene su correo propio. Con el papel de cada uno en
 * la tarea, para el texto (si es dos cosas, manda la primera).
 */
export function destinatariosDelCambio(tarea, autorId, yaConCorreo = []) {
  const quitar = new Set([autorId, ...(yaConCorreo || [])].filter(Boolean).map(Number));
  const lista = new Map();
  for (const [id, rol] of [
    [tarea.assigned_to, 'responsable'],
    [tarea.supervisor_id, 'supervisor'],
    [tarea.created_by, 'creador'],
  ]) {
    if (!id || quitar.has(Number(id)) || lista.has(Number(id))) continue;
    lista.set(Number(id), rol);
  }
  return [...lista].map(([id, rol]) => ({ id, rol }));
}

let temporizador = null;
function programarVuelta() {
  // En las pruebas se llama a mano a `procesarCambiosDeEstado`.
  if (process.env.NODE_ENV === 'test' || temporizador) return;
  temporizador = setTimeout(() => {
    temporizador = null;
    procesarCambiosDeEstado().catch((err) => logger.warn({ err: err.message }, 'Tareas: fallo mandando cambios de estado'));
  }, ventanaMs() + 5000);
  temporizador.unref?.();
}

/**
 * Apunta un cambio de estado para su correo. Nunca tumba la acción: la tarea ya
 * se movió y la campana ya ha sonado.
 *
 * @param {object} p
 * @param {number} p.taskId
 * @param {string} p.de, p.a          claves de columna (por_hacer, en_curso…)
 * @param {number} p.autorId          quien lo hizo
 * @param {string} [p.comentario]     el motivo al devolver, si lo hubo
 * @param {string} [p.accion]         'devuelta' | 'aprobada'
 * @param {number[]} [p.yaConCorreo]  a quién ya le llegó su correo propio por este cambio
 */
export async function anotarCambioDeEstado({ taskId, de, a, autorId, comentario = null, accion = null, yaConCorreo = [] }) {
  if (!taskId || de === a) return;
  try {
    const ya = [...new Set((yaConCorreo || []).filter(Boolean).map(Number))];
    if (!(await tablaLista()) || ventanaMs() === 0) {
      await mandarCambio({
        task_id: taskId, from_status: de, to_status: a, changed_by: autorId,
        comment: comentario, accion, ya_con_correo: ya, cambios: 1, last_at: new Date(),
      });
      return;
    }
    // La fila de la ráfaga: el «de» se queda el primero; lo demás, el último.
    await query(
      `INSERT INTO task_status_notices (task_id, from_status, to_status, changed_by, accion, comment, ya_con_correo)
       VALUES ($1, $2, $3, $4, $5, $6, $7::int[])
       ON CONFLICT (task_id) DO UPDATE SET
         to_status = EXCLUDED.to_status,
         changed_by = EXCLUDED.changed_by,
         accion = EXCLUDED.accion,
         comment = COALESCE(EXCLUDED.comment, task_status_notices.comment),
         ya_con_correo = EXCLUDED.ya_con_correo,
         cambios = task_status_notices.cambios + 1,
         last_at = NOW()`,
      [taskId, de, a, autorId || null, accion, comentario, ya]
    );
    programarVuelta();
  } catch (err) {
    logger.warn({ err: err.message, taskId }, 'Tareas: no se pudo apuntar el cambio de estado para el correo');
  }
}

async function nombresDeColumnas() {
  try {
    const cols = await taskModel.findAllColumns();
    return Object.fromEntries(cols.map((c) => [c.key, c.name]));
  } catch {
    return {};
  }
}

/** Manda el correo de un cambio (ya agrupado) a cada destinatario. */
async function mandarCambio(fila, columnas = null) {
  const cols = columnas || await nombresDeColumnas();
  const nombre = (k) => cols[k] || k;
  // Ida y vuelta en la misma ráfaga: no cambió nada, no hay nada que contar.
  if (fila.from_status === fila.to_status) return { mandados: 0, omitido: 'sin cambio neto' };

  const tarea = await taskModel.findTaskById(fila.task_id);
  if (!tarea || tarea.archived_at) return { mandados: 0, omitido: 'tarea archivada' };

  const quien = fila.changed_by ? await taskModel.findUserBasic(fila.changed_by) : null;
  const marcaTiempo = new Date(fila.last_at || Date.now()).getTime();
  let mandados = 0;
  for (const { id, rol } of destinatariosDelCambio(tarea, fila.changed_by, fila.ya_con_correo)) {
    try {
      const persona = await taskModel.findUserBasic(id);
      // Sin tablero, el enlace le daría un 403.
      if (!persona?.email || !persona.active || !persona.con_tablero) continue;
      if (await taskModel.avisoApagado(id, AVISO_TAREA_ESTADO)) continue;
      const r = await enviarCorreoCambioEstado({
        persona, tarea, rol, quien,
        de: nombre(fila.from_status), a: nombre(fila.to_status),
        comentario: fila.comment || null, accion: fila.accion || null, cambios: fila.cambios || 1,
        clave: `${AVISO_TAREA_ESTADO}-${tarea.id}-${id}-${marcaTiempo}`,
      });
      if (r?.sent || r?.simulated) mandados++;
    } catch (err) {
      logger.warn({ err: err.message, taskId: fila.task_id, personaId: id }, 'Tareas: fallo un correo de cambio de estado');
    }
  }
  return { mandados };
}

/**
 * Saca de la cola los cambios cuya ráfaga ya terminó (el último hace más de la
 * ventana) y manda su correo. `ahora` y `todos` son para las pruebas.
 */
export async function procesarCambiosDeEstado({ ahora = new Date(), todos = false } = {}) {
  if (!(await tablaLista())) return { cambios: 0 };
  const limite = todos ? new Date(8.64e15) : new Date(ahora.getTime() - ventanaMs());
  // DELETE … RETURNING con SKIP LOCKED: si dos vueltas coinciden, cada cambio sale una vez.
  const { rows } = await query(
    `DELETE FROM task_status_notices
      WHERE task_id IN (SELECT task_id FROM task_status_notices
                         WHERE last_at <= $1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [limite]
  );
  if (!rows.length) return { cambios: 0 };
  const columnas = await nombresDeColumnas();
  let mandados = 0;
  for (const fila of rows) {
    try {
      mandados += (await mandarCambio(fila, columnas)).mandados || 0;
    } catch (err) {
      logger.warn({ err: err.message, taskId: fila.task_id }, 'Tareas: fallo el correo de un cambio de estado');
    }
  }
  logger.info({ cambios: rows.length, mandados }, 'Tareas: correos de cambio de estado');
  return { cambios: rows.length, mandados };
}
