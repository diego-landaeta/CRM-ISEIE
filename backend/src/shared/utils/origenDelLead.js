/**
 * De dónde llegó un lead: si entró solo o lo dio de alta una gestora, y si fue
 * por WhatsApp.
 *
 * Diego, 29/10: «WhatsApp es que toquen el widget, y tocan y ellas cargan». Lo
 * usan el «Resumen del día» (la columna «Prospectos» de cada gestora) y las
 * cifras del botón de WhatsApp de la web, y tienen que contar lo mismo.
 *
 * @param {string} l  alias de `leads` en la consulta que lo usa
 */

/** Entró solo: por un formulario, por Make o por la asignación por actividad. */
export const ENTRA_SOLO = (l) => `(${l}.idempotency_key IS NOT NULL
  OR EXISTS (SELECT 1 FROM make_webhook_deliveries m WHERE m.lead_id = ${l}.id)
  OR EXISTS (SELECT 1 FROM asignacion_decisiones d WHERE d.lead_id = ${l}.id))`;

/** Su origen es WhatsApp (en el alta a mano, lo elige la gestora). */
export const POR_WHATSAPP = (l) => `EXISTS (SELECT 1 FROM lead_utms lu WHERE lu.lead_id = ${l}.id AND lu.canal_detectado::text = 'whatsapp')`;

/** Lo dio de alta una gestora con origen WhatsApp: lo que llega por el botón de la web. */
export const ALTA_POR_WHATSAPP = (l) => `(NOT ${ENTRA_SOLO(l)} AND ${POR_WHATSAPP(l)})`;
