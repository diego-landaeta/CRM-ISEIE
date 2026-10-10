import { query } from '../config/db.js';
import { PASO_CERRADO } from './pasoCerrado.js';

/**
 * Recoloca la agenda del proceso desde la última actividad de verdad.
 *
 * Diego, 10/10: «están dando datos malos: en ACADEMIA IA ayer estaba al día y
 * hoy 11». Las fechas de los pasos se fijaban el día que entraba la persona
 * (entrada + `dia_desde` de cada paso) y no se movían nunca. Si la gestora
 * llegaba tarde a un paso, su contacto lo cerraba, pero el SIGUIENTE seguía con
 * su fecha de septiembre y salía con semanas de retraso aunque le hubieran
 * escrito ayer. Eligió: «cuando un contacto cierra un paso, los que quedan se
 * recolocan a partir del día del contacto».
 *
 * Lo que hace, por persona:
 *   · el paso ABIERTO es el primero pendiente que no cierran sus contactos (la
 *     misma regla que la cola, PASO_CERRADO);
 *   · su separación con el paso anterior (o con la entrada, si es el primero)
 *     se conserva, pero contada desde la última actividad: el último contacto
 *     (sin notas) o el último paso marcado a mano;
 *   · ese paso y los que le siguen se mueven esos días. SOLO HACIA DELANTE:
 *     quien va adelantado no ve sus pasos acercarse, y sin actividad no se
 *     mueve nada (quien lleva semanas sin contacto sigue atrasado, porque lo
 *     está).
 *
 * Los pasos ya cerrados no se tocan, y mover los abiertos hacia delante no
 * puede abrir uno cerrado: PASO_CERRADO de un paso solo mira las fechas de los
 * pendientes hasta él, que son anteriores al abierto.
 *
 * @param {number[]} leadIds
 * @param {{ query: Function }} [db]  un cliente en transacción, si lo hay
 * @returns {Promise<number>} cuántas personas cambiaron de agenda
 */
export async function recolocarPasos(leadIds, db = { query }) {
  const ids = (leadIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return 0;
  const { rows } = await db.query(
    `WITH abiertos AS (
       SELECT DISTINCT ON (ls.lead_id) ls.lead_id, ls.orden, ls.fecha_prevista
         FROM lead_steps ls
        WHERE ls.lead_id = ANY($1::int[]) AND ls.estado = 'pendiente'
          AND NOT ${PASO_CERRADO('ls')}
        ORDER BY ls.lead_id, ls.orden
     ),
     calculo AS (
       SELECT a.lead_id, a.orden, a.fecha_prevista,
              COALESCE(
                (SELECT p.fecha_prevista FROM lead_steps p
                  WHERE p.lead_id = a.lead_id AND p.orden < a.orden
                  ORDER BY p.orden DESC LIMIT 1),
                COALESCE(l.fecha_solicitud, l.created_at)::date) AS fecha_anterior,
              GREATEST(
                (SELECT max(li.fecha)::date FROM lead_interactions li
                  WHERE li.lead_id = a.lead_id AND li.tipo <> 'nota'),
                (SELECT max(h.hecho_at)::date FROM lead_steps h
                  WHERE h.lead_id = a.lead_id AND h.estado = 'hecho')) AS ultima_actividad
         FROM abiertos a JOIN leads l ON l.id = a.lead_id
     ),
     mover AS (
       SELECT lead_id, orden,
              (ultima_actividad + (fecha_prevista - fecha_anterior)) - fecha_prevista AS dias
         FROM calculo
        WHERE ultima_actividad IS NOT NULL
     )
     UPDATE lead_steps ls
        SET fecha_prevista = ls.fecha_prevista + m.dias, updated_at = NOW()
       FROM mover m
      WHERE ls.lead_id = m.lead_id AND ls.estado = 'pendiente'
        AND ls.orden >= m.orden AND m.dias > 0
      RETURNING ls.lead_id`,
    [ids],
  );
  return new Set(rows.map((r) => r.lead_id)).size;
}
