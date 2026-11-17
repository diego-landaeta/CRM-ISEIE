/**
 * PAYPAL → CRM (#766, Automatizaciones 3/9).
 *
 * Antes PayPal solo existía como forma de pago que se apuntaba a mano. Ahora los
 * cobros de la cuenta Business de cada campus entran por dos caminos, como los
 * de Stripe:
 *
 *   · el SONDEO (cada 30 minutos): la API de informes de PayPal, que trae el
 *     correo y el nombre de quien paga;
 *   · el WEBHOOK firmado, si se da de alta: se comprueba la firma PREGUNTÁNDOLE
 *     A PAYPAL (verify-webhook-signature) con el id del webhook del campus.
 *
 * Cada cobro se enlaza a su venta por la referencia (custom_id o invoice_id con
 * «venta-123» / «crm-123») o por el correo del cliente, igual que Stripe. Se
 * reserva con una sola sentencia (la #699) y se registra con `origen='paypal'`
 * y su id: no entra dos veces, venga por donde venga.
 *
 * Todo detrás de PAYPAL_COBROS_ACTIVO=1. Apagado, nada de esto llama a PayPal.
 */
import { logger } from '../../shared/utils/logger.js';
import { decrypt } from '../../shared/utils/crypto.js';
import { query } from '../../shared/config/db.js';
import * as integrationsModel from '../integrations/integrations.model.js';
// De Stripe se reutiliza lo que no es de Stripe: buscar al prospecto por su
// correo y su última venta.
import { findLeadByEmail, findConversionByLeadId } from '../stripe-payments/stripe-payments.model.js';
import * as model from './paypal.model.js';
import * as api from './paypal.client.js';
import { registrarCobroExterno } from './enlace.js';
import { paypalActivo } from './interruptores.js';

/** Las credenciales del campus, o null si no hay. Nunca salen de aquí. */
export async function credenciales(projectId) {
  const row = await integrationsModel.get(projectId, 'paypal');
  if (!row?.active || !row.encrypted_value) return null;
  const pub = row.config_public || {};
  if (!pub.client_id) return null;
  let secret;
  try { secret = decrypt(row.encrypted_value, row.iv, row.auth_tag); }
  catch (e) { logger.warn({ projectId, err: e.message }, 'paypal: el secreto no se puede descifrar'); return null; }
  return {
    clientId: String(pub.client_id),
    secret,
    modo: pub.modo === 'sandbox' ? 'sandbox' : 'live',
    webhookId: pub.webhook_id ? String(pub.webhook_id) : null,
  };
}

const ESTADOS = { S: 'completed', P: 'pending', V: 'reversed', D: 'denied' };
const num = (v) => (v == null || v === '' ? null : Number(v));

/**
 * Un movimiento de la API de informes → un cobro. null si no es un cobro ni un
 * reembolso (transferencias al banco, cambios de divisa, retenciones…).
 *
 *   T00xx con importe positivo  → cobro que entra
 *   T11xx                       → reembolso o retrocesión (importe negativo)
 */
export function transaccionAPago(td, projectId) {
  const ti = td?.transaction_info || {};
  const pi = td?.payer_info || {};
  const codigo = String(ti.transaction_event_code || '');
  const importe = num(ti.transaction_amount?.value);
  if (!ti.transaction_id || importe == null) return null;
  let tipo;
  if (codigo.startsWith('T00') && importe > 0) tipo = 'cobro';
  else if (codigo.startsWith('T11') && importe < 0) tipo = 'reembolso';
  else return null;
  const nombre = pi.payer_name?.alternate_full_name
    || [pi.payer_name?.given_name, pi.payer_name?.surname].filter(Boolean).join(' ')
    || null;
  const comision = num(ti.fee_amount?.value);
  return {
    project_id: projectId,
    paypal_id: String(ti.transaction_id),
    tipo,
    status: ESTADOS[ti.transaction_status] || 'pending',
    amount: Math.abs(importe),
    currency: String(ti.transaction_amount?.currency_code || 'EUR').toUpperCase(),
    fee_amount: comision == null ? null : Math.abs(comision),
    net_amount: comision == null ? null : Math.abs(importe) - Math.abs(comision),
    customer_email: pi.email_address || null,
    customer_name: nombre,
    payer_id: pi.account_id || null,
    invoice_id: ti.invoice_id || null,
    custom_id: ti.custom_field || null,
    description: ti.transaction_subject || ti.transaction_note || null,
    event_code: codigo || null,
    referencia_paypal_id: tipo === 'reembolso' ? (ti.paypal_reference_id || null) : null,
    paypal_created_at: ti.transaction_initiation_date || new Date().toISOString(),
    llegado_por: 'sondeo',
  };
}

/** La venta que dice la referencia del cobro («venta-123», «crm:123»), si es de este campus. */
async function ventaDeLaReferencia(projectId, ...refs) {
  for (const r of refs) {
    const m = String(r || '').match(/(?:^|[^a-z])(?:venta|crm)[\s_:#-]*(\d{1,9})(?:\D|$)/i);
    if (!m) continue;
    const { rows } = await query(
      'SELECT id, lead_id FROM conversions WHERE id = $1 AND project_id = $2', [Number(m[1]), projectId]);
    if (rows[0]) return rows[0];
  }
  return null;
}

/**
 * Enlaza un cobro con su venta, de uno en uno por cobro (la reserva de la #699).
 * No hace nada si no está completado, si no es en euros o si no se sabe de quién es.
 */
export async function intentarEnlazar(projectId, fila) {
  if (!fila || fila.tipo !== 'cobro' || fila.status !== 'completed' || fila.conversion_payment_id) return null;
  const reservada = await model.reservar(fila.id);
  if (!reservada) return null; // ya tiene su cobro, o lo está enlazando otro ahora mismo
  const metodo = reservada.metodo_antes === model.ENLAZANDO ? null : reservada.metodo_antes;
  const enlazado = reservada.metodo_antes === model.ENLAZANDO ? null : reservada.enlazado_antes;
  try {
    return await enlazarSiSePuede(projectId, reservada);
  } finally {
    await model.soltar(fila.id, metodo, enlazado).catch((e) => logger.error(
      { err: e.message, projectId, paypalId: fila.paypal_id }, 'paypal: no se pudo soltar la reserva; caduca sola en 2 minutos'));
  }
}

async function enlazarSiSePuede(projectId, fila) {
  // Un cobro en otra moneda no se registra: entraría como si fueran euros.
  if (String(fila.currency || 'EUR').toUpperCase() !== 'EUR') {
    logger.warn({ paypalId: fila.paypal_id, moneda: fila.currency }, 'paypal: cobro en otra moneda, no se asocia solo');
    return null;
  }
  let lead = null;
  let venta = null;
  let por = 'auto_email';
  if (fila.conversion_id) {
    venta = { id: fila.conversion_id, lead_id: fila.lead_id };
    por = fila.link_method && !fila.link_method.startsWith('auto') ? fila.link_method : 'auto_email';
  } else {
    venta = await ventaDeLaReferencia(projectId, fila.custom_id, fila.invoice_id);
    if (venta) por = 'auto_ref';
  }
  if (!venta) {
    if (!fila.customer_email) return null;
    lead = await findLeadByEmail(projectId, fila.customer_email);
    if (!lead) return null;
    const conv = lead.status === 'convertido' ? await findConversionByLeadId(lead.id) : null;
    if (!conv) {
      // El prospecto existe pero aún no ha comprado: queda apuntado de quién es.
      await model.enlazar(fila.id, { leadId: lead.id, conversionId: null, paymentId: null, method: 'auto_pending' });
      return null;
    }
    venta = { id: conv.id, lead_id: lead.id };
  }
  const fecha = new Date(fila.paypal_created_at).toISOString().slice(0, 10);
  const res = await registrarCobroExterno({
    conversionId: venta.id, origen: 'paypal', ref: fila.paypal_id,
    importe: Number(fila.amount), fecha, notas: `Auto-PayPal ${fila.paypal_id}`, metodo: 'paypal',
  });
  if (!res) return null;
  const method = res.metodo === 'nuevo' ? por : 'auto_dedup';
  await model.enlazar(fila.id, {
    leadId: venta.lead_id ?? lead?.id ?? null, conversionId: res.conversionId ?? venta.id,
    paymentId: res.paymentId, method,
  });
  logger.info({ projectId, paypalId: fila.paypal_id, conversionId: venta.id, paymentId: res.paymentId, metodo: res.metodo },
    'cobro de PayPal registrado; queda en la cola de facturación');
  if (res.metodo === 'nuevo') await avisarALaGestora(venta, fila);
  return res;
}

// Como con Stripe (#111): a quien lleva la ficha, que le han pagado.
async function avisarALaGestora(venta, fila) {
  try {
    const { rows: [l] } = await query('SELECT id, nombre, responsable_id FROM leads WHERE id = $1', [venta.lead_id]);
    if (!l?.responsable_id) return;
    const { notifyUsers } = await import('../notifications/notifications.service.js');
    const euros = Number(fila.amount).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    await notifyUsers({
      targetUserIds: [l.responsable_id],
      type: 'venta_automatica',
      title: `Cobro de ${euros} € de ${l.nombre || fila.customer_email || 'un cliente'}`,
      message: 'Entró por PayPal y se registró solo en su venta. Queda en la cola de facturación.',
      link_path: `/prospectos/${l.id}`,
      metadata: { lead_id: l.id, conversion_id: venta.id, paypal_id: fila.paypal_id },
    });
  } catch { /* el aviso no puede tumbar el cobro */ }
}

const DIA = 24 * 60 * 60 * 1000;
const VENTANA = 31 * DIA;          // lo máximo que deja pedir la API de informes
const SOLAPE = 3 * DIA;            // PayPal rellena los informes con horas de retraso
const MAX_VENTANAS = 12;           // un año por vuelta, como mucho
const TRES_ANNOS = 3 * 365 * DIA;  // lo más atrás que guarda la API

/**
 * Trae los cobros de un campus y los enlaza. Devuelve un resumen.
 * `reintentar`: además, vuelve a intentar los ya guardados que siguen sin venta
 * (lo pide el botón «Sincronizar», no el sondeo).
 */
export async function sincronizar(projectId, { reintentar = false, env = process.env, ahora = Date.now() } = {}) {
  if (!paypalActivo(env)) return { apagado: true };
  const cred = await credenciales(projectId);
  if (!cred) return { sinCredenciales: true };
  try {
    return await sincroniza(projectId, cred, { reintentar, ahora });
  } catch (err) {
    // Que el fallo quede apuntado, no solo en el log (lo mismo que Stripe).
    await model.guardarEstadoSync(projectId, { last_error: String(err?.message || err).slice(0, 500) })
      .catch(() => {});
    throw err;
  }
}

async function sincroniza(projectId, cred, { reintentar, ahora }) {
  const estado = await model.estadoSync(projectId);
  let desde;
  if (estado?.last_synced_until) {
    desde = new Date(estado.last_synced_until).getTime() - SOLAPE;
  } else {
    // La primera vez, desde el suelo de facturación del campus (el mismo que
    // Stripe): lo anterior ya se llevó fuera del CRM.
    const corte = await model.sueloDelCampus(projectId);
    desde = corte ? new Date(corte).getTime() : ahora - VENTANA;
  }
  desde = Math.max(desde, ahora - TRES_ANNOS + DIA);

  let importados = 0;
  let enlazados = 0;
  let hasta = desde;
  let ventanas = 0;
  while (hasta < ahora && ventanas < MAX_VENTANAS) {
    const ini = hasta;
    const fin = Math.min(ini + VENTANA, ahora);
    let pagina = 1;
    let paginas = 1;
    do {
      const r = await api.transacciones(cred, { desde: ini, hasta: fin, pagina });
      paginas = r.paginas;
      for (const td of r.transacciones) {
        const pago = transaccionAPago(td, projectId);
        if (!pago) continue;
        try {
          const fila = await model.upsertPago(pago);
          importados++;
          const hecho = await intentarEnlazar(projectId, fila);
          if (hecho?.metodo === 'nuevo' || hecho?.metodo === 'dedup') enlazados++;
        } catch (e) {
          logger.warn({ projectId, paypalId: pago.paypal_id, err: e.message }, 'paypal: un cobro no se pudo guardar o enlazar; sigue');
        }
      }
      pagina++;
    } while (pagina <= paginas);
    hasta = fin;
    ventanas++;
  }

  let reintentados = 0;
  if (reintentar) {
    for (const fila of await model.pendientesDeEnlazar(projectId)) {
      try {
        const hecho = await intentarEnlazar(projectId, fila);
        if (hecho) reintentados++;
      } catch (e) {
        logger.warn({ projectId, paypalId: fila.paypal_id, err: e.message }, 'paypal: reintento fallido');
      }
    }
  }

  await model.guardarEstadoSync(projectId, {
    last_sync_at: new Date(ahora).toISOString(),
    last_synced_until: new Date(hasta).toISOString(),
    total_imported: (estado?.total_imported || 0) + importados,
    last_error: null,
  });
  logger.info({ projectId, importados, enlazados, reintentados, ventanas }, 'PayPal sync OK');
  return { importados, enlazados, reintentados, ventanas, completo: hasta >= ahora };
}

// ─── Webhook ────────────────────────────────────────────────────────────────

/** El cobro que trae un aviso de PayPal, o null si el aviso no es de cobros. */
async function eventoAPago(projectId, cred, evento) {
  const r = evento?.resource || {};
  const tipo = String(evento?.event_type || '');
  const base = { project_id: projectId, llegado_por: 'webhook' };
  // Pagos de Checkout (v2): la captura.
  if (/^PAYMENT\.CAPTURE\.(COMPLETED|PENDING|DENIED|REVERSED)$/.test(tipo)) {
    const orderId = r.supplementary_data?.related_ids?.order_id;
    const pagador = orderId ? await api.pagadorDelPedido(cred, orderId) : null;
    const importe = num(r.amount?.value);
    if (!r.id || importe == null) return null;
    const comision = num(r.seller_receivable_breakdown?.paypal_fee?.value);
    return {
      ...base, paypal_id: String(r.id), tipo: 'cobro',
      status: { COMPLETED: 'completed', PENDING: 'pending', DENIED: 'denied', REVERSED: 'reversed' }[tipo.split('.')[2]],
      amount: importe, currency: String(r.amount?.currency_code || 'EUR').toUpperCase(),
      fee_amount: comision, net_amount: num(r.seller_receivable_breakdown?.net_amount?.value),
      customer_email: pagador?.email || null, customer_name: pagador?.nombre || null, payer_id: pagador?.payerId || null,
      invoice_id: r.invoice_id || null, custom_id: r.custom_id || null,
      paypal_created_at: r.create_time || new Date().toISOString(),
    };
  }
  if (tipo === 'PAYMENT.CAPTURE.REFUNDED') {
    const importe = num(r.amount?.value);
    if (!r.id || importe == null) return null;
    const arriba = (r.links || []).find((l) => l.rel === 'up')?.href || '';
    return {
      ...base, paypal_id: String(r.id), tipo: 'reembolso', status: 'completed',
      amount: Math.abs(importe), currency: String(r.amount?.currency_code || 'EUR').toUpperCase(),
      invoice_id: r.invoice_id || null, custom_id: r.custom_id || null,
      referencia_paypal_id: arriba.split('/').pop() || null,
      paypal_created_at: r.create_time || new Date().toISOString(),
    };
  }
  // Botones y suscripciones antiguos (v1): la venta.
  if (tipo === 'PAYMENT.SALE.COMPLETED') {
    const importe = num(r.amount?.total);
    if (!r.id || importe == null) return null;
    return {
      ...base, paypal_id: String(r.id), tipo: 'cobro', status: 'completed',
      amount: importe, currency: String(r.amount?.currency || 'EUR').toUpperCase(),
      fee_amount: num(r.transaction_fee?.value),
      invoice_id: r.invoice_number || null, custom_id: r.custom || null,
      paypal_created_at: r.create_time || new Date().toISOString(),
    };
  }
  return null;
}

/**
 * Un aviso de PayPal. Devuelve `{ status, body }` para la respuesta.
 *
 * Sin interruptor, 404 (como si la ruta no existiera). Sin credenciales o sin
 * id del webhook del campus, 400: no hay con qué comprobar la firma, y sin
 * comprobarla no entra nada. Firma mala, 400.
 */
export async function procesarWebhook(projectId, { cabeceras, cuerpo }, { env = process.env } = {}) {
  if (!paypalActivo(env)) return { status: 404, body: { success: false, error: 'No encontrado', code: 'NOT_FOUND' } };
  const cred = Number.isInteger(projectId) && projectId > 0 ? await credenciales(projectId) : null;
  if (!cred?.webhookId) {
    return { status: 400, body: { success: false, error: 'Este campus no tiene el webhook de PayPal configurado', code: 'PAYPAL_WEBHOOK_SIN_CONFIGURAR' } };
  }
  let evento;
  try { evento = JSON.parse(cuerpo || ''); } catch {
    return { status: 400, body: { success: false, error: 'Cuerpo no válido', code: 'BAD_BODY' } };
  }
  let valida = false;
  try {
    valida = await api.verificarFirma(cred, { webhookId: cred.webhookId, cabeceras, evento });
  } catch (e) {
    logger.warn({ projectId, err: e.message }, 'paypal: no se pudo comprobar la firma del aviso');
    // PayPal reintenta lo que no reciba con 2xx: mejor un 503 que perder el aviso.
    return { status: 503, body: { success: false, error: 'No se pudo comprobar la firma', code: 'PAYPAL_VERIFICACION' } };
  }
  if (!valida) return { status: 400, body: { success: false, error: 'Firma no válida', code: 'BAD_SIGNATURE' } };

  const pago = await eventoAPago(projectId, cred, evento);
  if (!pago) return { status: 200, body: { success: true, data: { ignorado: evento?.event_type || null } } };
  const fila = await model.upsertPago(pago);
  try { await intentarEnlazar(projectId, fila); }
  catch (e) { logger.error({ projectId, paypalId: pago.paypal_id, err: e.message }, 'paypal: el cobro del aviso no se pudo enlazar'); }
  return { status: 200, body: { success: true, data: { procesado: evento.event_type, paypalId: pago.paypal_id } } };
}

/**
 * Enlazar a mano un cobro con una venta del MISMO campus (persona con
 * `cobros_externos.edit`). Misma regla anti-duplicado que lo automático.
 */
export async function enlazarAMano(id, conversionId, userId) {
  const fila = await model.getById(id);
  if (!fila) return { error: 'NOT_FOUND' };
  if (fila.conversion_payment_id) return { error: 'YA_ENLAZADO' };
  if (fila.tipo !== 'cobro' || fila.status !== 'completed') return { error: 'NO_COBRADO' };
  if (String(fila.currency).toUpperCase() !== 'EUR') return { error: 'OTRA_MONEDA' };
  const { rows: [v] } = await query('SELECT id, lead_id, project_id FROM conversions WHERE id = $1', [conversionId]);
  if (!v || Number(v.project_id) !== Number(fila.project_id)) return { error: 'VENTA_DE_OTRO_CAMPUS' };
  const reservada = await model.reservar(id);
  if (!reservada) return { error: 'OCUPADO' };
  try {
    const res = await registrarCobroExterno({
      conversionId: v.id, origen: 'paypal', ref: fila.paypal_id, importe: Number(fila.amount),
      fecha: new Date(fila.paypal_created_at).toISOString().slice(0, 10), notas: `PayPal ${fila.paypal_id}`, metodo: 'paypal',
    });
    if (!res) return { error: 'NOT_FOUND' };
    await model.enlazar(id, {
      leadId: v.lead_id, conversionId: res.conversionId ?? v.id, paymentId: res.paymentId, userId,
      method: res.metodo === 'nuevo' ? 'manual' : 'manual_dedup',
    });
    return { paymentId: res.paymentId, metodo: res.metodo };
  } finally {
    await model.soltar(id, reservada.metodo_antes === model.ENLAZANDO ? null : reservada.metodo_antes,
      reservada.metodo_antes === model.ENLAZANDO ? null : reservada.enlazado_antes).catch(() => {});
  }
}

/** Probar las credenciales: pedir un token. No lee ni toca nada de la cuenta. */
export async function probarCredenciales({ clientId, secret, modo }) {
  api._olvidarTokens();
  try {
    await api.pedirToken({ clientId, secret, modo });
    return { ok: true, message: `Conexión OK con PayPal (${modo === 'sandbox' ? 'SANDBOX, pruebas' : 'LIVE, producción'}).` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
