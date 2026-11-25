import { query } from '../../shared/config/db.js';

/*
  COBRO CANCELADO EN STRIPE (CRM#1103, migración 343) · lo que toca la base.

  Todo lo que marca va dentro de la transacción de quien llama (`db`): la fila de
  `stripe_cobros_cancelados` es la llave. Si ya existe (Stripe reenvía el aviso,
  o llegan dos avisos de la misma cancelación), no se marca nada otra vez y no
  se avisa dos veces.
*/

const nota = (que, datos = {}) => JSON.stringify([{ el: new Date().toISOString(), que, ...datos }]);

/**
 * La llave: una fila por venta y cosa de Stripe. Devuelve su id, o null si ya
 * estaba (aviso repetido).
 */
export async function registrar(db, r) {
  const { rows } = await db.query(
    `INSERT INTO stripe_cobros_cancelados
        (project_id, conversion_id, origen, referencia, evento_tipo, stripe_event_id, motivo, detalle, cancelado_el)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     ON CONFLICT (conversion_id, referencia) DO NOTHING
     RETURNING id`,
    [r.projectId, r.conversionId, r.origen, r.referencia, r.eventoTipo, r.eventId || null,
      String(r.motivo).slice(0, 1000), JSON.stringify(r.detalle || {}), r.cuando]);
  return rows[0]?.id ?? null;
}

export async function apuntarCuotas(db, id, cuotas) {
  await db.query('UPDATE stripe_cobros_cancelados SET cuotas = $2::int[] WHERE id = $1', [id, cuotas]);
}

/** La marca en las cuotas: siguen pendientes, ya sin cobro automático. */
export async function marcarCuotas(db, installmentIds, { cuando, motivo }) {
  if (!installmentIds.length) return [];
  const { rows } = await db.query(
    `UPDATE conversion_installments
        SET cobro_auto_cancelado_el = $2, cobro_auto_cancelado_motivo = $3
      WHERE id = ANY($1::int[]) AND fecha_cobro IS NULL
      RETURNING id`,
    [installmentIds, cuando, String(motivo).slice(0, 1000)]);
  return rows.map((r) => Number(r.id));
}

// ─── El cobro automático del CRM (309) ──────────────────────────────────────

/** La venta con cobro automático de este calendario, en los campus de la cuenta. */
export async function ventaDelCalendario(scheduleId, projectIds) {
  if (!scheduleId) return null;
  const { rows } = await query(
    `SELECT * FROM conversion_cobro_auto WHERE stripe_schedule_id = $1 AND project_id = ANY($2::int[])`,
    [scheduleId, projectIds]);
  return rows[0] || null;
}

export async function ventaConCobroAuto(conversionId, projectIds) {
  const { rows } = await query(
    `SELECT * FROM conversion_cobro_auto WHERE conversion_id = $1 AND project_id = ANY($2::int[])`,
    [conversionId, projectIds]);
  return rows[0] || null;
}

/** Las cuotas que Stripe tenía programadas y siguen sin cobrar, bloqueadas. */
export async function programadasSinCobrar(db, conversionId) {
  const { rows } = await db.query(
    `SELECT cac.installment_id
       FROM cobro_auto_cuotas cac
       JOIN conversion_installments ci ON ci.id = cac.installment_id
      WHERE cac.conversion_id = $1 AND cac.estado = 'programada' AND ci.fecha_cobro IS NULL
      ORDER BY ci.fecha_vencimiento, ci.numero
      FOR UPDATE OF cac`, [conversionId]);
  return rows.map((r) => Number(r.installment_id));
}

/** Programadas (o fallidas) que Stripe ya no cobrará: no se reintentan ni se enseña su factura. */
export async function cuotasCanceladas(db, installmentIds, que, datos = {}) {
  if (!installmentIds.length) return;
  await db.query(
    `UPDATE cobro_auto_cuotas
        SET estado = 'cancelada', url_pago = NULL, reintento_el = NULL,
            stripe_invoice_id = COALESCE(stripe_invoice_id, $3),
            historial = historial || $2::jsonb, updated_at = NOW()
      WHERE installment_id = ANY($1::int[])`,
    [installmentIds, nota(que, datos), datos.factura || null]);
}

/**
 * Se quita el cobro automático de la venta, sin persona del CRM. El calendario
 * se deja apuntado: la siguiente pasada (`sincronizar`) lo cancela en Stripe si
 * sigue vivo (una suscripción «impagada» puede volver a cobrar) y lo borra.
 */
export async function quitarPorStripe(db, conversionId, { cuando, motivo }) {
  await db.query(
    `UPDATE conversion_cobro_auto
        SET activo = FALSE, desactivado_por = NULL, desactivado_el = NOW(),
            cancelado_en_stripe_el = $2, cancelado_en_stripe_motivo = $3,
            fases_firma = NULL, updated_at = NOW()
      WHERE conversion_id = $1`,
    [conversionId, cuando, String(motivo).slice(0, 1000)]);
}

/** La cuota de una factura de Stripe, bloqueada, con si ya está cobrada en la venta. */
export async function cuotaParaCancelar(db, installmentId) {
  const { rows } = await db.query(
    `SELECT cac.*, ci.fecha_cobro
       FROM cobro_auto_cuotas cac
       JOIN conversion_installments ci ON ci.id = cac.installment_id
      WHERE cac.installment_id = $1
      FOR UPDATE OF cac`, [installmentId]);
  return rows[0] || null;
}

// ─── Las ventas a plazos con suscripción (#747) ─────────────────────────────

/** La venta de una suscripción de Stripe en los campus de la cuenta, bloqueada, con lo cobrado. */
export async function ventaDeLaSuscripcion(db, subscriptionId, projectIds) {
  if (!subscriptionId) return null;
  const { rows } = await db.query(
    `SELECT c.id, c.project_id, c.importe_total::float8 AS importe_total, c.stripe_subscription_id,
            c.suscripcion_estado, c.suscripcion_cerrada_at,
            (COALESCE((SELECT SUM(cp.importe) FROM conversion_payments cp WHERE cp.conversion_id = c.id), 0)
              - COALESCE((SELECT SUM(r.importe) FROM conversion_refunds r WHERE r.conversion_id = c.id), 0))::float8 AS cobrado
       FROM conversions c
      WHERE c.stripe_subscription_id = $1 AND c.project_id = ANY($2::int[])
      ORDER BY c.id
      LIMIT 1
      FOR UPDATE OF c`, [subscriptionId, projectIds]);
  return rows[0] || null;
}

/** Las cuotas sin cobrar de la venta (todas, o solo la primera sin marcar). */
export async function cuotasSinCobrar(db, conversionId, { soloLaPrimera = false } = {}) {
  const { rows } = await db.query(
    `SELECT id FROM conversion_installments
      WHERE conversion_id = $1 AND fecha_cobro IS NULL
        ${soloLaPrimera ? 'AND cobro_auto_cancelado_el IS NULL' : ''}
      ORDER BY fecha_vencimiento, numero
      ${soloLaPrimera ? 'LIMIT 1' : ''}`, [conversionId]);
  return rows.map((r) => Number(r.id));
}

export async function suscripcionCancelada(db, conversionId, { estado, cerradaEl }) {
  await db.query(
    `UPDATE conversions
        SET suscripcion_estado = $2, suscripcion_cerrada_at = COALESCE($3, suscripcion_cerrada_at),
            suscripcion_error = NULL, suscripcion_revisada_at = NOW()
      WHERE id = $1`, [conversionId, estado, cerradaEl ?? null]);
}

/**
 * La suscripción «impagada» vuelve a cobrarse sola: fuera las marcas (para que
 * nadie mande un link de una cuota que Stripe va a cobrar) y la venta, activa.
 * Devuelve las cancelaciones reactivadas.
 */
export async function reactivarSuscripcion(db, conversionId, subscriptionId) {
  const { rows } = await db.query(
    // La llave se libera (referencia + «:reactivada:id») para que, si vuelve a
    // quedarse impagada, se apunte y se avise otra vez. La fila se queda: historial.
    `UPDATE stripe_cobros_cancelados
        SET reactivada_el = NOW(), referencia = LEFT(referencia || ':reactivada:' || id, 255)
      WHERE conversion_id = $1 AND origen = 'suscripcion' AND reactivada_el IS NULL
      RETURNING id, cuotas`, [conversionId]);
  const cuotas = [...new Set(rows.flatMap((r) => r.cuotas || []))];
  if (cuotas.length) {
    await db.query(
      `UPDATE conversion_installments SET cobro_auto_cancelado_el = NULL, cobro_auto_cancelado_motivo = NULL
        WHERE id = ANY($1::int[]) AND fecha_cobro IS NULL`, [cuotas]);
  }
  await db.query(
    `UPDATE conversions SET suscripcion_estado = 'activa', suscripcion_revisada_at = NOW()
      WHERE id = $1 AND stripe_subscription_id = $2 AND suscripcion_estado = 'cancelada_en_stripe'
        AND suscripcion_cerrada_at IS NULL`, [conversionId, subscriptionId]);
  return rows;
}

// ─── Los avisos ─────────────────────────────────────────────────────────────

/** Reserva el aviso (una vez). true si le toca avisar a quien llama. */
export async function reservarAviso(id) {
  const { rows } = await query(
    'UPDATE stripe_cobros_cancelados SET avisado_el = NOW() WHERE id = $1 AND avisado_el IS NULL RETURNING id', [id]);
  return rows.length > 0;
}

export async function soltarAviso(id) {
  await query('UPDATE stripe_cobros_cancelados SET avisado_el = NULL WHERE id = $1', [id]);
}

/** Lo que hace falta para el aviso: la venta, su alumno, su gestora y si está de baja. */
export async function ventaParaAvisar(conversionId) {
  const { rows } = await query(
    `SELECT c.id, c.project_id, c.lead_id, c.vendedora_id, c.baja_fecha,
            l.nombre AS lead_nombre, l.responsable_id, p.nombre AS campus
       FROM conversions c
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.id = $1`, [conversionId]);
  return rows[0] || null;
}

/** Admins del campus y super admins (los mismos que reciben las disputas). */
export async function adminsDelCampus(projectId) {
  const { rows } = await query(
    `SELECT DISTINCT u.id FROM users u
      WHERE u.active AND (u.role = 'superadmin'
         OR (u.role = 'admin' AND EXISTS (
               SELECT 1 FROM user_projects up
                WHERE up.user_id = u.id AND up.project_id = $1 AND up.active)))
      ORDER BY u.id`, [projectId]);
  return rows.map((r) => Number(r.id));
}

/** Las cancelaciones de una venta (la ficha las enseña). */
export async function deLaVenta(conversionId) {
  const { rows } = await query(
    `SELECT id, origen, referencia, evento_tipo, motivo, cancelado_el, cuotas, avisado_el, reactivada_el, created_at
       FROM stripe_cobros_cancelados WHERE conversion_id = $1 ORDER BY created_at DESC`, [conversionId]);
  return rows;
}
