import { query } from '../../shared/config/db.js';
import { COBRADO_DE } from '../conversions/cobrado.js';

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

// ─── Fase 3: el cobro del link, a su venta ──────────────────────────────────

/** Lo que hace falta de un link para atar su cobro. Sin recortar: lo pide Stripe. */
export async function paraCobro(id) {
  const { rows } = await query(
    `SELECT id, project_id, lead_id, conversion_id, product_id, created_by, importe, moneda,
            estado, stripe_payment_link_id
       FROM payment_links WHERE id = $1`,
    [id]);
  return rows[0] || null;
}

/** Lo pendiente de una venta (lo vendido menos la suma de sus pagos), o null si no existe. */
export async function pendienteDeVenta(conversionId) {
  const { rows } = await query(
    `SELECT GREATEST(c.importe_total - ${COBRADO_DE('c')}, 0) AS pendiente
       FROM conversions c WHERE c.id = $1`,
    [conversionId]);
  return rows[0] ? Number(rows[0].pendiente) : null;
}

/** Del cargo de Stripe a su link (`stripe_payments.payment_link_id`, migración 250). */
export async function atarCargo(stripePaymentId, linkId) {
  await query(
    `UPDATE stripe_payments SET payment_link_id = $2, updated_at = NOW()
      WHERE id = $1 AND payment_link_id IS DISTINCT FROM $2`,
    [stripePaymentId, linkId]);
}

/**
 * La venta de ese curso que ya tenga la ficha (la más reciente): la asesora pudo
 * registrarla a mano entre que mandó el link y que el cliente lo pagó. Sin curso
 * en el link no se adivina.
 */
export async function ventaDelCursoEnLaFicha(leadId, productId) {
  if (!leadId || !productId) return null;
  const { rows } = await query(
    `SELECT id FROM conversions
      WHERE lead_id = $1 AND producto_contratado_id = $2
      ORDER BY fecha_conversion DESC NULLS LAST, id DESC LIMIT 1`,
    [leadId, productId]);
  return rows[0] || null;
}

/** La venta y su ficha: a quién se avisa y a qué ficha va el cargo. */
export async function ventaConFicha(conversionId) {
  const { rows } = await query(
    `SELECT c.id, c.lead_id, l.nombre AS lead_nombre, l.responsable_id
       FROM conversions c LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.id = $1`,
    [conversionId]);
  return rows[0] || null;
}

/** El link sale de un prospecto: al crearse la venta, queda apuntada en él. */
export async function ponerVenta(linkId, conversionId) {
  await query(
    `UPDATE payment_links SET conversion_id = $2, updated_at = NOW()
      WHERE id = $1 AND conversion_id IS NULL`,
    [linkId, conversionId]);
}

/**
 * Pagado. Solo cambia la fila la primera vez (un cargo que vuelve a entrar por
 * el sondeo no lo marca otra vez) y devuelve el estado de antes: un link
 * caducado o anulado que el cliente llegó a pagar se marca pagado igual (el
 * dinero entró), pero se dice.
 */
export async function marcarPagado(linkId, { pagadoEl, conversionId }) {
  const { rows } = await query(
    `UPDATE payment_links pl
        SET estado = 'pagado', pagado_el = COALESCE(pl.pagado_el, $2::timestamptz),
            conversion_id = COALESCE(pl.conversion_id, $3), updated_at = NOW()
       FROM (SELECT id, estado FROM payment_links WHERE id = $1 FOR UPDATE) antes
      WHERE pl.id = antes.id AND pl.estado <> 'pagado'
      RETURNING antes.estado AS estado_antes`,
    [linkId, pagadoEl, conversionId]);
  return rows[0] || null;
}

/** Abierto: el cliente llegó a la página de pago (un intento fallido o una sesión que caducó). */
export async function marcarAbierto(linkId) {
  await query(
    `UPDATE payment_links SET estado = 'abierto', updated_at = NOW() WHERE id = $1 AND estado = 'creado'`,
    [linkId]);
}

/** Los ids de la sesión de Checkout que pagó el link, sin pisar los que ya hubiera. */
export async function datosDeCheckout(linkId, { sessionId, paymentIntentId, customerId }) {
  await query(
    `UPDATE payment_links
        SET stripe_checkout_session_id = COALESCE($2, stripe_checkout_session_id),
            stripe_payment_intent_id   = COALESCE($3, stripe_payment_intent_id),
            stripe_customer_id         = COALESCE($4, stripe_customer_id),
            updated_at = NOW()
      WHERE id = $1`,
    [linkId, sessionId, paymentIntentId, customerId]);
}

/**
 * Un aviso de Stripe en el historial del link. `stripe_event_id` es único: si
 * Stripe lo reintenta, no se apunta dos veces. Devuelve true si se apuntó.
 */
export async function anotarEventoDeStripe(linkId, tipo, datos, stripeEventId) {
  const { rows } = await query(
    `INSERT INTO payment_link_eventos (link_id, tipo, datos, stripe_event_id)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (stripe_event_id) DO NOTHING RETURNING id`,
    [linkId, tipo, JSON.stringify(datos), stripeEventId]);
  return rows.length > 0;
}

/**
 * Lo que llega por el cargo (sondeo o aviso), que no trae id de evento: se
 * apunta una vez por link, tipo y cargo.
 */
export async function anotarEventoDelCargo(linkId, tipo, datos) {
  await query(
    `INSERT INTO payment_link_eventos (link_id, tipo, datos)
     SELECT $1::int, $2::varchar, $3::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM payment_link_eventos
                         WHERE link_id = $1 AND tipo = $2 AND datos->>'stripe_id' = $4)`,
    [linkId, tipo, JSON.stringify(datos), String(datos.stripe_id)]);
}
