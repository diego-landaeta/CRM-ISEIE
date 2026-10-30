import { query } from '../../shared/config/db.js';

/*
  SI CADA GESTORA RESPONDE EN WHATSAPP (Diego, 30/10: «lo de WhatsApp es también
  medir actividad, si está activa en el WhatsApp respondiendo, y que pueda añadir
  interacciones desde ahí»).

  Por gestora, en días de Madrid:
    · chats      — conversaciones (sin grupos) en las que la persona escribió;
    · respondidos — de esas, las que tienen un mensaje suyo después del primero
                    que le mandaron en el periodo;
    · sin_responder — las que acaban en un mensaje de la persona: le toca a ella;
    · mediana_min — minutos entre el primer mensaje de la persona y la respuesta;
    · texto / voz — lo que mandó ella (escrito y audios).
  Y, de la ficha, los contactos que apuntó: WhatsApp, llamadas, correos y notas,
  contados para QUIEN los hizo (#203), y el último mensaje de su número.

  Lo de los mensajes sale de su número conectado al CRM (la instancia «…-u<id>»):
  sin número conectado, solo hay lo que apunta a mano.
*/

const DUENA = (col) => `NULLIF(substring(${col} from '-u([0-9]+)$'), '')::int`;
const EN_RANGO = (col) => `(${col} AT TIME ZONE 'Europe/Madrid')::date BETWEEN $2::date AND $3::date`;

/**
 * @param {{ projectIds: number[]|null, desde: string, hasta: string }} p
 *   `projectIds` null = todos los campus (menos los de pruebas).
 */
export async function actividadEnWhatsapp({ projectIds, desde, hasta }) {
  const params = [projectIds || null, desde, hasta];
  const { rows } = await query(
    `WITH gente AS (
       SELECT DISTINCT u.id, u.nombre
         FROM users u
         JOIN user_projects up ON up.user_id = u.id AND up.active
         JOIN projects p ON p.id = up.project_id
        WHERE u.active AND u.role IN ('gestor', 'admin')
          AND ($1::int[] IS NULL AND NOT COALESCE(p.es_prueba, false) OR p.id = ANY($1::int[]))
     ),
     conv AS (
       SELECT c.id, ${DUENA('c.instancia')} AS duena
         FROM wa_conversaciones c
        WHERE c.jid NOT LIKE '%@g.us'
     ),
     primera AS (
       SELECT m.conversacion_id, MIN(m.ts) AS ts
         FROM wa_mensajes m
        WHERE m.direccion = 'entrante' AND ${EN_RANGO('m.ts')}
        GROUP BY m.conversacion_id
     ),
     chats AS (
       SELECT conv.duena, pr.conversacion_id, pr.ts AS primera,
              (SELECT MIN(s.ts) FROM wa_mensajes s
                WHERE s.conversacion_id = pr.conversacion_id AND s.direccion = 'saliente' AND s.ts > pr.ts) AS respuesta,
              (SELECT u.direccion FROM wa_mensajes u
                WHERE u.conversacion_id = pr.conversacion_id ORDER BY u.ts DESC LIMIT 1) AS ultima
         FROM primera pr JOIN conv ON conv.id = pr.conversacion_id
     ),
     resp AS (
       SELECT duena,
              COUNT(*)::int AS chats,
              COUNT(respuesta)::int AS respondidos,
              COUNT(*) FILTER (WHERE ultima = 'entrante')::int AS sin_responder,
              ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM respuesta - primera) / 60)
                    FILTER (WHERE respuesta IS NOT NULL))::numeric, 0)::int AS mediana_min
         FROM chats GROUP BY duena
     ),
     enviados AS (
       SELECT conv.duena,
              COUNT(*) FILTER (WHERE m.tipo = 'texto')::int AS texto,
              COUNT(*) FILTER (WHERE m.tipo = 'audio')::int AS voz,
              MAX(m.ts) AS ultimo_mensaje
         FROM wa_mensajes m JOIN conv ON conv.id = m.conversacion_id
        WHERE m.direccion = 'saliente' AND ${EN_RANGO('m.ts')}
        GROUP BY conv.duena
     ),
     numero AS (
       SELECT conv.duena, MAX(m.ts) AS ultimo
         FROM wa_mensajes m JOIN conv ON conv.id = m.conversacion_id
        GROUP BY conv.duena
     ),
     apuntado AS (
       SELECT li.created_by AS id,
              COUNT(*) FILTER (WHERE li.tipo = 'whatsapp')::int AS a_whatsapp,
              COUNT(*) FILTER (WHERE li.tipo = 'llamada')::int  AS a_llamadas,
              COUNT(*) FILTER (WHERE li.tipo = 'email')::int    AS a_correos,
              COUNT(*) FILTER (WHERE li.tipo = 'nota')::int     AS a_notas
         FROM lead_interactions li JOIN leads l ON l.id = li.lead_id
        WHERE l.deleted_at IS NULL AND ${EN_RANGO('li.fecha')}
          AND ($1::int[] IS NULL OR l.project_id = ANY($1::int[]))
        GROUP BY li.created_by
     )
     SELECT g.id, g.nombre,
            COALESCE(r.chats, 0) AS chats, COALESCE(r.respondidos, 0) AS respondidos,
            COALESCE(r.sin_responder, 0) AS sin_responder, r.mediana_min,
            COALESCE(e.texto, 0) AS texto, COALESCE(e.voz, 0) AS voz,
            n.ultimo AS ultimo_mensaje_del_numero,
            COALESCE(a.a_whatsapp, 0) AS a_whatsapp, COALESCE(a.a_llamadas, 0) AS a_llamadas,
            COALESCE(a.a_correos, 0) AS a_correos, COALESCE(a.a_notas, 0) AS a_notas
       FROM gente g
       LEFT JOIN resp r ON r.duena = g.id
       LEFT JOIN enviados e ON e.duena = g.id
       LEFT JOIN numero n ON n.duena = g.id
       LEFT JOIN apuntado a ON a.id = g.id
      WHERE r.duena IS NOT NULL OR e.duena IS NOT NULL OR a.id IS NOT NULL
      ORDER BY COALESCE(r.chats, 0) DESC, COALESCE(a.a_whatsapp + a.a_llamadas + a.a_correos, 0) DESC, g.nombre`,
    params
  );
  return { desde, hasta, filas: rows };
}
