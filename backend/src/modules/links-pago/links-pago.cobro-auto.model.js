import { query } from '../../shared/config/db.js';
import { COBRADO_DE } from '../conversions/cobrado.js';

/*
  COBRO AUTOMÁTICO DE LAS CUOTAS (#680; Diego, 19/11/2026) · lo que toca la base.

  Migración 309: `conversion_cobro_auto` (una fila por venta: si está activo, la
  tarjeta guardada y el calendario de Stripe) y `cobro_auto_cuotas` (cada cuota
  programada en Stripe y lo que le ha pasado). Aquí no se llama a Stripe.
*/

/** La configuración del cobro automático de una venta, o null si nunca se tocó. */
export async function deLaVenta(conversionId) {
  const { rows } = await query('SELECT * FROM conversion_cobro_auto WHERE conversion_id = $1', [conversionId]);
  return rows[0] || null;
}

/** La venta con cobro automático de un cliente de Stripe en este campus (el que guardó la tarjeta). */
export async function deCliente(projectId, customerId) {
  if (!customerId) return null;
  const { rows } = await query(
    `SELECT * FROM conversion_cobro_auto
      WHERE project_id = $1 AND stripe_customer_id = $2
      ORDER BY updated_at DESC`, [projectId, customerId]);
  return rows;
}

/** Las reglas del campus: si lo permite y a los cuántos días se reintenta. */
export async function delCampus(projectId) {
  const { rows } = await query(
    `SELECT links_pago_cobro_auto AS permitido, links_pago_cobro_auto_reintento_dias AS reintento_dias
       FROM projects WHERE id = $1`, [projectId]);
  if (!rows[0]) return null;
  return { permitido: rows[0].permitido === true, reintento_dias: Number(rows[0].reintento_dias) };
}

/** Activar o desactivar. Activar otra vez no borra la tarjeta ni el calendario. */
export async function poner(conversionId, { projectId, activo, userId }) {
  await query(
    `INSERT INTO conversion_cobro_auto (conversion_id, project_id, activo,
        activado_por, activado_el, desactivado_por, desactivado_el)
     VALUES ($1, $2, $3,
        CASE WHEN $3 THEN $4::int END, CASE WHEN $3 THEN NOW() END,
        CASE WHEN $3 THEN NULL ELSE $4::int END, CASE WHEN $3 THEN NULL ELSE NOW() END)
     ON CONFLICT (conversion_id) DO UPDATE SET
        activo = EXCLUDED.activo,
        activado_por = CASE WHEN EXCLUDED.activo AND NOT conversion_cobro_auto.activo THEN EXCLUDED.activado_por ELSE conversion_cobro_auto.activado_por END,
        activado_el = CASE WHEN EXCLUDED.activo AND NOT conversion_cobro_auto.activo THEN NOW() ELSE conversion_cobro_auto.activado_el END,
        desactivado_por = CASE WHEN EXCLUDED.activo THEN conversion_cobro_auto.desactivado_por ELSE EXCLUDED.desactivado_por END,
        desactivado_el = CASE WHEN EXCLUDED.activo THEN conversion_cobro_auto.desactivado_el ELSE NOW() END,
        -- Al cambiar de estado se vuelve a pasar todo a Stripe.
        fases_firma = CASE WHEN EXCLUDED.activo = conversion_cobro_auto.activo THEN conversion_cobro_auto.fases_firma END,
        updated_at = NOW()`,
    [conversionId, projectId, activo, userId ?? null]);
}

/** La tarjeta con la que el alumno pagó un link que la guardaba. true si es nueva. */
export async function guardarTarjeta(conversionId, { projectId, customerId, paymentMethodId, tarjeta, linkId }) {
  const { rows } = await query(
    `INSERT INTO conversion_cobro_auto (conversion_id, project_id, stripe_customer_id, stripe_payment_method_id,
        tarjeta_marca, tarjeta_ultimos4, tarjeta_caduca_mes, tarjeta_caduca_anio, tarjeta_guardada_el, tarjeta_link_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
     ON CONFLICT (conversion_id) DO UPDATE SET
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_payment_method_id = EXCLUDED.stripe_payment_method_id,
        tarjeta_marca = EXCLUDED.tarjeta_marca, tarjeta_ultimos4 = EXCLUDED.tarjeta_ultimos4,
        tarjeta_caduca_mes = EXCLUDED.tarjeta_caduca_mes, tarjeta_caduca_anio = EXCLUDED.tarjeta_caduca_anio,
        tarjeta_guardada_el = NOW(), tarjeta_link_id = EXCLUDED.tarjeta_link_id,
        fases_firma = NULL, updated_at = NOW()
      WHERE conversion_cobro_auto.stripe_payment_method_id IS DISTINCT FROM EXCLUDED.stripe_payment_method_id
     RETURNING conversion_id`,
    [conversionId, projectId, customerId, paymentMethodId, tarjeta?.marca || null,
      /^\d{4}$/.test(String(tarjeta?.ultimos4 || '')) ? String(tarjeta.ultimos4) : null,
      tarjeta?.mes || null, tarjeta?.anio || null, linkId]);
  return rows.length > 0;
}

/** Cómo quedó la última vez que se pasó el plan a Stripe. */
export async function anotarSincronizacion(conversionId, { scheduleId, firma, error }) {
  await query(
    `UPDATE conversion_cobro_auto
        SET stripe_schedule_id = CASE WHEN $2::text = '' THEN NULL ELSE COALESCE($2, stripe_schedule_id) END,
            fases_firma = CASE WHEN $4::text IS NULL THEN $3 ELSE fases_firma END,
            sync_error = $4, sincronizado_el = NOW(), updated_at = NOW()
      WHERE conversion_id = $1`,
    [conversionId, scheduleId ?? null, firma ?? null, error ?? null]);
}

/** Las cuotas pendientes de la venta, por fecha y número, y lo que le queda por cobrar. */
export async function planDeLaVenta(conversionId) {
  const [{ rows: cuotas }, { rows: [v] }] = await Promise.all([
    query(
      `SELECT id, numero, importe_previsto::float8 AS importe, fecha_vencimiento::text AS vence,
              cobro_auto_cancelado_el AS cancelado_el, cobro_auto_cancelado_motivo AS cancelado_motivo
         FROM conversion_installments
        WHERE conversion_id = $1 AND fecha_cobro IS NULL
        ORDER BY fecha_vencimiento, numero`, [conversionId]),
    query(`SELECT GREATEST(c.importe_total - ${COBRADO_DE('c')}, 0)::float8 AS pendiente FROM conversions c WHERE c.id = $1`,
      [conversionId]),
  ]);
  return { cuotas, pendiente: Number(v?.pendiente || 0) };
}

/** Lo que el CRM sabe de cada cuota en Stripe. */
export async function cuotasEnStripe(conversionId) {
  const { rows } = await query(
    `SELECT installment_id, estado, stripe_price_id, fecha_programada::text AS fecha_programada,
            importe_programado::float8 AS importe_programado, stripe_invoice_id, url_pago, intentos,
            error_codigo, error_mensaje, reintento_el::text AS reintento_el, reintentado_el, avisado_el, historial, updated_at
       FROM cobro_auto_cuotas WHERE conversion_id = $1`, [conversionId]);
  return rows;
}

const nota = (que, datos = {}) => JSON.stringify([{ el: new Date().toISOString(), que, ...datos }]);

/** La cuota, programada en Stripe con este precio, fecha e importe. */
export async function programar(c) {
  // Si Stripe la había dejado de cobrar (CRM#1103) y se vuelve a programar, fuera la marca.
  await query(
    `UPDATE conversion_installments SET cobro_auto_cancelado_el = NULL, cobro_auto_cancelado_motivo = NULL
      WHERE id = $1 AND cobro_auto_cancelado_el IS NOT NULL`, [c.installmentId]);
  await query(
    `INSERT INTO cobro_auto_cuotas (installment_id, conversion_id, project_id, estado, stripe_price_id,
        fecha_programada, importe_programado, historial)
     VALUES ($1, $2, $3, 'programada', $4, $5::date, $6, $7::jsonb)
     ON CONFLICT (installment_id) DO UPDATE SET
        estado = CASE WHEN cobro_auto_cuotas.estado IN ('cobrada', 'fallida') THEN cobro_auto_cuotas.estado ELSE 'programada' END,
        stripe_price_id = EXCLUDED.stripe_price_id, fecha_programada = EXCLUDED.fecha_programada,
        importe_programado = EXCLUDED.importe_programado,
        historial = CASE WHEN cobro_auto_cuotas.fecha_programada IS DISTINCT FROM EXCLUDED.fecha_programada
                           OR cobro_auto_cuotas.importe_programado IS DISTINCT FROM EXCLUDED.importe_programado
                           OR cobro_auto_cuotas.estado = 'quitada'
                         THEN cobro_auto_cuotas.historial || EXCLUDED.historial ELSE cobro_auto_cuotas.historial END,
        updated_at = NOW()`,
    [c.installmentId, c.conversionId, c.projectId, c.priceId, c.fecha, c.importe,
      nota('programada', { fecha: c.fecha, importe: c.importe })]);
}

/** Las que ya no están en Stripe (pagadas por otro lado, borradas, desactivado). */
export async function quitarLasDemas(conversionId, quedan) {
  await query(
    `UPDATE cobro_auto_cuotas
        SET estado = 'quitada', historial = historial || $3::jsonb, updated_at = NOW()
      WHERE conversion_id = $1 AND estado = 'programada' AND NOT (installment_id = ANY($2::int[]))`,
    [conversionId, quedan, nota('quitada de Stripe')]);
}

/** La cuota de un precio de Stripe (la línea de la factura), o null. */
export async function cuotaDelPrecio(projectId, priceIds) {
  if (!priceIds?.length) return null;
  const { rows } = await query(
    `SELECT cac.*, ci.conversion_id AS venta, ci.fecha_cobro
       FROM cobro_auto_cuotas cac
       JOIN conversion_installments ci ON ci.id = cac.installment_id
      WHERE cac.project_id = $1 AND cac.stripe_price_id = ANY($2::text[])
      ORDER BY cac.updated_at DESC LIMIT 1`, [projectId, priceIds]);
  return rows[0] || null;
}

export async function cuotaPorId(installmentId) {
  const { rows } = await query('SELECT * FROM cobro_auto_cuotas WHERE installment_id = $1', [installmentId]);
  return rows[0] || null;
}

/** Stripe la ha cobrado. */
export async function marcarCobrada(installmentId, { invoiceId }) {
  await query(
    `UPDATE cobro_auto_cuotas
        SET estado = 'cobrada', stripe_invoice_id = COALESCE($2, stripe_invoice_id), reintento_el = NULL,
            historial = historial || $3::jsonb, updated_at = NOW()
      WHERE installment_id = $1 AND estado <> 'cobrada'`,
    [installmentId, invoiceId ?? null, nota('cobrada', { factura: invoiceId ?? null })]);
}

/**
 * El cobro falló. Cuenta el intento y, si es el primero y se puede, apunta el
 * único reintento. Devuelve la fila como queda y si es la primera vez que se
 * apunta este intento (para avisar una sola vez por intento).
 */
export async function marcarFallida(installmentId, { invoiceId, url, codigo, mensaje, reintentoEl, intentoDeStripe }) {
  const { rows } = await query(
    `UPDATE cobro_auto_cuotas
        SET estado = 'fallida', stripe_invoice_id = COALESCE($2, stripe_invoice_id), url_pago = COALESCE($3, url_pago),
            intentos = intentos + 1, error_codigo = $4, error_mensaje = $5,
            reintento_el = CASE WHEN intentos = 0 THEN $6::date ELSE NULL END,
            historial = historial || $7::jsonb, updated_at = NOW()
      WHERE installment_id = $1
        AND (stripe_invoice_id IS DISTINCT FROM $2 OR intentos < $8)
      RETURNING *`,
    [installmentId, invoiceId ?? null, url ?? null, codigo ?? null, mensaje ? String(mensaje).slice(0, 1000) : null,
      reintentoEl ?? null, nota('fallida', { codigo, factura: invoiceId ?? null }), intentoDeStripe ?? 1]);
  return rows[0] || null;
}

export async function marcarAvisado(installmentId) {
  await query('UPDATE cobro_auto_cuotas SET avisado_el = NOW(), updated_at = NOW() WHERE installment_id = $1', [installmentId]);
}

/** Las que toca reintentar hoy (una vez cada una: se marcan antes de llamar a Stripe). */
export async function porReintentar(hoy, lote = 25) {
  const { rows } = await query(
    `UPDATE cobro_auto_cuotas
        SET reintentado_el = NOW(), historial = historial || $3::jsonb, updated_at = NOW()
      WHERE installment_id IN (
        SELECT cac.installment_id
          FROM cobro_auto_cuotas cac
          JOIN conversion_installments ci ON ci.id = cac.installment_id AND ci.fecha_cobro IS NULL
          JOIN conversion_cobro_auto ca ON ca.conversion_id = cac.conversion_id AND ca.activo
         WHERE cac.estado = 'fallida' AND cac.reintento_el IS NOT NULL AND cac.reintento_el <= $1::date
           AND cac.reintentado_el IS NULL AND cac.stripe_invoice_id IS NOT NULL
         ORDER BY cac.reintento_el LIMIT $2)
        AND reintentado_el IS NULL
      RETURNING *`,
    [hoy, lote, nota('reintento pedido a Stripe')]);
  return rows;
}

/** Fallidas que el alumno ya pagó por otro lado (su link): hay que anular su factura en Stripe. */
export async function fallidasYaPagadas(conversionId) {
  const { rows } = await query(
    `SELECT cac.* FROM cobro_auto_cuotas cac
       JOIN conversion_installments ci ON ci.id = cac.installment_id
      WHERE cac.conversion_id = $1 AND cac.estado = 'fallida' AND ci.fecha_cobro IS NOT NULL
        AND cac.stripe_invoice_id IS NOT NULL`, [conversionId]);
  return rows;
}

export async function anotar(installmentId, que, datos = {}, estado = null) {
  await query(
    `UPDATE cobro_auto_cuotas SET historial = historial || $2::jsonb, estado = COALESCE($3, estado), updated_at = NOW()
      WHERE installment_id = $1`, [installmentId, nota(que, datos), estado]);
}

/** Lo que hace falta para avisar: la venta, su ficha, su curso y su campus. */
export async function ventaParaCobrar(conversionId) {
  const { rows } = await query(
    `SELECT c.id, c.project_id, c.lead_id, c.vendedora_id, c.producto_contratado_id,
            pr.nombre AS producto_nombre, l.nombre AS lead_nombre, l.email AS lead_email, l.responsable_id,
            p.nombre AS campus, p.slug, p.logo_url, p.emoji
       FROM conversions c
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN products pr ON pr.id = c.producto_contratado_id
      WHERE c.id = $1`, [conversionId]);
  return rows[0] || null;
}

/** El link vivo de una cuota (el último), o null. */
export async function linkVivoDeLaCuota(cuotaId) {
  const { rows } = await query(
    `SELECT id, project_id, lead_id, conversion_id, created_by, estado, url, caduca_el,
            stripe_payment_link_id, guarda_tarjeta
       FROM payment_links
      WHERE installment_id = $1 AND estado IN ('creado', 'abierto')
      ORDER BY id DESC LIMIT 1`, [cuotaId]);
  return rows[0] || null;
}

/**
 * Las ventas que repasa el cron: todas las que tienen cobro automático (o un
 * calendario que quitar), primero las que fallaron. Repasar una que no ha
 * cambiado no llama a Stripe (misma firma).
 */
export async function ventasPorRepasar(lote = 50) {
  const { rows } = await query(
    `SELECT conversion_id FROM conversion_cobro_auto
      WHERE (activo AND stripe_payment_method_id IS NOT NULL) OR (NOT activo AND stripe_schedule_id IS NOT NULL)
      ORDER BY (sync_error IS NULL AND fases_firma IS NOT NULL), sincronizado_el NULLS FIRST LIMIT $1`, [lote]);
  return rows.map((r) => r.conversion_id);
}

export async function numeroDeCuota(installmentId) {
  const { rows } = await query('SELECT numero FROM conversion_installments WHERE id = $1', [installmentId]);
  return rows[0]?.numero ?? null;
}

/** ¿Tiene la venta algo que pasar a Stripe? (para no tocar nada en las que no). */
export async function tieneCobroAuto(conversionId) {
  const { rows } = await query(
    'SELECT 1 FROM conversion_cobro_auto WHERE conversion_id = $1 AND (activo OR stripe_schedule_id IS NOT NULL)', [conversionId]);
  return rows.length > 0;
}

export async function ventasDelCampus(projectId) {
  const { rows } = await query(
    'SELECT conversion_id FROM conversion_cobro_auto WHERE project_id = $1 AND (activo OR stripe_schedule_id IS NOT NULL)', [projectId]);
  return rows.map((r) => r.conversion_id);
}
