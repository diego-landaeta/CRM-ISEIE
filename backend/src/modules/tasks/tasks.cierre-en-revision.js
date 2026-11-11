/*
  Las tareas que se quedaron «En revisión» al cambiar la regla (CRM-ISEIE#419, Diego
  y Carlos, 10/11/2026): «no se vuelven a pasar por revisión: al salir esta
  versión, se cierran como hechas con la fecha de su último movimiento».

  Para cada tarea viva en «En revisión» SIN SUPERVISOR (Diego, 11/11/2026: las
  que tienen supervisor las cierra él, a mano; esas se quedan como están):
    · pasa a «Hecha», al final de la columna de quien la lleva;
    · `completed_at` = la fecha de su último movimiento (su último cambio de
      columna en `task_events`; si no hay ninguno, su `updated_at`);
    · un evento `status_changed` en_revision → hecha con esa misma fecha, a
      nombre de quien la lleva (sin responsable, quien la creó): así el
      historial y «quién la cerró» dicen lo mismo que el resto.

  Sin avisos ni correos: no es que alguien las cierre hoy.

  Idempotente: solo toca lo que sigue «En revisión», así que la segunda vez no
  hay nada que hacer. `aplicar: false` lo cuenta y lo enseña sin cambiar nada
  (lo hace todo dentro de una transacción y la deshace).

  Lo lanza `scripts/cerrar-en-revision-419.mjs`; aquí está para poder probarlo.
*/

export const MARCA_CIERRE = 'cierre_419';

/**
 * @param {import('pg').PoolClient | import('pg').Client} db  una conexión propia (se abre y cierra la transacción aquí)
 * @param {{ aplicar?: boolean, soloTareas?: number[] | null }} [opciones]  `soloTareas`: para las pruebas, que comparten base
 * @returns {Promise<{ total: number, aplicado: boolean, tareas: Array<{ id: number, title: string, assigned_to: number|null, cerrada_por: number|null, completed_at: Date }> }>}
 */
export async function cerrarLasEnRevision(db, { aplicar = false, soloTareas = null } = {}) {
  await db.query('BEGIN');
  try {
    // Sin la columna del supervisor (migración vieja), ninguna lo tiene.
    const { rows: [col] } = await db.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'tasks' AND column_name = 'supervisor_id') AS hay`);
    const sinSupervisor = col?.hay ? 'AND t.supervisor_id IS NULL' : '';
    // FOR UPDATE: si alguien la mueve mientras tanto, espera; nada se cierra dos veces.
    const { rows: tareas } = await db.query(
      `SELECT t.id, t.title, t.assigned_to, COALESCE(t.assigned_to, t.created_by) AS cerrada_por,
              COALESCE((SELECT MAX(e.created_at) FROM task_events e
                         WHERE e.task_id = t.id AND e.event_type = 'status_changed'), t.updated_at) AS completed_at
         FROM tasks t
        WHERE t.status = 'en_revision' AND t.archived_at IS NULL
          AND ($1::int[] IS NULL OR t.id = ANY($1::int[]))
          ${sinSupervisor}
        ORDER BY t.id
        FOR UPDATE OF t`,
      [soloTareas]
    );

    for (const t of tareas) {
      await db.query(
        `UPDATE tasks
            SET status = 'hecha',
                completed_at = $2,
                position = (SELECT COALESCE(MAX(t2.position), 0) + 1000 FROM tasks t2
                             WHERE t2.status = 'hecha' AND t2.archived_at IS NULL
                               AND t2.assigned_to IS NOT DISTINCT FROM $3::int),
                updated_at = NOW()
          WHERE id = $1`,
        [t.id, t.completed_at, t.assigned_to]
      );
      await db.query(
        `INSERT INTO task_events (task_id, user_id, event_type, details, created_at)
         VALUES ($1, $2, 'status_changed', $3, $4)`,
        [t.id, t.cerrada_por, JSON.stringify({
          old_status: 'en_revision', new_status: 'hecha', action: MARCA_CIERRE,
          motivo: 'Cerrada al cambiar la regla del tablero (CRM-ISEIE#419): quien la hace la pasa a «Hecha».',
        }), t.completed_at]
      );
    }

    await db.query(aplicar ? 'COMMIT' : 'ROLLBACK');
    return { total: tareas.length, aplicado: aplicar, tareas };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}
