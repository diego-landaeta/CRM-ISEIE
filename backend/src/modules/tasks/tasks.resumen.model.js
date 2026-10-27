// Las consultas del resumen de la tarde del tablero (Diego, 26/10/2026: «todos
// los días de lunes a viernes mande su resumen de lo que hizo y lo que falta»).
//
// «Hoy» es el día de la zona del resumen (America/Caracas por defecto), no el del
// servidor: se pasa el día (YYYY-MM-DD) y la zona, y los límites se calculan en
// la base con AT TIME ZONE.
import { query } from '../../shared/config/db.js';
import { ROLES_TAREAS, existeSupervisor } from './tasks.model.js';

const INICIO = (d, z) => `((${d}::date)::timestamp AT TIME ZONE ${z})`;
const FIN = (d, z, mas = 1) => `(((${d}::date) + ${mas})::timestamp AT TIME ZONE ${z})`;

/**
 * A quién le puede tocar hoy: con tablero, activo, con correo, sin el resumen
 * apagado, y con algo que contar — movió algo hoy, tiene tareas abiertas o
 * supervisa alguna que espera revisión. Quien no tiene nada de eso no aparece.
 */
export async function findCandidatosResumen(aviso, dia, zona, { soloUserIds = null } = {}) {
  const sup = await existeSupervisor();
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email
       FROM users u
      WHERE u.active
        AND u.email IS NOT NULL
        AND (u.role::text = ANY($4::text[]) OR u.roles_extra::text[] && $4::text[])
        AND NOT EXISTS (SELECT 1 FROM avisos_apagados a WHERE a.user_id = u.id AND a.aviso = $1)
        AND ($5::int[] IS NULL OR u.id = ANY($5::int[]))
        AND (
          EXISTS (SELECT 1 FROM task_events e
                   WHERE e.user_id = u.id
                     AND e.event_type IN ('created', 'status_changed', 'comment')
                     AND e.created_at >= ${INICIO('$2', '$3')} AND e.created_at < ${FIN('$2', '$3')})
          OR EXISTS (SELECT 1 FROM tasks t
                      WHERE t.assigned_to = u.id AND t.archived_at IS NULL AND t.status <> 'hecha')
          ${sup ? `OR EXISTS (SELECT 1 FROM tasks t
                      WHERE t.supervisor_id = u.id AND t.archived_at IS NULL AND t.status = 'en_revision')` : ''}
        )
      ORDER BY u.nombre`,
    [aviso, dia, zona, ROLES_TAREAS, soloUserIds]
  );
  return rows;
}

/** Lo que hizo hoy y lo que le falta a una persona. */
export async function findResumenDelDia(userId, dia, zona) {
  const sup = await existeSupervisor();
  const entreHoy = `e.created_at >= ${INICIO('$2', '$3')} AND e.created_at < ${FIN('$2', '$3')}`;

  const [movs, comentarios, creadas, abiertas, revisar] = await Promise.all([
    // Los cambios de estado de hoy, por tarea: el primero «de» y el último «a».
    query(
      `SELECT t.id, t.title,
              (array_agg(e.details->>'old_status' ORDER BY e.created_at, e.id))[1] AS de,
              (array_agg(e.details->>'new_status' ORDER BY e.created_at DESC, e.id DESC))[1] AS a
         FROM task_events e JOIN tasks t ON t.id = e.task_id
        WHERE e.user_id = $1 AND e.event_type = 'status_changed' AND ${entreHoy}
          AND t.archived_at IS NULL
        GROUP BY t.id, t.title
        ORDER BY MIN(e.created_at)`,
      [userId, dia, zona]),
    query(
      `SELECT t.id, t.title, COUNT(*)::int AS n
         FROM task_events e JOIN tasks t ON t.id = e.task_id
        WHERE e.user_id = $1 AND e.event_type = 'comment' AND ${entreHoy}
          AND t.archived_at IS NULL
        GROUP BY t.id, t.title
        ORDER BY MIN(e.created_at)`,
      [userId, dia, zona]),
    query(
      `SELECT t.id, t.title, CASE WHEN t.assigned_to <> $1 THEN ua.nombre END AS assigned_to_name
         FROM task_events e
         JOIN tasks t ON t.id = e.task_id
         LEFT JOIN users ua ON ua.id = t.assigned_to
        WHERE e.user_id = $1 AND e.event_type = 'created' AND ${entreHoy}
          AND t.archived_at IS NULL
        ORDER BY e.created_at`,
      [userId, dia, zona]),
    query(
      `SELECT t.id, t.title, t.status, t.due_date,
              CASE
                WHEN t.due_date < ${INICIO('$2', '$3')} THEN 'vencida'
                WHEN t.due_date < ${FIN('$2', '$3')} THEN 'hoy'
                WHEN t.due_date < ${FIN('$2', '$3', 2)} THEN 'manana'
              END AS plazo
         FROM tasks t
         LEFT JOIN task_columns c ON c.key = t.status
        WHERE t.assigned_to = $1 AND t.archived_at IS NULL AND t.status <> 'hecha'
        ORDER BY COALESCE(c.sort_order, 999), t.due_date ASC NULLS LAST, t.position`,
      [userId, dia, zona]),
    sup
      ? query(
        `SELECT t.id, t.title, t.due_date, ua.nombre AS assigned_to_name
           FROM tasks t LEFT JOIN users ua ON ua.id = t.assigned_to
          WHERE t.supervisor_id = $1 AND t.archived_at IS NULL AND t.status = 'en_revision'
          ORDER BY t.due_date ASC NULLS LAST, t.updated_at`,
        [userId])
      : Promise.resolve({ rows: [] }),
  ]);

  // Lo que cerró va aparte; lo que fue y volvió en el día no es un cambio.
  const cerradas = movs.rows.filter((m) => m.a === 'hecha');
  const movidas = movs.rows.filter((m) => m.a !== 'hecha' && m.de !== m.a);

  const vencidas = abiertas.rows.filter((t) => t.plazo === 'vencida')
    .sort((x, y) => new Date(x.due_date) - new Date(y.due_date));
  const hoy = abiertas.rows.filter((t) => t.plazo === 'hoy');
  const manana = abiertas.rows.filter((t) => t.plazo === 'manana');
  // El resto, por estado, en el orden de las columnas del tablero.
  const porEstado = [];
  for (const t of abiertas.rows) {
    if (t.plazo) continue;
    let g = porEstado.find((x) => x.estado === t.status);
    if (!g) { g = { estado: t.status, tareas: [] }; porEstado.push(g); }
    g.tareas.push(t);
  }

  return {
    hizo: { cerradas, movidas, comentarios: comentarios.rows, creadas: creadas.rows },
    falta: { vencidas, hoy, manana, revisar: revisar.rows, porEstado, abiertas: abiertas.rows.length },
  };
}

/** ¿Hay algo que contar? Si no hizo nada y no le falta nada, no se le manda. */
export function resumenVacio(datos) {
  const { hizo, falta } = datos;
  return !hizo.cerradas.length && !hizo.movidas.length && !hizo.comentarios.length && !hizo.creadas.length
    && !falta.abiertas && !falta.revisar.length;
}

let hayTabla = null;
export async function existeRegistroResumen() {
  if (hayTabla) return true;
  const { rows: [r] } = await query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_name = 'task_daily_summaries') AS hay`);
  hayTabla = r?.hay === true;
  return hayTabla;
}

/**
 * Reserva el resumen de hoy para esta persona. Devuelve false si ya estaba: es la
 * barrera contra mandarlo dos veces aunque el servidor se reinicie o coincidan
 * dos vueltas.
 */
export async function reservarResumen(userId, dia) {
  const { rows } = await query(
    `INSERT INTO task_daily_summaries (user_id, dia, estado) VALUES ($1, $2, 'enviando')
     ON CONFLICT (user_id, dia) DO NOTHING RETURNING user_id`,
    [userId, dia]);
  return rows.length > 0;
}

export async function marcarResumen(userId, dia, estado) {
  await query('UPDATE task_daily_summaries SET estado = $3 WHERE user_id = $1 AND dia = $2', [userId, dia, estado]);
}

/** Si falló de verdad, se suelta la reserva para que lo intente la vuelta siguiente. */
export async function soltarResumen(userId, dia) {
  await query('DELETE FROM task_daily_summaries WHERE user_id = $1 AND dia = $2', [userId, dia]);
}
