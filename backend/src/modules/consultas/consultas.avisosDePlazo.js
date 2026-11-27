/*
  CONSULTAS · los avisos de plazo se retiran solos (CRM#1197 / CRM-ISEIE#831).

  «Un alumno espera respuesta» (al tutor) y «Consulta fuera de plazo» (a
  administración) se quedaban en la campana aunque la consulta ya estuviera
  respondida o cerrada. Es lo mismo que la CRM#1186 arregló con el de 48 h y el
  de la carga: un aviso que pide hacer algo se va cuando ya no pide nada. Se usa
  el mismo mecanismo (`resolverAvisos`: leído para todos y `resuelta_at` en la
  metadata; no se borra).

    · Al responder (desde el CRM o desde el campus) o al cerrar, se retiran al
      momento los de esa consulta, de los dos tipos.
    · En cada vuelta de los plazos (`revisarPlazos`), además, los que ya no
      aplican por cualquier otro camino: la consulta no espera, el alumno volvió
      a escribir después del aviso (es otra espera, con su propio aviso), o el
      «cerca del plazo» es de un tutor al que ya se le quitó la consulta.
    · Los de antes sin `consulta_id` en la metadata (desde la #190 se guarda,
      así que no debería haber): se retiran cuando a esa tutora —o, el de
      administración, a ese campus y tutor— ya no le queda ninguna pasada de su
      umbral.

  Nunca falla: el aviso es accesorio y la respuesta a la consulta no puede
  romperse por él.
*/
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { resolverAvisos } from '../notifications/notifications.service.js';

export const AVISOS_DE_PLAZO = ['consulta_cerca_del_plazo', 'consulta_fuera_de_plazo'];

const ESPERA = 'COALESCE(c.espera_desde, c.entrada_at)';

/** Retira los avisos de plazo abiertos de esa consulta. Devuelve cuántos. */
export async function retirarAvisosDeConsulta(consultaId, motivo, ahora = new Date()) {
  try {
    const { rows } = await query(
      `SELECT id FROM admin_notifications
        WHERE type = ANY($1::text[]) AND metadata->>'consulta_id' = $2::text
          AND NOT (metadata ? 'resuelta_at')`,
      [AVISOS_DE_PLAZO, String(consultaId)]);
    return await resolverAvisos(rows.map((r) => Number(r.id)), motivo, ahora);
  } catch (err) {
    logger.warn({ consultaId, err: err.message }, 'consultas: no se han podido retirar los avisos de plazo');
    return 0;
  }
}

/** Por qué sobra un aviso que sí sabe de qué consulta es (null = sigue haciendo falta). */
const MOTIVO = `CASE
    WHEN c.id IS NULL THEN 'sin_consulta'
    WHEN c.estado = 'cerrada' THEN 'cerrada'
    WHEN c.estado <> 'abierta' THEN 'respondida'
    WHEN ${ESPERA} > n.created_at THEN 'otra_espera'
    WHEN n.type = 'consulta_cerca_del_plazo'
     AND (c.tutor_id IS NULL OR NOT (n.target_user_ids @> ARRAY[c.tutor_id])) THEN 'reasignada'
  END`;

/**
 * La parte del repaso: retira los avisos de plazo que ya no piden nada. `umbral`: las horas
 * de `umbralesDeAviso` (para los antiguos sin id). `projectIds`: solo esos campus (null = todos).
 */
export async function retirarAvisosQueSobran({ ahora = new Date(), projectIds = null, umbral }) {
  let retirados = 0;
  try {
    const { rows } = await query(
      `SELECT id, motivo FROM (
         SELECT n.id, ${MOTIVO} AS motivo
           FROM admin_notifications n
           LEFT JOIN consultas c ON c.id = (n.metadata->>'consulta_id')::int
          WHERE n.type = ANY($1::text[]) AND n.metadata ? 'consulta_id'
            AND NOT (n.metadata ? 'resuelta_at')
            AND ($2::int[] IS NULL OR c.project_id = ANY($2::int[])
                 OR (n.metadata->>'project_id')::int = ANY($2::int[]))
       ) x WHERE motivo IS NOT NULL`,
      [AVISOS_DE_PLAZO, projectIds]);
    const porMotivo = new Map();
    for (const r of rows) porMotivo.set(r.motivo, [...(porMotivo.get(r.motivo) || []), Number(r.id)]);
    for (const [motivo, ids] of porMotivo) retirados += await resolverAvisos(ids, motivo, ahora);

    // Los de antes, sin id: el «cerca» se va cuando a su tutora no le queda ninguna pasada
    // del recordatorio; el de administración, cuando no queda ninguna fuera de plazo (de ese
    // campus y tutor, si el aviso lo dice).
    const antiguos = await query(
      `SELECT n.id FROM admin_notifications n
        WHERE n.type = ANY($1::text[]) AND NOT (n.metadata ? 'consulta_id')
          AND NOT (n.metadata ? 'resuelta_at')
          AND ($2::int[] IS NULL OR (n.metadata->>'project_id')::int = ANY($2::int[]))
          AND NOT EXISTS (
            SELECT 1 FROM consultas c
             WHERE c.estado = 'abierta'
               AND ${ESPERA} <= $3::timestamptz - make_interval(secs => (CASE WHEN n.type = 'consulta_cerca_del_plazo'
                                                                          THEN $4 ELSE $5 END)::float8 * 3600)
               AND CASE WHEN n.type = 'consulta_cerca_del_plazo'
                        THEN c.tutor_id = ANY(COALESCE(n.target_user_ids, '{}'::int[]))
                        ELSE (NOT (n.metadata ? 'project_id') OR c.project_id = (n.metadata->>'project_id')::int)
                         AND (NOT (n.metadata ? 'tutor_id') OR c.tutor_id IS NOT DISTINCT FROM (n.metadata->>'tutor_id')::int)
                   END)`,
      [AVISOS_DE_PLAZO, projectIds, ahora, umbral.recordatorio, umbral.administracion]);
    retirados += await resolverAvisos(antiguos.rows.map((r) => Number(r.id)), 'al_dia', ahora);
  } catch (err) {
    logger.warn({ err: err.message }, 'consultas: no se han podido repasar los avisos de plazo');
  }
  return retirados;
}
