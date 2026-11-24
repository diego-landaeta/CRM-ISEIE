import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';

/*
  STRIPE PRESTADO (24/11/2026; migración 332).

  Diego: «ICTESS US e Instituto Naval usarán momentáneamente el Stripe de
  ICTESS». Un campus declara en `projects.stripe_prestado_de` que cobra con la
  cuenta de Stripe de OTRO campus de su misma empresa, sin claves propias.

  Por qué no basta con copiarle la integración «Stripe»: cada campus con esa
  integración sincroniza TODOS los cargos de la cuenta (`/v1/charges`) y
  `stripe_payments` es único por (campus, cargo). El mismo cobro saldría en
  dos o tres campus. Aquí hay UNA cuenta, UNA sincronización (la del dueño) y
  cada cargo va a UN campus:

    · el de su marca (`crm_project_id`), si es de uno que le toma prestada la
      cuenta al dueño;
    · si no lleva marca pero su cliente de Stripe es el de una venta con cobro
      automático de ese campus (las cuotas que Stripe cobra sola llegan sin la
      marca del link), ese campus;
    · si no, el dueño, como siempre.

  Las claves (`getStripeKey`, `claveDeEscritura`) de quien la toma prestada son
  las del dueño, y el aviso de Stripe llega por la ruta del dueño: se procesa
  como el campus de la marca (`campusDelEvento`).

  Solo vale entre campus de la MISMA empresa (`sociedad_emisora_id`): el dinero
  entra en la cuenta del dueño y las facturas salen de la empresa; con dos
  empresas, una cobraría lo que factura la otra. La base lo impide al
  declararlo (disparador de la 332) y aquí se vuelve a mirar al leerlo: si un
  día dejan de ser de la misma empresa, el préstamo se ignora.

  Un solo nivel: el dueño no toma prestada la de nadie.
*/

const MISMA_EMPRESA = `p.sociedad_emisora_id IS NOT NULL
         AND p.sociedad_emisora_id = d.sociedad_emisora_id
         AND d.stripe_prestado_de IS NULL`;

/** `{ id, nombre }` del campus cuya cuenta usa este, o null (cuenta propia o ninguna). */
export async function prestadoDe(projectId) {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const { rows } = await query(
    `SELECT d.id, d.nombre
       FROM projects p
       JOIN projects d ON d.id = p.stripe_prestado_de
      WHERE p.id = $1 AND ${MISMA_EMPRESA}`, [id]);
  return rows[0] ? { id: Number(rows[0].id), nombre: rows[0].nombre } : null;
}

/** Lo mismo para varios campus: `Map(id → { id, nombre })`, solo los que la toman prestada. */
export async function prestadosDe(projectIds) {
  const ids = [...new Set((projectIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return new Map();
  const { rows } = await query(
    `SELECT p.id AS campus, d.id, d.nombre
       FROM projects p
       JOIN projects d ON d.id = p.stripe_prestado_de
      WHERE p.id = ANY($1::int[]) AND ${MISMA_EMPRESA}`, [ids]);
  return new Map(rows.map((r) => [Number(r.campus), { id: Number(r.id), nombre: r.nombre }]));
}

/**
 * El campus dueño de la cuenta de Stripe que usa este: el que se la presta, o
 * él mismo (tal cual llegó, para no cambiar nada a quien no la toma prestada).
 */
export async function duenoDeLaCuenta(projectId) {
  try {
    const d = await prestadoDe(projectId);
    return d ? d.id : projectId;
  } catch (err) {
    // Si no se puede leer, como antes del préstamo: la cuenta del propio campus.
    logger.warn({ err: err.message, projectId }, 'Stripe prestado: no se pudo leer de quién es la cuenta');
    return projectId;
  }
}

/** Los campus que usan la cuenta de este dueño (vacío si no la presta). */
export async function quienesLaUsan(duenoId) {
  const id = Number(duenoId);
  if (!Number.isInteger(id) || id <= 0) return [];
  try {
    const { rows } = await query(
      `SELECT p.id
         FROM projects p
         JOIN projects d ON d.id = p.stripe_prestado_de
        WHERE d.id = $1 AND ${MISMA_EMPRESA}
        ORDER BY p.id`, [id]);
    return rows.map((r) => Number(r.id));
  } catch (err) {
    // Si no se puede leer, todo al dueño, como antes del préstamo. Un cargo con
    // la marca de otro campus que entre así queda sin asociar (no es del dueño)
    // y, si vuelve a llegar (otro aviso, «Sincronizar»), pasa a su campus
    // (`campusFinalDelCargo`).
    logger.warn({ err: err.message, duenoId }, 'Stripe prestado: no se pudo leer quién usa la cuenta');
    return [];
  }
}

/** El campus de la marca del CRM en una metadata de Stripe, o null. */
export function campusDeLaMarca(metadata) {
  const n = Number(metadata && typeof metadata === 'object' ? metadata.crm_project_id : null);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A qué campus va algo de la cuenta del dueño (sin tocar la base). `prestados`:
 * los ids que la toman prestada. La marca manda; si no hay, el campus del
 * cliente de Stripe (cobro automático); si no, el dueño.
 */
export function elegirCampus(duenoId, prestados, { metadata = null, campusDelCliente = null } = {}) {
  const lista = (prestados || []).map(Number);
  if (!lista.length) return Number(duenoId);
  const marca = campusDeLaMarca(metadata);
  if (marca != null) return lista.includes(marca) ? marca : Number(duenoId);
  if (campusDelCliente != null && lista.includes(Number(campusDelCliente))) return Number(campusDelCliente);
  return Number(duenoId);
}

/** El campus (de la lista) con una venta en cobro automático de ese cliente de Stripe, o null. */
export async function campusDelCliente(customerId, prestados) {
  const cliente = typeof customerId === 'string' ? customerId : customerId?.id || null;
  if (!cliente || !prestados?.length) return null;
  const { rows } = await query(
    `SELECT project_id FROM conversion_cobro_auto
      WHERE stripe_customer_id = $1 AND project_id = ANY($2::int[])
      ORDER BY updated_at DESC LIMIT 1`, [cliente, prestados]);
  return rows[0] ? Number(rows[0].project_id) : null;
}

/** El campus (de la lista) de una cuota programada por su precio de Stripe, o null. */
async function campusDelPrecio(priceIds, prestados) {
  if (!priceIds?.length || !prestados?.length) return null;
  const { rows } = await query(
    `SELECT project_id FROM cobro_auto_cuotas
      WHERE stripe_price_id = ANY($1::text[]) AND project_id = ANY($2::int[])
      ORDER BY updated_at DESC LIMIT 1`, [priceIds, prestados]);
  return rows[0] ? Number(rows[0].project_id) : null;
}

/** El campus (de la lista) que ya tiene ese cargo, o null. */
async function campusDelCargoGuardado(chargeId, prestados) {
  if (!chargeId || !prestados?.length) return null;
  const { rows } = await query(
    `SELECT project_id FROM stripe_payments
      WHERE stripe_id = $1 AND project_id = ANY($2::int[]) LIMIT 1`, [chargeId, prestados]);
  return rows[0] ? Number(rows[0].project_id) : null;
}

const idDe = (v) => (typeof v === 'string' ? v : v?.id || null);

/** Los precios de las líneas de una factura (las versiones de la API los ponen en sitios distintos). */
function preciosDeFactura(inv) {
  return (inv?.lines?.data || [])
    .map((l) => idDe(l.price) || idDe(l.pricing?.price_details?.price) || idDe(l.plan))
    .filter(Boolean);
}

/**
 * EL AVISO DE STRIPE, ¿DE QUÉ CAMPUS ES? Llega por la ruta del dueño
 * (`/api/stripe-webhook/<dueño>`, con su secreto). Devuelve el campus con el
 * que se procesa: el dueño, o uno que le toma prestada la cuenta.
 *
 *   · cargos, PaymentIntents, sesiones de Checkout y links: por la marca (y el
 *     cliente de Stripe, para las cuotas de cobro automático);
 *   · disputas: por el cargo (su marca si viene expandido, o quién lo tiene);
 *   · facturas (cuotas de cobro automático): por el precio de la cuota, la
 *     marca del calendario o el cliente.
 */
export async function campusDelEvento(duenoId, event) {
  const dueno = Number(duenoId);
  const prestados = await quienesLaUsan(dueno);
  if (!prestados.length) return dueno;
  const obj = event?.data?.object || {};
  const tipo = String(event?.type || '');

  if (tipo.startsWith('charge.dispute.')) {
    const cargo = obj.charge;
    if (cargo && typeof cargo === 'object' && campusDeLaMarca(cargo.metadata) != null) {
      return elegirCampus(dueno, prestados, { metadata: cargo.metadata });
    }
    return (await campusDelCargoGuardado(idDe(cargo), prestados)) ?? dueno;
  }
  if (tipo.startsWith('invoice.')) {
    const marcada = [obj.metadata, obj.subscription_details?.metadata, obj.parent?.subscription_details?.metadata]
      .find((m) => campusDeLaMarca(m) != null);
    if (marcada) return elegirCampus(dueno, prestados, { metadata: marcada });
    return (await campusDelPrecio(preciosDeFactura(obj), prestados))
      ?? (await campusDelCliente(obj.customer, prestados))
      ?? dueno;
  }
  if (tipo.startsWith('charge.') || tipo.startsWith('payment_intent.')
    || tipo.startsWith('checkout.session.') || tipo.startsWith('payment_link.')) {
    if (campusDeLaMarca(obj.metadata) != null) return elegirCampus(dueno, prestados, { metadata: obj.metadata });
    if (tipo.startsWith('charge.') || tipo.startsWith('payment_intent.')) {
      return elegirCampus(dueno, prestados, { campusDelCliente: await campusDelCliente(obj.customer, prestados) });
    }
  }
  return dueno;
}

/**
 * NINGÚN CARGO EN DOS CAMPUS. Antes de guardar en `campus` (uno que toma
 * prestada la cuenta) un cargo de la cuenta del dueño: si el dueño ya lo tenía
 * (entró antes de declarar el préstamo) y nadie lo ha asociado, se pasa al
 * campus; si ya está asociado a algo del dueño, se queda allí y se sigue con el
 * dueño. Devuelve el campus donde va el cargo.
 */
export async function campusFinalDelCargo(duenoId, campus, chargeId) {
  const dueno = Number(duenoId);
  if (Number(campus) === dueno || !chargeId) return Number(campus);
  const { rows } = await query(
    `SELECT id, lead_id, conversion_id, conversion_payment_id, payment_link_id, stripe_link_externo_id
       FROM stripe_payments WHERE project_id = $1 AND stripe_id = $2`, [dueno, chargeId]);
  const enElDueno = rows[0];
  if (!enElDueno) return Number(campus);
  if (enElDueno.lead_id || enElDueno.conversion_id || enElDueno.conversion_payment_id
    || enElDueno.payment_link_id || enElDueno.stripe_link_externo_id) return dueno;
  const { rowCount } = await query(
    `UPDATE stripe_payments SET project_id = $3, updated_at = NOW()
      WHERE id = $1 AND project_id = $2
        AND NOT EXISTS (SELECT 1 FROM stripe_payments o WHERE o.project_id = $3 AND o.stripe_id = $4)`,
    [enElDueno.id, dueno, Number(campus), chargeId]);
  if (!rowCount) {
    // Ya estaba también en el campus (no debería): se borra la copia sin asociar del dueño.
    await query(`DELETE FROM stripe_payments
        WHERE id = $1 AND lead_id IS NULL AND conversion_id IS NULL AND conversion_payment_id IS NULL
          AND payment_link_id IS NULL AND stripe_link_externo_id IS NULL`, [enElDueno.id]);
  }
  return Number(campus);
}
