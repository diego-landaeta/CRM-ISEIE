/**
 * Quién entra en el reparto de leads de un campus (como `reparto.js` de MultiCRM).
 *
 * La misma regla que el round-robin del alta (`createLeadWithRoundRobin`): las
 * gestoras, y los admin o superadmin que reciben leads en ese campus; activas,
 * disponibles, sin ausencia hoy y que no llevan las colaboraciones de los
 * profesores. La usa la asignación de leads por actividad (CRM#513, 27/10/2026)
 * para saber entre quiénes mirar quién está trabajando.
 *
 * `ejecutar` es `query` o el de un cliente de transacción.
 */
export async function gestoresDelReparto(ejecutar, projectId) {
  const { rows } = await ejecutar(
    `SELECT u.id, u.nombre, u.email, up.orden_cola
       FROM user_projects up
       JOIN users u ON u.id = up.user_id
        AND u.active = true
        AND u.is_available = true
        AND (u.role = 'gestor' OR (u.role IN ('admin','superadmin') AND up.recibe_leads = TRUE))
        AND NOT COALESCE(u.gestor_colaboraciones, false)
      WHERE up.project_id = $1 AND up.active = true
        AND NOT EXISTS (
          SELECT 1 FROM user_availability_blocks ab
           WHERE ab.user_id = u.id
             AND CURRENT_DATE BETWEEN ab.fecha_inicio AND ab.fecha_fin
        )
      ORDER BY up.orden_cola, u.id`,
    [projectId]
  );
  return rows;
}

export default { gestoresDelReparto };
