import { query } from '../../shared/config/db.js';

/*
  SEGUIMIENTO DE LOS LINKS QUE NO SE PAGAN (CRM#984, migración 322).

  Las consultas del trabajo de cada 15 minutos y de «Renovar». Aquí no se llama
  a Stripe ni se manda nada: eso es `links-pago.seguimiento.js`.

  Cada aviso sale UNA vez: antes de mandarlo se «reserva» poniendo su fecha
  (`... WHERE <fecha> IS NULL RETURNING id`). Si dos vueltas coinciden, solo una
  lo consigue; si el envío falla después, no se reintenta (mejor un recordatorio
  de menos que dos iguales).
*/

const VIVOS = `pl.estado IN ('creado', 'abierto')`;

/**
 * Los links sin abrir que hay que mirar en Stripe, los que hace más que no se
 * miran primero. Solo los vivos y con link en Stripe.
 */
export async function paraRevisarAperturas(lote = 40) {
  const { rows } = await query(
    `SELECT pl.id, pl.project_id, pl.stripe_payment_link_id
       FROM payment_links pl
      WHERE pl.estado = 'creado' AND pl.stripe_payment_link_id IS NOT NULL AND pl.caduca_el > NOW()
        AND (pl.sesiones_revisadas_el IS NULL OR pl.sesiones_revisadas_el < NOW() - INTERVAL '14 minutes')
      ORDER BY pl.sesiones_revisadas_el NULLS FIRST, pl.created_at DESC, pl.id
      LIMIT $1`,
    [lote]);
  return rows;
}

export async function apuntarRevision(id) {
  await query('UPDATE payment_links SET sesiones_revisadas_el = NOW() WHERE id = $1', [id]);
}

/**
 * Abierto, con la hora de la primera sesión de Checkout. Solo cambia un link
 * «creado»: true si lo ha cambiado (para apuntarlo en su historial una vez).
 */
export async function marcarAbiertoEl(id, cuando) {
  const { rows } = await query(
    `UPDATE payment_links
        SET estado = 'abierto', abierto_el = COALESCE(abierto_el, $2::timestamptz), updated_at = NOW()
      WHERE id = $1 AND estado = 'creado'
      RETURNING id`,
    [id, cuando]);
  return rows.length > 0;
}

// Lo que hace falta para avisar a la gestora o recordárselo al alumno.
const DATOS = `
  pl.id, pl.project_id, pl.lead_id, pl.conversion_id, pl.created_by, pl.estado,
  pl.importe, pl.moneda, pl.modalidad, pl.num_cuotas, pl.importe_cuota,
  pl.url, pl.caduca_el, pl.abierto_el, pl.created_at,
  l.nombre AS lead_nombre, l.email AS lead_email, l.telefono AS lead_telefono, l.responsable_id,
  pr.nombre AS producto_nombre,
  p.nombre AS campus, p.slug, p.logo_url, p.emoji,
  cr.nombre AS creado_por_nombre`;

const UNIONES = `
  FROM payment_links pl
  JOIN projects p       ON p.id = pl.project_id
  LEFT JOIN leads l     ON l.id = pl.lead_id
  LEFT JOIN products pr ON pr.id = pl.product_id
  LEFT JOIN users cr    ON cr.id = pl.created_by`;

/**
 * Abiertos y sin pagar desde hace las horas del campus, sin aviso todavía. Solo
 * los abiertos en la última semana: al encender el seguimiento no salen avisos
 * de links viejos.
 */
export async function paraAvisarGestora(lote = 50) {
  const { rows } = await query(
    `SELECT ${DATOS}, p.links_pago_aviso_abierto_horas AS horas
       ${UNIONES}
      WHERE pl.estado = 'abierto' AND pl.abierto_el IS NOT NULL AND pl.aviso_gestora_el IS NULL
        AND pl.abierto_el <= NOW() - make_interval(hours => p.links_pago_aviso_abierto_horas)
        AND pl.abierto_el > NOW() - INTERVAL '7 days'
      ORDER BY pl.abierto_el, pl.id
      LIMIT $1`,
    [lote]);
  return rows;
}

/*
  Los recordatorios al alumno. Cada uno tiene su ventana, para que al encender el
  seguimiento un link de hace cinco días no reciba los dos de golpe:
    · 24 h: creado hace entre 24 y 72 horas;
    · 72 h: creado hace entre 72 y 96 horas.
  Solo los vivos, que no caduquen en la próxima hora y de un campus con los
  recordatorios puestos.
*/
const VENTANAS = {
  '24h': { columna: 'recordatorio_24h_el', desde: 24, hasta: 72 },
  '72h': { columna: 'recordatorio_72h_el', desde: 72, hasta: 96 },
};

export const CUALES = Object.keys(VENTANAS);

export async function paraRecordar(cual, lote = 50) {
  const v = VENTANAS[cual];
  if (!v) throw new Error(`Recordatorio desconocido: ${cual}`);
  const { rows } = await query(
    `SELECT ${DATOS}
       ${UNIONES}
      WHERE ${VIVOS} AND pl.${v.columna} IS NULL AND pl.url IS NOT NULL
        AND p.links_pago_recordatorios
        AND pl.created_at <= NOW() - make_interval(hours => $2)
        AND pl.created_at >  NOW() - make_interval(hours => $3)
        AND pl.caduca_el > NOW() + INTERVAL '1 hour'
      ORDER BY pl.created_at, pl.id
      LIMIT $1`,
    [lote, v.desde, v.hasta]);
  return rows;
}

/** Reserva el aviso: true si esta vuelta es la que lo manda. */
export async function reservar(id, cual) {
  const columna = cual === 'gestora' ? 'aviso_gestora_el' : VENTANAS[cual]?.columna;
  if (!columna) throw new Error(`Aviso desconocido: ${cual}`);
  const { rows } = await query(
    `UPDATE payment_links SET ${columna} = NOW() WHERE id = $1 AND ${columna} IS NULL RETURNING id`, [id]);
  return rows.length > 0;
}

/** La conversación de WhatsApp de esa gestora con ese prospecto, si la hay y se le puede escribir. */
export async function conversacionDeWhatsapp(leadId, instancia) {
  if (!leadId || !instancia) return null;
  const { rows } = await query(
    `SELECT id FROM wa_conversaciones
      WHERE lead_id = $1 AND instancia = $2 AND NOT no_escribir
      ORDER BY ultimo_at DESC NULLS LAST, id DESC LIMIT 1`,
    [leadId, instancia]);
  return rows[0]?.id ?? null;
}

// ─── Renovar ────────────────────────────────────────────────────────────────

/** La cuota de un link de plan de pago, si sigue por cobrar. */
export async function cuotaPendiente(installmentId) {
  const { rows } = await query(
    `SELECT id, numero, importe_previsto::float8 AS importe, fecha_vencimiento::text AS vence
       FROM conversion_installments WHERE id = $1 AND fecha_cobro IS NULL`,
    [installmentId]);
  return rows[0] || null;
}

/** Lo que hace falta del link caducado para crear el nuevo. */
export async function paraRenovar(id) {
  const { rows } = await query('SELECT * FROM payment_links WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * Ata el caducado con el nuevo. El índice único de `renovado_de` impide que un
 * caducado tenga dos; si ya tenía, false.
 */
export async function atarRenovacion(viejoId, nuevoId) {
  const { rows } = await query(
    `UPDATE payment_links SET renovado_por = $2, updated_at = NOW()
      WHERE id = $1 AND renovado_por IS NULL RETURNING id`,
    [viejoId, nuevoId]);
  if (!rows.length) return false;
  await query('UPDATE payment_links SET renovado_de = $1 WHERE id = $2', [viejoId, nuevoId]);
  return true;
}
