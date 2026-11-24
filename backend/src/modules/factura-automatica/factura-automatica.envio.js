import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';

/*
  «ENVIAR FACTURA AUTOMÁTICAMENTE: SÍ / NO» Y «ENVIAR A ESTE CORREO» (#764, 24/11).

  Diego, al encender la facturación automática en producción: que la gestora
  diga, en la venta o en el cobro, si el PDF lo manda el CRM o lo manda ella, y
  a qué correo.

    · SÍ (de serie). Como hasta hoy: formulario de datos fiscales, factura sola
      y PDF al alumno.
    · NO. La factura se emite IGUAL (mismo número, misma fecha, mismos datos),
      pero el PDF no sale: lleva la coletilla «No se envía automáticamente: la
      envía la gestora», que se ve en la venta y en la factura. El formulario
      de datos fiscales sí se manda: sin él la factura saldría con la ficha.
    · EL CORREO. El de la ficha, ya relleno; la gestora lo confirma o lo
      cambia. El formulario y el PDF van a ese. Sin confirmar, el de la ficha.

  Se guarda en la venta (`conversions.factura_envio_*`, migración 337 en ISEIE, 325 en el 360): las
  cuotas reutilizan la elección, como reutilizan los datos fiscales. Un link de
  pago sin venta lo guarda en el link y lo pasa a la venta que nace al pagarlo.
*/

export const NOTA_LA_ENVIA_LA_GESTORA = 'No se envía automáticamente: la envía la gestora';

const limpio = (email) => {
  const t = String(email ?? '').trim().toLowerCase();
  return t || null;
};

/** El correo al que van el formulario y el PDF: el confirmado o el de la ficha. */
export function correoDeEnvio(v) {
  return limpio(v?.factura_envio_email) || limpio(v?.email);
}

/** ¿Manda el CRM el PDF de esta venta? Sí salvo que la gestora dijera que no. */
export const enviaElCrm = (v) => v?.factura_envio_auto !== false;

/** Lo que enseña la pantalla de la venta. */
export async function envioDeLaVenta(conversionId) {
  const { rows } = await query(
    `SELECT c.id, c.factura_envio_auto, c.factura_envio_email, c.factura_envio_at,
            u.nombre AS factura_envio_por_nombre, l.email AS email_ficha
       FROM conversions c
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN users u ON u.id = c.factura_envio_por
      WHERE c.id = $1`,
    [conversionId]);
  const r = rows[0];
  if (!r) return null;
  return {
    auto: r.factura_envio_auto !== false,
    email: limpio(r.factura_envio_email),
    email_ficha: limpio(r.email_ficha),
    email_efectivo: limpio(r.factura_envio_email) || limpio(r.email_ficha),
    confirmado: !!r.factura_envio_at,
    confirmado_at: r.factura_envio_at,
    confirmado_por: r.factura_envio_por_nombre || null,
    nota: r.factura_envio_auto === false ? NOTA_LA_ENVIA_LA_GESTORA : null,
  };
}

/**
 * Guarda la elección en la venta. `email` null = el de la ficha. Devuelve lo
 * que enseña la pantalla. Lo llaman el alta de la venta, la ficha de la venta,
 * la cola y el link de pago.
 */
export async function guardarEnLaVenta(conversionId, { auto = true, email = null } = {}, userId = null) {
  await query(
    `UPDATE conversions
        SET factura_envio_auto = $2, factura_envio_email = $3,
            factura_envio_por = $4, factura_envio_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [conversionId, auto !== false, limpio(email), userId || null]);
  return envioDeLaVenta(conversionId);
}

/** Lo elegido al crear un link que aún no tiene venta. */
export async function guardarEnElLink(linkId, { auto = true, email = null } = {}) {
  await query(
    'UPDATE payment_links SET factura_envio_auto = $2, factura_envio_email = $3 WHERE id = $1',
    [linkId, auto !== false, limpio(email)]);
}

/**
 * La venta nace al pagarse un link: hereda lo que eligió la gestora al crearlo.
 * Si no eligió nada, la venta se queda con lo de serie (Sí, y el correo de la
 * ficha, que en un prospecto nuevo es con el que pagó). No bloquea.
 */
export async function delLinkALaVenta(link, conversionId) {
  if (!link || !conversionId || link.factura_envio_auto == null) return;
  try {
    await guardarEnLaVenta(conversionId, { auto: link.factura_envio_auto, email: link.factura_envio_email },
      link.created_by ? Number(link.created_by) : null);
  } catch (err) {
    logger.warn({ err: err.message, linkId: link.id, conversionId }, 'factura automática: no se pudo pasar el envío del link a la venta');
  }
}

/** La coletilla en la factura que salió sola sin mandarse. */
export async function anotarEnLaFactura(invoiceId, nota) {
  await query('UPDATE invoices SET envio_nota = $2, updated_at = NOW() WHERE id = $1', [invoiceId, nota]);
}

/** El envío de varias ventas a la vez (para la cola). */
export async function envioDeVentas(conversionIds = []) {
  if (!conversionIds.length) return new Map();
  const { rows } = await query(
    `SELECT c.id, c.factura_envio_auto, c.factura_envio_email, c.factura_envio_at, l.email AS email_ficha
       FROM conversions c LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.id = ANY($1::int[])`,
    [conversionIds]);
  return new Map(rows.map((r) => [Number(r.id), {
    auto: r.factura_envio_auto !== false,
    email: limpio(r.factura_envio_email) || limpio(r.email_ficha),
    confirmado: !!r.factura_envio_at,
  }]));
}
