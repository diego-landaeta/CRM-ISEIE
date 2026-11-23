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
  pl.conversion_id, cpr.nombre AS venta_producto_nombre,
  pl.installment_id, ci.numero AS cuota_numero, ci.fecha_vencimiento AS cuota_vence,
  pl.product_id, pr.nombre AS product_nombre,
  pl.created_by, cr.nombre AS creado_por_nombre,
  pl.precio_catalogo, pl.importe, pl.descuento_pct, pl.moneda,
  pl.modalidad, pl.num_cuotas, pl.importe_cuota, pl.importe_inicial, pl.plan_cuotas,
  pl.precio_original, pl.descuento_tipo, pl.descuento_valor, pl.descuento_importe,
  pl.estado, pl.url, pl.caduca_el, pl.pagado_el, pl.guarda_tarjeta,
  pl.anulado_por, an.nombre AS anulado_por_nombre, pl.anulado_el, pl.motivo_anulacion,
  pl.abierto_el, pl.aviso_gestora_el, pl.recordatorio_24h_el, pl.recordatorio_72h_el,
  pl.renovado_de, pl.renovado_por,
  pl.created_at, pl.updated_at`;

const UNIONES = `
  FROM payment_links pl
  JOIN projects p       ON p.id = pl.project_id
  LEFT JOIN leads l     ON l.id = pl.lead_id
  LEFT JOIN products pr ON pr.id = pl.product_id
  LEFT JOIN users cr    ON cr.id = pl.created_by
  LEFT JOIN users an    ON an.id = pl.anulado_por
  LEFT JOIN conversions cv ON cv.id = pl.conversion_id
  LEFT JOIN products cpr   ON cpr.id = cv.producto_contratado_id
  LEFT JOIN conversion_installments ci ON ci.id = pl.installment_id`;

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
  links_pago_moneda_defecto AS moneda_defecto,
  links_pago_cobro_auto AS cobro_auto,
  links_pago_cobro_auto_reintento_dias AS cobro_auto_reintento_dias,
  links_pago_aviso_abierto_horas AS aviso_abierto_horas,
  links_pago_recordatorios AS recordatorios`;

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
    // Cobro automático de las cuotas (309).
    cobro_auto: r.cobro_auto === true,
    cobro_auto_reintento_dias: Number(r.cobro_auto_reintento_dias),
    // Seguimiento de los que no se pagan (gemela de CRM#984).
    aviso_abierto_horas: Number(r.aviso_abierto_horas),
    recordatorios: r.recordatorios === true,
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
  cobro_auto: 'links_pago_cobro_auto',
  cobro_auto_reintento_dias: 'links_pago_cobro_auto_reintento_dias',
  aviso_abierto_horas: 'links_pago_aviso_abierto_horas',
  recordatorios: 'links_pago_recordatorios',
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
    'SELECT id, project_id, responsable_id, nombre, email, telefono, producto_interes_id FROM leads WHERE id = $1', [leadId]);
  return rows[0] || null;
}

/*
  Las ventas de un prospecto, para elegir a cuál va el link (Diego, 19/11: «que
  ese botón se pueda asociar a las ventas de un lead en específico»). Con su
  programa, su total, lo cobrado (la suma de sus pagos, #692) y lo pendiente,
  que es el importe que se propone y el tope del link (CRM#909).
*/
export async function ventasDelProspecto(leadId) {
  const { rows } = await query(
    `SELECT c.id, c.project_id, c.producto_contratado_id, pr.nombre AS producto_nombre,
            c.importe_total, ${COBRADO_DE('c')} AS cobrado,
            GREATEST(c.importe_total - ${COBRADO_DE('c')}, 0) AS pendiente,
            c.fecha_conversion, c.vendedora_id
       FROM conversions c
       LEFT JOIN products pr ON pr.id = c.producto_contratado_id
      WHERE c.lead_id = $1
      ORDER BY c.fecha_conversion DESC NULLS LAST, c.id DESC
      LIMIT 50`,
    [leadId]);
  return rows.map((r) => ({
    ...r, importe_total: Number(r.importe_total), cobrado: Number(r.cobrado), pendiente: Number(r.pendiente),
  }));
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
        precio_catalogo, importe, descuento_pct, moneda, modalidad, estado, caduca_el, installment_id, guarda_tarjeta,
        num_cuotas, importe_cuota, importe_inicial, precio_original, descuento_tipo, descuento_valor, descuento_importe,
        plan_cuotas)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $13::int IS NULL THEN 'unico' ELSE 'cuotas' END, 'creado',
             NOW() + make_interval(days => $10), $11, $12, $13, $14, $15, $16, $17, $18, COALESCE($19::numeric, 0),
             $20::jsonb)
     RETURNING id, created_at, caduca_el`,
    [l.projectId, l.leadId, l.conversionId, l.productId, l.createdBy,
      l.precioCatalogo, l.importe, l.descuentoPct, l.moneda, l.caducidadDias, l.installmentId ?? null, l.guardaTarjeta === true,
      // Link sencillo en cuotas (20/11): `importe` es el total; `importe_cuota`, lo que cobra el link.
      l.numCuotas ?? null, l.importeCuota ?? null,
      // Sin el ::numeric de arriba, COALESCE($19, 0) tipaba el descuento como entero y
      // 44,50 € daba un 500 (QA de staging, 21/11).
      // CRM-ISEIE#657 (321): la inicial, y el precio antes del descuento con su descuento.
      l.importeInicial ?? null, l.precioOriginal ?? null, l.descuentoTipo ?? null, l.descuentoValor ?? null,
      l.descuentoImporte ?? null,
      // 326 (23/11): las cuotas de después de la inicial con su importe y su fecha.
      l.planCuotas ? JSON.stringify(l.planCuotas) : null]);
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
            estado, stripe_payment_link_id, installment_id, guarda_tarjeta, modalidad, num_cuotas, importe_cuota,
            importe_inicial, plan_cuotas, precio_original, descuento_tipo, descuento_valor, descuento_importe
       FROM payment_links WHERE id = $1`,
    [id]);
  return rows[0] || null;
}

/*
  EL DESCUENTO DEL LINK, EN SU VENTA (CRM#982). La venta se crea por el total del
  link (lo que paga el alumno); aquí se le apunta de dónde sale: el precio antes
  del descuento (subtotal_bruto) y el descuento, con las columnas de siempre de la
  venta (093). El total, la base y el IVA no cambian: ya son los del total.
  Solo una venta que creó el link y sin descuento todavía; en euros, que es como
  guarda el CRM la venta.
*/
export async function descuentoEnLaVenta(conversionId, link) {
  if (!link?.descuento_tipo || !(Number(link.descuento_importe) > 0) || link.precio_original == null) return false;
  if (String(link.moneda || 'EUR').toUpperCase() !== 'EUR') return false;
  const { rowCount } = await query(
    `UPDATE conversions
        SET subtotal_bruto = $2, descuento_tipo = $3, descuento_valor = $4, descuento_importe = $5, updated_at = NOW()
      WHERE id = $1 AND descuento_tipo = 'none'
        AND ROUND(importe_total * 100) = ROUND(($2::numeric - $5::numeric) * 100)`,
    [conversionId, link.precio_original, link.descuento_tipo, link.descuento_valor, link.descuento_importe]);
  return rowCount > 0;
}

/*
  EL PLAN DE PAGO (Diego, 19/11): las cuotas por cobrar de la venta, por número,
  con el link vivo que ya tenga cada una (si lo tiene). Una cuota con link vivo no
  se vuelve a generar: se reenvía el que hay.
*/
export async function cuotasPendientes(conversionId) {
  const { rows } = await query(
    `SELECT ci.id, ci.numero, ci.importe_previsto::float8 AS importe, ci.fecha_vencimiento::text AS vence, ci.concepto,
            l.id AS link_id, l.estado AS link_estado, l.url AS link_url, l.caduca_el AS link_caduca_el,
            COALESCE(l.guarda_tarjeta, false) AS link_guarda_tarjeta
       FROM conversion_installments ci
       LEFT JOIN LATERAL (
         SELECT id, estado, url, caduca_el, guarda_tarjeta FROM payment_links
          WHERE installment_id = ci.id AND estado IN ('creado', 'abierto')
          ORDER BY id DESC LIMIT 1
       ) l ON true
      WHERE ci.conversion_id = $1 AND ci.fecha_cobro IS NULL
      ORDER BY ci.numero`,
    [conversionId]);
  return rows;
}

/** La venta para el plan: su curso, su total, lo cobrado y lo pendiente, y su prospecto. */
export async function ventaParaPlan(conversionId) {
  const { rows } = await query(
    `SELECT c.id, c.project_id, c.lead_id, l.nombre AS lead_nombre, l.email AS lead_email,
            c.producto_contratado_id, pr.nombre AS producto_nombre,
            c.importe_total::float8 AS importe_total, ${COBRADO_DE('c')}::float8 AS cobrado,
            GREATEST(c.importe_total - ${COBRADO_DE('c')}, 0)::float8 AS pendiente
       FROM conversions c
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN products pr ON pr.id = c.producto_contratado_id
      WHERE c.id = $1`,
    [conversionId]);
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

/**
 * El link sale de un prospecto (o de nadie): al crearse la venta, queda apuntada
 * en él, y con ella su prospecto si no lo tenía (link sin prospecto, 20/11).
 */
export async function ponerVenta(linkId, conversionId, leadId = null) {
  await query(
    `UPDATE payment_links SET conversion_id = $2, lead_id = COALESCE(lead_id, $3), updated_at = NOW()
      WHERE id = $1 AND conversion_id IS NULL`,
    [linkId, conversionId, leadId]);
}

/** Las notas con las que el CRM crea la venta de un link (y por las que la reconoce). */
export const notasDeLaVenta = (linkId, stripeId) =>
  `Pagada con el link de pago n.º ${linkId} (Stripe ${stripeId}). Venta creada por el CRM al llegar el cobro.`;

/**
 * La venta que ya creó este link en un intento que se cortó antes de apuntarla
 * en él (se cayó el proceso entre crear la venta y `ponerVenta`). Así un segundo
 * aviso de Stripe no crea otra.
 */
export async function ventaCreadaPorElLink(projectId, linkId) {
  const { rows } = await query(
    `SELECT id, lead_id FROM conversions
      WHERE project_id = $1 AND notas_pago LIKE $2
      ORDER BY id LIMIT 1`,
    [projectId, `Pagada con el link de pago n.º ${Number(linkId)} (%`]);
  return rows[0] || null;
}

/** La primera cuota por cobrar de una venta (la que salda el pago del link en cuotas). */
export async function primeraCuotaPendiente(conversionId) {
  const { rows } = await query(
    `SELECT id FROM conversion_installments
      WHERE conversion_id = $1 AND fecha_cobro IS NULL
      ORDER BY numero LIMIT 1`,
    [conversionId]);
  return rows[0]?.id ?? null;
}

/**
 * Quién pagó, según la sesión de Checkout (correo, nombre y teléfono): lo apunta
 * `desdeLaSesion` en el historial del link. Por si el cargo no los trae.
 */
export async function clienteDelCheckout(linkId) {
  const { rows } = await query(
    `SELECT datos->'cliente' AS cliente FROM payment_link_eventos
      WHERE link_id = $1 AND datos ? 'cliente'
      ORDER BY id DESC LIMIT 1`,
    [linkId]);
  return rows[0]?.cliente || null;
}

/** El teléfono de Checkout, en el prospecto que creó el link, si no tenía. */
export async function completarTelefono(linkId, telefono) {
  if (!telefono) return;
  await query(
    `UPDATE leads SET telefono = $2, updated_at = NOW()
      WHERE id = (SELECT lead_id FROM payment_links WHERE id = $1)
        AND COALESCE(telefono, '') = ''`,
    [linkId, telefono]);
}

/** El nombre del campus (el alumno lo lee en el consentimiento de las cuotas). */
export async function nombreDelCampus(projectId) {
  const { rows } = await query('SELECT nombre FROM projects WHERE id = $1', [projectId]);
  return rows[0]?.nombre || null;
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
    `UPDATE payment_links SET estado = 'abierto', abierto_el = COALESCE(abierto_el, NOW()), updated_at = NOW()
      WHERE id = $1 AND estado = 'creado'`,
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
