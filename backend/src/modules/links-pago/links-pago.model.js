import { query } from '../../shared/config/db.js';

/*
  LINKS DE PAGO (CRM#680).

  Fase 1: lo que necesitan las vistas que pidió Diego (por gestora, por
  prospecto o venta, por campus y por estado) y el detalle con su historial.
  Fase 2 (al final): las reglas del campus y la fila de cada link al crearlo,
  anularlo o caducarlo. Aquí no se llama a Stripe: eso es `links-pago.service.js`.

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

// ─── Fase 2: configuración, crear, anular y caducar ─────────────────────────

const COLUMNAS_CONFIG = `
  links_pago_descuento_max_pct AS descuento_max_pct,
  links_pago_caducidad_dias AS caducidad_dias,
  links_pago_caducidad_max_dias AS caducidad_max_dias,
  links_pago_cuotas_admitidas AS cuotas_admitidas,
  links_pago_cuotas_max AS cuotas_max,
  links_pago_monedas::text[] AS monedas,
  links_pago_moneda_defecto AS moneda_defecto`;

function configDeFila(r) {
  if (!r) return null;
  return {
    descuento_max_pct: Number(r.descuento_max_pct),
    caducidad_dias: Number(r.caducidad_dias),
    caducidad_max_dias: Number(r.caducidad_max_dias),
    cuotas_admitidas: r.cuotas_admitidas === true,
    cuotas_max: Number(r.cuotas_max),
    monedas: r.monedas || [],
    moneda_defecto: r.moneda_defecto,
  };
}

/** Las reglas de los links del campus (migraciones 314 y 315). null si no existe. */
export async function config(projectId) {
  const { rows } = await query(`SELECT ${COLUMNAS_CONFIG} FROM projects WHERE id = $1`, [projectId]);
  return configDeFila(rows[0]);
}

const COLUMNA_DE = {
  descuento_max_pct: 'links_pago_descuento_max_pct',
  caducidad_dias: 'links_pago_caducidad_dias',
  caducidad_max_dias: 'links_pago_caducidad_max_dias',
  cuotas_admitidas: 'links_pago_cuotas_admitidas',
  cuotas_max: 'links_pago_cuotas_max',
  monedas: 'links_pago_monedas',
  moneda_defecto: 'links_pago_moneda_defecto',
};

/** Guarda solo lo que venga. Las columnas salen de una lista fija, nunca del cuerpo. */
export async function guardarConfig(projectId, cambios) {
  const sets = [];
  const params = [projectId];
  for (const [campo, columna] of Object.entries(COLUMNA_DE)) {
    if (cambios[campo] === undefined) continue;
    params.push(cambios[campo]);
    sets.push(`${columna} = $${params.length}${campo === 'monedas' ? '::varchar(3)[]' : ''}`);
  }
  if (!sets.length) return config(projectId);
  const { rows } = await query(
    `UPDATE projects SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING ${COLUMNAS_CONFIG}`,
    params);
  return configDeFila(rows[0]);
}

/** El prospecto con lo que hace falta para decidir si la persona puede: campus y responsable. */
export async function lead(leadId) {
  const { rows } = await query(
    'SELECT id, project_id, responsable_id, nombre, email FROM leads WHERE id = $1', [leadId]);
  return rows[0] || null;
}

/** La venta, con su prospecto y su curso. */
export async function venta(conversionId) {
  const { rows } = await query(
    `SELECT c.id, c.project_id, c.lead_id, c.vendedora_id, c.producto_contratado_id,
            l.responsable_id
       FROM conversions c
       LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.id = $1`,
    [conversionId]);
  return rows[0] || null;
}

export async function producto(productId) {
  const { rows } = await query(
    'SELECT id, project_id, nombre, precio, moneda FROM products WHERE id = $1', [productId]);
  return rows[0] || null;
}

/** El link recién apuntado, todavía sin URL: se rellena cuando Stripe contesta. */
export async function insertar(l) {
  const { rows } = await query(
    `INSERT INTO payment_links (project_id, lead_id, conversion_id, product_id, created_by,
        precio_catalogo, importe, descuento_pct, moneda, modalidad, estado, caduca_el)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unico', 'creado', NOW() + make_interval(days => $10))
     RETURNING id, created_at, caduca_el`,
    [l.projectId, l.leadId, l.conversionId, l.productId, l.createdBy,
      l.precioCatalogo, l.importe, l.descuentoPct, l.moneda, l.caducidadDias]);
  return rows[0];
}

export async function completarConStripe(id, { url, paymentLinkId, priceId }) {
  await query(
    `UPDATE payment_links
        SET url = $2, stripe_payment_link_id = $3, stripe_price_id = $4, updated_at = NOW()
      WHERE id = $1`,
    [id, url, paymentLinkId, priceId]);
}

/** Si Stripe no lo crea, el link no existe: no se deja una fila sin URL. */
export async function borrar(id) {
  await query('DELETE FROM payment_links WHERE id = $1', [id]);
}

export async function anotarEvento(linkId, tipo, datos = {}) {
  await query(
    'INSERT INTO payment_link_eventos (link_id, tipo, datos) VALUES ($1, $2, $3::jsonb)',
    [linkId, tipo, JSON.stringify(datos)]);
}

// Solo los vivos pasan a anulado o caducado. Si dos lo intentan a la vez, o el
// cron caduca uno que alguien está anulando, solo el primero cambia la fila.
const VIVOS = `estado IN ('creado', 'abierto')`;

export async function marcarAnulado(id, { userId, motivo }) {
  const { rows } = await query(
    `UPDATE payment_links
        SET estado = 'anulado', anulado_por = $2, anulado_el = NOW(), motivo_anulacion = $3, updated_at = NOW()
      WHERE id = $1 AND ${VIVOS}
      RETURNING id`,
    [id, userId, motivo]);
  return rows.length > 0;
}

export async function marcarCaducado(id) {
  const { rows } = await query(
    `UPDATE payment_links SET estado = 'caducado', updated_at = NOW()
      WHERE id = $1 AND ${VIVOS} RETURNING id`,
    [id]);
  return rows.length > 0;
}

/** Los vivos con la fecha pasada, los más viejos primero. */
export async function porCaducar(lote = 50) {
  const { rows } = await query(
    `SELECT id, project_id, stripe_payment_link_id
       FROM payment_links
      WHERE ${VIVOS} AND caduca_el <= NOW()
      ORDER BY caduca_el, id
      LIMIT $1`,
    [lote]);
  return rows;
}

/** Los campus (de esta lista, o todos con null) que usan el mismo webhook de Stripe. */
export async function campusDelWebhook(endpointId, projectIds) {
  const { rows } = await query(
    `SELECT p.id, p.nombre
       FROM project_integrations pi
       JOIN projects p ON p.id = pi.project_id
      WHERE pi.provider = 'stripe'
        AND pi.config_public->>'webhook_endpoint_id' = $1
        AND ($2::int[] IS NULL OR p.id = ANY($2::int[]))
      ORDER BY p.nombre`,
    [endpointId, projectIds]);
  return rows;
}
