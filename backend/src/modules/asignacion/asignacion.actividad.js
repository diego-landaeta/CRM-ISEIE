import { query } from '../../shared/config/db.js';

/*
  QUIÉN ESTÁ ACTIVA Y A QUIÉN LE TOCA (CRM#513; Carlos y Diego, 27/10/2026).

  ACTIVA = al menos una acción válida en los últimos N minutos (15 de serie),
  en cualquier parte del CRM. Las candidatas son las del reparto del campus
  (`gestoresDelReparto`: gestoras, y admin que reciben leads, disponibles).

  Cuenta («cualquier cosa que haga en el CRM», Diego):
    · contactos y notas (`lead_interactions`): una nota, solo si tiene 20
      caracteres o más y no repite otra suya en el mismo prospecto;
    · cambios de estado (`lead_status_history`), salvo los deshechos: un cambio
      que alguien devuelve al estado anterior en menos de 10 minutos no cuenta,
      ni la vuelta atrás;
    · recordatorios (`lead_reminders`) y pasos del proceso hechos (`lead_steps`);
    · ediciones reales de un prospecto (`lead_audit_log` solo apunta cambios);
    · WhatsApp que ella manda, desde el CRM (`enviado_por`) o desde su móvil
      con el número conectado (la instancia es suya: `crm-u<id>`). Se mira la
      hora de WhatsApp además de la de llegada, para que el historial que baja
      al emparejar el número no la haga pasar por activa; los grupos no cuentan;
    · lo que no guarda su autor —crear un lead, una venta, un cobro, una
      matrícula, una factura—, que se apunta en `actividad_crm`.
  No cuenta: abrir una ficha (no se registra), guardar sin cambios (no deja
  rastro) ni tener la sesión abierta.

  A QUIÉN, entre las activas: la que tenga menos leads asignados hoy (día de
  Valencia) EN ESE CAMPUS; si empatan, menos en total en ese campus; si siguen,
  la que lleva más tiempo sin recibir uno allí (el turno); y al final, el id.
  Cada campus lleva su reparto aparte (Diego, 28/10/2026: «cada campus tiene su
  rotación independiente»): lo que una gestora reciba en otro campus no cuenta.

  WHATSAPP (fase 5): pulsar el botón del widget no asigna nada. Un contacto de
  WhatsApp cuenta como asignado a una gestora cuando la persona le ESCRIBE —una
  conversación nueva que abre ella en el número de la gestora— o cuando la
  gestora lo registra (crea el lead, y entonces cuenta como lead). Si las dos
  cosas pasan el mismo día, cuenta una vez.
*/

/** De quién es una instancia de WhatsApp (`crm-u12` → 12), en SQL. */
const DUENA_INSTANCIA = (col) => `NULLIF(substring(${col} from '-u([0-9]+)$'), '')::int`;

export const MINUTOS_PARA_DESHACER = 10;
export const LARGO_MINIMO_NOTA = 20;
export const ZONA = 'Europe/Madrid';

const SQL_ACTIVAS = `
WITH v AS (SELECT NOW() - make_interval(mins => $2::int) AS desde),
acciones AS (
  SELECT li.created_by AS uid, li.created_at AS at,
         CASE li.tipo::text WHEN 'nota' THEN 'nota' ELSE 'contacto' END AS que
    FROM lead_interactions li, v
   WHERE li.created_at >= v.desde AND li.created_by = ANY($1::int[])
     AND (li.tipo::text <> 'nota' OR (
           length(trim(coalesce(li.nota, ''))) >= ${LARGO_MINIMO_NOTA}
           AND NOT EXISTS (
             SELECT 1 FROM lead_interactions p
              WHERE p.lead_id = li.lead_id AND p.created_by = li.created_by AND p.id < li.id
                AND p.tipo::text = 'nota' AND lower(trim(p.nota)) = lower(trim(li.nota)))))
  UNION ALL
  SELECT h.changed_by, h.changed_at, 'estado'
    FROM lead_status_history h, v
   WHERE h.changed_at >= v.desde AND h.changed_by = ANY($1::int[])
     AND NOT EXISTS (
       SELECT 1 FROM lead_status_history r
        WHERE r.lead_id = h.lead_id AND r.id > h.id
          AND r.changed_at <= h.changed_at + INTERVAL '${MINUTOS_PARA_DESHACER} minutes'
          AND r.status_nuevo = h.status_anterior)
     AND NOT EXISTS (
       SELECT 1 FROM lead_status_history o
        WHERE o.lead_id = h.lead_id AND o.id < h.id
          AND o.changed_at >= h.changed_at - INTERVAL '${MINUTOS_PARA_DESHACER} minutes'
          AND o.status_anterior = h.status_nuevo)
  UNION ALL
  SELECT r.created_by, r.created_at, 'recordatorio'
    FROM lead_reminders r, v WHERE r.created_at >= v.desde AND r.created_by = ANY($1::int[])
  UNION ALL
  SELECT s.hecho_por, s.hecho_at, 'paso'
    FROM lead_steps s, v WHERE s.hecho_at >= v.desde AND s.hecho_por = ANY($1::int[])
  UNION ALL
  SELECT a.changed_by_user_id, a.changed_at, 'edicion'
    FROM lead_audit_log a, v WHERE a.changed_at >= v.desde AND a.changed_by_user_id = ANY($1::int[])
  UNION ALL
  SELECT COALESCE(m.enviado_por, ${DUENA_INSTANCIA('c.instancia')}), m.ts, 'whatsapp'
    FROM wa_mensajes m JOIN wa_conversaciones c ON c.id = m.conversacion_id, v
   WHERE m.direccion = 'saliente' AND m.ts >= v.desde AND m.created_at >= v.desde
     AND c.jid NOT LIKE '%@g.us'
     AND COALESCE(m.enviado_por, ${DUENA_INSTANCIA('c.instancia')}) = ANY($1::int[])
  UNION ALL
  SELECT c.user_id, c.created_at, c.accion
    FROM actividad_crm c, v WHERE c.created_at >= v.desde AND c.user_id = ANY($1::int[])
)
SELECT uid, MAX(at) AS ultima, (ARRAY_AGG(que ORDER BY at DESC))[1] AS que, COUNT(*)::int AS acciones
  FROM acciones GROUP BY uid`;

/**
 * Las candidatas que están activas: Map id → { ultima, que, acciones }.
 * `ejecutar` es `query` o el de un cliente de transacción.
 */
export async function activasEntre(candidatas, ventanaMin, ejecutar = query) {
  const ids = [...new Set((candidatas || []).map(Number).filter(Boolean))];
  if (!ids.length) return new Map();
  const { rows } = await ejecutar(SQL_ACTIVAS, [ids, ventanaMin]);
  return new Map(rows.map((r) => [Number(r.uid), { ultima: r.ultima, que: r.que, acciones: r.acciones }]));
}

// Las conversaciones de hoy que abrió la persona (su primer mensaje es suyo y es
// de hoy, hora de WhatsApp) en este campus —el de la conversación o, si no lo
// tiene, el de su lead— y que no son ya un lead de hoy de la misma gestora.
const SQL_CUENTAS = `
WITH d AS (SELECT (date_trunc('day', NOW() AT TIME ZONE '${ZONA}') AT TIME ZONE '${ZONA}') AS hoy),
conv AS (
  SELECT c.id, c.lead_id, ${DUENA_INSTANCIA('c.instancia')} AS uid
    FROM wa_conversaciones c, d
   WHERE c.created_at >= d.hoy AND c.jid NOT LIKE '%@g.us'
     AND COALESCE(c.project_id, (SELECT lc.project_id FROM leads lc WHERE lc.id = c.lead_id)) = $2
),
wa AS (
  SELECT conv.uid, COUNT(*)::int AS n, MAX(p.ts) AS ultimo
    FROM conv CROSS JOIN d
    CROSS JOIN LATERAL (SELECT m.ts, m.direccion FROM wa_mensajes m
                         WHERE m.conversacion_id = conv.id ORDER BY m.ts, m.id LIMIT 1) p
   WHERE conv.uid = ANY($1::int[]) AND p.direccion = 'entrante' AND p.ts >= d.hoy
     AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = conv.lead_id AND l.responsable_id = conv.uid
                        AND l.created_at >= d.hoy AND l.deleted_at IS NULL)
   GROUP BY conv.uid
)
SELECT u.id,
       (COUNT(l.id) FILTER (WHERE l.created_at >= d.hoy) + COALESCE(MAX(wa.n), 0))::int AS hoy,
       COUNT(l.id)::int AS total,
       GREATEST(MAX(l.created_at), MAX(wa.ultimo)) AS ultimo,
       COALESCE(MAX(wa.n), 0)::int AS whatsapp
  FROM unnest($1::int[]) AS u(id)
  CROSS JOIN d
  LEFT JOIN wa ON wa.uid = u.id
  LEFT JOIN leads l
    ON l.responsable_id = u.id AND l.deleted_at IS NULL AND l.project_id = $2
 GROUP BY u.id`;

/**
 * Asignados hoy (Valencia) y en total a cada una, EN ESTE CAMPUS.
 * «Hoy» suma los leads y las conversaciones de WhatsApp que le abrieron hoy.
 * Map id → { hoy, total, ultimo, whatsapp }.
 */
export async function cuentasDe(ids, projectId, ejecutar = query) {
  const lista = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!lista.length || !Number(projectId)) return new Map();
  const { rows } = await ejecutar(SQL_CUENTAS, [lista, Number(projectId)]);
  return new Map(rows.map((r) => [Number(r.id), { hoy: r.hoy, total: r.total, ultimo: r.ultimo, whatsapp: r.whatsapp }]));
}

const ms = (f) => (f ? new Date(f).getTime() : -Infinity);

/**
 * A quién le toca entre las activas. Pura: recibe las cuentas y devuelve la
 * elegida y el orden completo (para el registro de la decisión).
 *
 *   1.º menos asignados hoy · 2.º menos en total · 3.º la que lleva más tiempo
 *   sin recibir uno (el turno) · 4.º el id, para que el resultado no dependa del
 *   orden en que llegan.
 */
export function elegir(activas, cuentas) {
  const filas = [...activas].map((id) => {
    const c = cuentas.get(Number(id)) || { hoy: 0, total: 0, ultimo: null };
    return { id: Number(id), hoy: Number(c.hoy || 0), total: Number(c.total || 0), ultimo: c.ultimo || null, whatsapp: Number(c.whatsapp || 0) };
  });
  filas.sort((a, b) => (a.hoy - b.hoy) || (a.total - b.total) || (ms(a.ultimo) - ms(b.ultimo)) || (a.id - b.id));
  return { elegida: filas[0] || null, orden: filas };
}

/** «activa hace 4 min (estado) · 2 hoy · 310 en total»: el porqué, para la pantalla. */
export function porQue(fila, actividad, ahora = new Date()) {
  if (!fila) return 'Ninguna gestora activa';
  const hace = actividad?.ultima ? Math.max(0, Math.round((ahora - new Date(actividad.ultima)) / 60000)) : null;
  const cuando = hace == null ? 'activa' : hace === 0 ? 'activa ahora mismo' : `activa hace ${hace} min`;
  const wa = fila.whatsapp ? ` (${fila.whatsapp} por WhatsApp)` : '';
  return `${cuando}${actividad?.que ? ` (${actividad.que})` : ''} · ${fila.hoy} hoy${wa} · ${fila.total} en total`;
}
