import { query } from '../../shared/config/db.js';

/*
  LINKS DE PAGO (CRM#680, fase 1): solo lectura.

  Aquí todavía no se crea ni se cambia ningún link: eso llega en la fase 2, con
  la llamada a Stripe. Lo que hay es lo que necesitan las vistas que pidió Diego
  (por gestora, por prospecto o venta, por campus y por estado) y el detalle con
  su historial.

  El recorte lo decide el controlador y llega ya hecho: `projectIds` (los campus
  de quien pide) y `creadores` (null = cualquiera de esos campus; una lista =
  solo los de esas personas). Este fichero no mira la sesión.
*/

// Lo que se enseña de cada link en una lista. Los ids de Stripe van en el detalle.
const COLUMNAS = `
  pl.id, pl.project_id, p.nombre AS project_nombre,
  pl.lead_id, l.nombre AS lead_nombre,
  pl.conversion_id,
  pl.product_id, pr.nombre AS product_nombre,
  pl.created_by, cr.nombre AS creado_por_nombre,
  pl.precio_catalogo, pl.importe, pl.descuento_pct, pl.moneda,
  pl.modalidad, pl.num_cuotas, pl.importe_cuota,
  pl.estado, pl.url, pl.caduca_el, pl.pagado_el,
  pl.anulado_por, an.nombre AS anulado_por_nombre, pl.anulado_el, pl.motivo_anulacion,
  pl.created_at, pl.updated_at`;

const UNIONES = `
  FROM payment_links pl
  JOIN projects p       ON p.id = pl.project_id
  LEFT JOIN leads l     ON l.id = pl.lead_id
  LEFT JOIN products pr ON pr.id = pl.product_id
  LEFT JOIN users cr    ON cr.id = pl.created_by
  LEFT JOIN users an    ON an.id = pl.anulado_por`;

/**
 * Los links del ámbito, del más nuevo al más viejo, paginados.
 * `{ rows, total }`.
 */
export async function listar({ projectIds, creadores = null, estado = null, leadId = null,
  conversionId = null, createdBy = null, page = 1, limit = 25 }) {
  const params = [projectIds];
  const donde = ['pl.project_id = ANY($1::int[])'];
  const poner = (sql, valor) => { params.push(valor); donde.push(sql.replace('?', `$${params.length}`)); };
  if (creadores) poner('pl.created_by = ANY(?::int[])', creadores);
  if (createdBy) poner('pl.created_by = ?', createdBy);
  if (estado) poner('pl.estado = ?', estado);
  if (leadId) poner('pl.lead_id = ?', leadId);
  if (conversionId) poner('pl.conversion_id = ?', conversionId);
  const where = donde.join(' AND ');

  const { rows: [{ total }] } = await query(
    `SELECT COUNT(*)::int AS total FROM payment_links pl WHERE ${where}`, params);
  const { rows } = await query(
    `SELECT ${COLUMNAS} ${UNIONES}
      WHERE ${where}
      ORDER BY pl.created_at DESC, pl.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]);
  return { rows, total };
}

/** Un link con sus ids de Stripe, o null. Sin recortar: eso lo hace quien llama. */
export async function porId(id) {
  const { rows } = await query(
    `SELECT ${COLUMNAS},
            pl.stripe_payment_link_id, pl.stripe_checkout_session_id, pl.stripe_payment_intent_id,
            pl.stripe_customer_id, pl.stripe_subscription_id, pl.stripe_schedule_id
       ${UNIONES}
      WHERE pl.id = $1`,
    [id]);
  return rows[0] || null;
}

/** Lo que ha pasado con un link, en orden. */
export async function eventos(linkId) {
  const { rows } = await query(
    `SELECT id, tipo, ocurrido_el, stripe_event_id, datos
       FROM payment_link_eventos
      WHERE link_id = $1
      ORDER BY ocurrido_el, id`,
    [linkId]);
  return rows;
}

/** Los cobros de Stripe que vienen de este link (fase 3 los ata). */
export async function cobros(linkId) {
  const { rows } = await query(
    `SELECT id, stripe_id, status, amount, currency, conversion_id, conversion_payment_id,
            stripe_created_at
       FROM stripe_payments
      WHERE payment_link_id = $1
      ORDER BY stripe_created_at`,
    [linkId]);
  return rows;
}

/** El descuento máximo del campus. null si el campus no existe. */
export async function descuentoMaximo(projectId) {
  const { rows } = await query(
    'SELECT id, links_pago_descuento_max_pct FROM projects WHERE id = $1', [projectId]);
  if (!rows[0]) return null;
  return Number(rows[0].links_pago_descuento_max_pct);
}

export async function guardarDescuentoMaximo(projectId, pct) {
  const { rows } = await query(
    `UPDATE projects SET links_pago_descuento_max_pct = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING links_pago_descuento_max_pct`,
    [projectId, pct]);
  return rows[0] ? Number(rows[0].links_pago_descuento_max_pct) : null;
}
