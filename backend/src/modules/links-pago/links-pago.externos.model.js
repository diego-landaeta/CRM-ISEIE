import { query } from '../../shared/config/db.js';
import { COBRADO_DE } from '../conversions/cobrado.js';

/*
  LOS LINKS CREADOS DIRECTAMENTE EN STRIPE (CRM-ISEIE#688, gemela de CRM#1019; migración 328).

  Las consultas de `links-pago.externos.js`. El recorte por campus llega ya
  hecho (`projectIds`): este fichero no mira la sesión.
*/

/** ¿Ese Payment Link lo creó el CRM? (está en `payment_links`). */
export async function esLinkDelCrm(stripePaymentLinkId) {
  const { rows } = await query(
    'SELECT 1 FROM payment_links WHERE stripe_payment_link_id = $1 LIMIT 1', [stripePaymentLinkId]);
  return rows.length > 0;
}

export async function porStripeId(projectId, stripePaymentLinkId) {
  const { rows } = await query(
    'SELECT * FROM stripe_links_externos WHERE project_id = $1 AND stripe_payment_link_id = $2',
    [projectId, stripePaymentLinkId]);
  return rows[0] || null;
}

/**
 * Guarda (o pone al día) un link de Stripe del campus. Con `soloSiNoEsta`, si
 * ya estaba no se toca: lo usa el aviso del cobro, que sabe menos que el listado.
 */
export async function guardar(projectId, l, { soloSiNoEsta = false } = {}) {
  const { rows } = await query(
    `INSERT INTO stripe_links_externos
       (project_id, stripe_payment_link_id, url, activo, nombre, importe, moneda, codigos_promocionales, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (project_id, stripe_payment_link_id) DO UPDATE SET
       ${soloSiNoEsta ? 'actualizado_el = stripe_links_externos.actualizado_el' : `
       url = COALESCE(EXCLUDED.url, stripe_links_externos.url),
       activo = EXCLUDED.activo,
       nombre = COALESCE(EXCLUDED.nombre, stripe_links_externos.nombre),
       importe = EXCLUDED.importe,
       moneda = COALESCE(EXCLUDED.moneda, stripe_links_externos.moneda),
       codigos_promocionales = EXCLUDED.codigos_promocionales,
       metadata = EXCLUDED.metadata,
       actualizado_el = NOW()`}
     RETURNING *, (xmax = 0) AS nuevo`,
    [projectId, l.stripe_payment_link_id, l.url ?? null, l.activo !== false, l.nombre ?? null,
      l.importe ?? null, l.moneda ?? null, !!l.codigos_promocionales, JSON.stringify(l.metadata || {})]);
  return rows[0];
}

/** Los campus con la clave de links puesta: los que se recogen cada vuelta. */
export async function campusConClaveDeLinks() {
  const { rows } = await query(
    `SELECT DISTINCT project_id FROM project_integrations
      WHERE provider = 'stripe_links' AND active = true AND encrypted_value IS NOT NULL
      ORDER BY project_id`);
  return rows.map((r) => Number(r.project_id));
}

/** Los links de Stripe de esos campus, con lo cobrado con cada uno y lo que queda por vincular. */
export async function listar({ projectIds, soloActivos = false }) {
  const { rows } = await query(
    `SELECT e.id, e.project_id, p.nombre AS project_nombre, e.stripe_payment_link_id, e.url, e.activo,
            e.nombre, e.importe, e.moneda, e.codigos_promocionales, e.visto_el, e.actualizado_el,
            COALESCE(c.cobros, 0)::int AS cobros, COALESCE(c.cobrado, 0)::float8 AS cobrado,
            COALESCE(c.por_vincular, 0)::int AS por_vincular
       FROM stripe_links_externos e
       JOIN projects p ON p.id = e.project_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE sp.status = 'succeeded') AS cobros,
                SUM(sp.amount) FILTER (WHERE sp.status = 'succeeded') AS cobrado,
                COUNT(*) FILTER (WHERE sp.status = 'succeeded' AND sp.conversion_payment_id IS NULL) AS por_vincular
           FROM stripe_payments sp WHERE sp.stripe_link_externo_id = e.id
       ) c ON true
      WHERE e.project_id = ANY($1::int[])
        AND ($2::boolean IS FALSE OR e.activo)
      ORDER BY e.activo DESC, e.actualizado_el DESC, e.id DESC
      LIMIT 500`,
    [projectIds, soloActivos]);
  return rows;
}

/** Del cargo a su link de Stripe, con lo que dijo la sesión de Checkout. */
export async function atarCargo(stripePaymentId, externoId, checkout) {
  await query(
    `UPDATE stripe_payments
        SET stripe_link_externo_id = $2,
            checkout_externo = COALESCE(checkout_externo, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [stripePaymentId, externoId, JSON.stringify(checkout || {})]);
}

/** A la bandeja «por vincular», con el motivo y las ventas que podrían ser. */
export async function aLaBandeja(stripePaymentId, motivo, candidatos) {
  await query(
    `UPDATE stripe_payments SET por_vincular_motivo = $2, por_vincular_candidatos = $3::jsonb, updated_at = NOW()
      WHERE id = $1 AND conversion_payment_id IS NULL`,
    [stripePaymentId, motivo, JSON.stringify(candidatos || [])]);
}

/** Fuera de la bandeja: ya tiene su cobro en una venta. */
export async function fueraDeLaBandeja(stripePaymentId) {
  await query(
    `UPDATE stripe_payments SET por_vincular_motivo = NULL, por_vincular_candidatos = NULL
      WHERE id = $1 AND (por_vincular_motivo IS NOT NULL OR por_vincular_candidatos IS NOT NULL)`,
    [stripePaymentId]);
}

/**
 * ¿Esa sesión de Checkout ya se trató? Su cargo está atado al link de Stripe y,
 * o tiene su cobro, o está en la bandeja. Así la vuelta no vuelve a pedir el
 * cargo a Stripe cada 30 minutos.
 */
export async function sesionYaTratada(projectId, sessionId) {
  const { rows } = await query(
    `SELECT 1 FROM stripe_payments
      WHERE project_id = $1 AND checkout_externo->>'session_id' = $2
        AND (conversion_payment_id IS NOT NULL OR por_vincular_motivo IS NOT NULL)
      LIMIT 1`,
    [projectId, sessionId]);
  return rows.length > 0;
}

/** Las fichas vivas del campus con ese correo. */
export async function fichasPorCorreo(projectId, email) {
  const { rows } = await query(
    `SELECT id, nombre, responsable_id FROM leads
      WHERE project_id = $1 AND LOWER(email) = LOWER($2) AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 20`,
    [projectId, email]);
  return rows;
}

/** Los dígitos de la columna, en SQL (como en los webhooks de admisión). */
const DIGITOS_SQL = (col) => `regexp_replace(COALESCE(${col}, ''), '[^0-9]', '', 'g')`;

/** Las fichas vivas del campus cuyo teléfono acaba en esos dígitos (los 9 últimos). */
export async function fichasPorMovil(projectId, movil) {
  const { rows } = await query(
    `SELECT l.id, l.nombre, l.responsable_id FROM leads l
      WHERE l.project_id = $1 AND l.deleted_at IS NULL
        AND length(${DIGITOS_SQL('l.telefono')}) >= 7
        AND right(${DIGITOS_SQL('l.telefono')}, $3) = $2
      ORDER BY l.id DESC LIMIT 20`,
    [projectId, movil, movil.length]);
  return rows;
}

/** Las ventas del campus de esas fichas, con lo pendiente, la más reciente primero. */
export async function ventasDeFichas(projectId, leadIds) {
  if (!leadIds.length) return [];
  const { rows } = await query(
    `SELECT c.id AS conversion_id, c.lead_id, l.nombre AS lead_nombre, l.responsable_id,
            COALESCE(pr.nombre, c.producto_contratado) AS producto,
            c.importe_total::float8 AS importe_total,
            GREATEST(c.importe_total - ${COBRADO_DE('c')}, 0)::float8 AS pendiente
       FROM conversions c
       JOIN leads l ON l.id = c.lead_id
       LEFT JOIN products pr ON pr.id = c.producto_contratado_id
      WHERE c.project_id = $1 AND c.lead_id = ANY($2::int[])
      ORDER BY c.fecha_conversion DESC NULLS LAST, c.id DESC
      LIMIT 20`,
    [projectId, leadIds]);
  return rows;
}

/** La bandeja: cobrados (y no devueltos) de un link de Stripe sin cobro en una venta, de esos campus. */
export async function porVincular({ projectIds }) {
  const { rows } = await query(
    `SELECT sp.id, sp.project_id, p.nombre AS project_nombre, sp.stripe_id,
            sp.amount::float8 AS importe, sp.currency AS moneda, sp.stripe_created_at AS cobrado_el,
            sp.customer_email AS email, sp.customer_name AS nombre,
            sp.checkout_externo->>'telefono' AS telefono,
            sp.checkout_externo->'descuento' AS descuento, sp.checkout_externo->>'codigo' AS codigo,
            sp.por_vincular_motivo AS motivo, COALESCE(sp.por_vincular_candidatos, '[]'::jsonb) AS candidatos,
            sp.lead_id, e.id AS link_id, e.nombre AS link_nombre, e.url AS link_url
       FROM stripe_payments sp
       JOIN projects p ON p.id = sp.project_id
       JOIN stripe_links_externos e ON e.id = sp.stripe_link_externo_id
      WHERE sp.project_id = ANY($1::int[])
        AND sp.status = 'succeeded'
        AND COALESCE(sp.refunded, false) = false
        AND sp.conversion_payment_id IS NULL
      ORDER BY sp.stripe_created_at DESC, sp.id DESC
      LIMIT 200`,
    [projectIds]);
  return rows;
}

/** Un cargo de la bandeja (o ya vinculado), para vincularlo a mano. */
export async function cargo(id) {
  const { rows } = await query(
    `SELECT id, project_id, stripe_id, status, amount, customer_email, customer_name,
            conversion_id, conversion_payment_id, link_method, linked_at, stripe_link_externo_id
       FROM stripe_payments WHERE id = $1`,
    [id]);
  return rows[0] || null;
}

/** La venta, con su campus y su ficha. */
export async function venta(conversionId) {
  const { rows } = await query(
    'SELECT id, project_id, lead_id FROM conversions WHERE id = $1', [conversionId]);
  return rows[0] || null;
}

/**
 * Buscar una venta del campus para vincular un cobro: por el nombre, el correo
 * o el teléfono del prospecto, o por el número de la venta. Hasta 20.
 */
export async function buscarVentas(projectId, texto) {
  const t = String(texto || '').trim();
  const numero = /^\d{1,9}$/.test(t) ? Number(t) : null;
  const digitos = t.replace(/\D/g, '');
  const { rows } = await query(
    `SELECT c.id AS conversion_id, c.lead_id, l.nombre AS lead_nombre, l.email,
            COALESCE(pr.nombre, c.producto_contratado) AS producto,
            c.importe_total::float8 AS importe_total,
            GREATEST(c.importe_total - ${COBRADO_DE('c')}, 0)::float8 AS pendiente
       FROM conversions c
       JOIN leads l ON l.id = c.lead_id
       LEFT JOIN products pr ON pr.id = c.producto_contratado_id
      WHERE c.project_id = $1
        AND (c.id = $2::int
             OR l.nombre ILIKE '%' || $3 || '%'
             OR l.email ILIKE '%' || $3 || '%'
             OR (length($4) >= 6 AND ${DIGITOS_SQL('l.telefono')} LIKE '%' || $4 || '%'))
      ORDER BY c.fecha_conversion DESC NULLS LAST, c.id DESC
      LIMIT 20`,
    [projectId, numero, t.replace(/[%_\\]/g, (m) => `\\${m}`), digitos]);
  return rows;
}
