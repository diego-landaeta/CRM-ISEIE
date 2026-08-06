import crypto from 'crypto';
import { logger } from '../../shared/utils/logger.js';
import { decrypt } from '../../shared/utils/crypto.js';
import * as integrationsModel from '../integrations/integrations.model.js';
import { query } from '../../shared/config/db.js';
import * as model from './stripe-payments.model.js';

async function getStripeKey(projectId) {
  try {
    const row = await integrationsModel.get(projectId, 'stripe');
    if (row?.encrypted_value) return decrypt(row.encrypted_value, row.iv, row.auth_tag);
  } catch (e) { logger.warn({ e: e.message }, 'getStripeKey failed'); }
  return process.env.STRIPE_SECRET_KEY || null;
}

export async function getWebhookSecret(projectId) {
  try {
    const row = await integrationsModel.get(projectId, 'stripe');
    const pub = row?.config_public || {};
    // Las columnas row.webhook_iv y row.webhook_auth_tag NUNCA han existido en
    // project_integrations —son iv y auth_tag, y pertenecen a la clave de API—,
    // asi que esta rama estaba muerta y siempre se caia al texto plano. El
    // secreto guarda ahora su propio iv y su etiqueta dentro de config_public.
    if (pub.webhook_secret_encrypted && pub.webhook_secret_iv && pub.webhook_secret_auth_tag) {
      return decrypt(pub.webhook_secret_encrypted, pub.webhook_secret_iv, pub.webhook_secret_auth_tag);
    }
    return pub.webhook_secret || null;
  } catch (e) { return null; }
}

async function stripeGet(apiKey, path, params = {}) {
  const url = new URL(`https://api.stripe.com${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!r.ok) throw new Error(`Stripe ${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function chargeToPayment(charge, projectId) {
  // Importe SIEMPRE en EUR: si el cargo entra en moneda extranjera, usamos el
  // importe liquidado por Stripe en EUR (balance_transaction.amount), no el
  // importe en la moneda del cargo. Así el CRM registra euros reales y no vuelve
  // a pasar lo de las facturas en $/CRC/COP.
  const bt = charge.balance_transaction; // objeto expandido (expand[]=data.balance_transaction)
  const chargeCur = (charge.currency || 'eur').toLowerCase();
  const foreign = chargeCur !== 'eur';
  const settledEur = bt && typeof bt.amount === 'number' ? bt.amount / 100 : null;
  const amountEur = foreign && settledEur != null ? settledEur : (charge.amount || 0) / 100;
  return {
    project_id: projectId,
    stripe_id: charge.id,
    type: 'charge',
    status: charge.status,
    amount: amountEur,
    currency: 'EUR',
    // Comisión de Stripe y neto realmente liquidado (para la copia de gestión).
    // La factura del alumno siempre va por el bruto (amount).
    fee_amount: bt && typeof bt.fee === 'number' ? bt.fee / 100 : null,
    net_amount: bt && typeof bt.net === 'number' ? bt.net / 100 : null,
    customer_email: charge.billing_details?.email || charge.receipt_email || null,
    customer_name: charge.billing_details?.name || null,
    customer_stripe_id: charge.customer || null,
    description: charge.description || null,
    metadata: {
      ...(charge.metadata || {}),
      ...(foreign ? { original_amount: (charge.amount || 0) / 100, original_currency: chargeCur.toUpperCase(), stripe_exchange_rate: bt?.exchange_rate ?? null } : {}),
    },
    payment_method: charge.payment_method_details?.type || null,
    disputed: !!charge.disputed,
    dispute_status: charge.dispute?.status || null,
    dispute_reason: charge.dispute?.reason || null,
    refunded: !!charge.refunded,
    refunded_amount: charge.amount_refunded ? charge.amount_refunded / 100 : null,
    stripe_created_at: charge.created,
  };
}

async function autoLinkIfPossible(projectId, payment, dbRow) {
  if (dbRow.conversion_id) return;
  if (payment.status !== 'succeeded' || !payment.customer_email) return;
  // Un cargo en otra moneda solo vale si su importe ya viene liquidado en euros.
  // Los importados sin el balance_transaction guardaron el importe en la moneda
  // del cargo: asociarlos meteria 270.000 pesos colombianos como 270.000 euros.
  const moneda = String(payment.currency || dbRow.currency || 'EUR').toUpperCase();
  if (moneda !== 'EUR') {
    logger.warn({ stripeId: payment.stripe_id, moneda, importe: payment.amount },
      'cargo en moneda extranjera sin convertir a euros: no se asocia');
    return;
  }
  const lead = await model.findLeadByEmail(projectId, payment.customer_email);
  if (!lead) return;
  if (lead.status !== 'convertido') {
    await model.linkPayment(dbRow.id, { leadId: lead.id, conversionId: null, conversionPaymentId: null, userId: null, method: 'auto_pending' });
    return;
  }
  const conv = await model.findConversionByLeadId(lead.id);
  if (!conv) {
    await model.linkPayment(dbRow.id, { leadId: lead.id, conversionId: null, conversionPaymentId: null, userId: null, method: 'auto_pending' });
    return;
  }
  const fecha = new Date(payment.stripe_created_at * 1000).toISOString().slice(0, 10);
  // ¿Es realmente un duplicado? Lo es cuando la asesora ya registró ESE MISMO cobro a mano:
  // mismo importe y fecha muy próxima en la misma venta. No basta con que la venta esté
  // saldada — hay ventas cuyo importe_total quedó corto y siguen recibiendo mensualidades
  // legítimas, y bloquearlas dejaba el cobro sin factura.
  const dup = await model.findPagoDuplicado(conv.id, payment.amount, fecha, payment.stripe_id);
  if (dup) {
    // Se vincula al pago que ya existe (y a su factura, si la tiene) SIN volver a sumar.
    await model.linkPayment(dbRow.id, { leadId: lead.id, conversionId: conv.id, conversionPaymentId: dup.id, userId: null, method: 'auto_dedup' });
    return;
  }
  // Registrar el cobro con la MISMA lógica que un pago manual (conversion.model.addPayment):
  // salda la cuota pendiente más antigua (FIFO). allowOverpay: un cobro real de Stripe se
  // registra aunque supere el total previsto de la venta (el total es lo que suele estar mal).
  const convModel = await import('../conversions/conversion.model.js');
  const res = await convModel.addPayment(conv.id, {
    importe: payment.amount, fecha, notas: `Auto-Stripe ${payment.stripe_id}`, metodo: 'tarjeta',
  }, { allowOverpay: true, allowDuplicate: true });
  if (res?.error || !res?.payment) return;
  const cpId = res.payment.id;
  await model.linkPayment(dbRow.id, { leadId: lead.id, conversionId: conv.id, conversionPaymentId: cpId, userId: null, method: 'auto_email' });
  // El cobro queda registrado en la venta y espera EN LA COLA de facturacion.
  // La factura NO sale sola: la emite una persona cuando comprueba que los datos
  // del cliente estan bien. Antes se emitia aqui mismo, y salian facturas
  // numeradas con lo que hubiera en la ficha en ese momento.
  logger.info({ conversionId: conv.id, paymentId: cpId, stripeId: payment.stripe_id },
    'cobro de Stripe registrado; queda en la cola de facturacion');
}

// Trae detalle completo de dispute desde Stripe API (incluye evidence_due_by)
async function fetchAndUpdateDispute(apiKey, projectId, charge) {
  if (!charge.disputed) return;
  try {
    const data = await stripeGet(apiKey, '/v1/disputes', { 'charge': charge.id, limit: 1 });
    const d = data.data?.[0];
    if (!d) return;
    await query(
      `UPDATE stripe_payments SET
         dispute_id = $1,
         dispute_status = $2,
         dispute_reason = $3,
         dispute_amount = $4,
         dispute_evidence_due_by = to_timestamp($5),
         updated_at = NOW()
       WHERE project_id = $6 AND stripe_id = $7`,
      [d.id, d.status, d.reason, (d.amount || 0) / 100, d.evidence_details?.due_by || null, projectId, charge.id]
    );
  } catch (e) {
    logger.warn({ chargeId: charge.id, err: e.message }, 'fetchDispute failed');
  }
}

export async function syncStripePayments(projectId, { fullHistory = false, retryPending = false } = {}) {
  const apiKey = await getStripeKey(projectId);
  if (!apiKey) throw new Error('Stripe API key no configurada para este proyecto');

  const state = await model.getSyncState(projectId);
  let createdGte = null;
  if (!fullHistory && state?.last_synced_until) {
    createdGte = Math.floor(new Date(state.last_synced_until).getTime() / 1000) - 3600;
  }

  let imported = 0;
  let disputesFound = 0;
  let lastCreated = state?.last_synced_until ? Math.floor(new Date(state.last_synced_until).getTime() / 1000) : 0;
  let startingAfter = null;
  let pages = 0;
  const MAX_PAGES = 200;

  while (pages < MAX_PAGES) {
    const params = { limit: 100, 'expand[]': 'data.balance_transaction' };
    if (createdGte) params['created[gte]'] = createdGte;
    if (startingAfter) params.starting_after = startingAfter;

    const data = await stripeGet(apiKey, '/v1/charges', params);
    if (!data.data?.length) break;

    for (const ch of data.data) {
      try {
        const payment = chargeToPayment(ch, projectId);
        const dbRow = await model.upsertPayment(payment);
        try { await autoLinkIfPossible(projectId, payment, dbRow); }
        catch (e) { logger.warn({ chargeId: ch.id, err: e.message }, 'autoLink fail'); }
        if (ch.disputed) {
          await fetchAndUpdateDispute(apiKey, projectId, ch);
          disputesFound++;
        }
        imported++;
        if (ch.created > lastCreated) lastCreated = ch.created;
      } catch (e) {
        logger.warn({ chargeId: ch.id, err: e.message }, 'Charge sync failed - continua');
      }
    }
    if (!data.has_more) break;
    startingAfter = data.data[data.data.length - 1].id;
    pages++;
  }


  // Segunda pasada: los cargos que ya estaban importados y siguen sin asociar.
  // Stripe solo devuelve los cargos nuevos, asi que sin esto un cobro cuya
  // asociacion se deshizo no se volveria a enganchar nunca por mucho que se
  // pulse Sincronizar.
  //
  // Solo se hace cuando alguien pulsa Sincronizar a mano (retryPending). El cron
  // de cada 5 min no lo dispara: reasociar en masa es una decision del usuario,
  // no algo que deba pasar solo de madrugada.
  let reasociados = 0;
  if (retryPending) try {
    const pendientes = await model.listPendientesDeAsociar(projectId, 5000);
    for (const row of pendientes) {
      try {
        const antes = row.conversion_payment_id;
        await autoLinkIfPossible(projectId, {
          status: row.status,
          amount: Number(row.amount),
          customer_email: row.customer_email,
          currency: row.currency,
          stripe_created_at: Number(row.stripe_created_at),
          stripe_id: row.stripe_id,
        }, row);
        const despues = await model.getById(row.id);
        if (!antes && despues?.conversion_payment_id) reasociados++;
      } catch (e) {
        logger.warn({ stripeId: row.stripe_id, err: e.message }, 'reintento de asociacion fallido');
      }
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'no se pudo reintentar la asociacion de pendientes');
  }

  await model.upsertSyncState(projectId, {
    last_sync_at: new Date().toISOString(),
    last_full_sync_at: fullHistory ? new Date().toISOString() : (state?.last_full_sync_at || null),
    last_synced_until: lastCreated ? new Date(lastCreated * 1000).toISOString() : (state?.last_synced_until || null),
    total_imported: (state?.total_imported || 0) + imported,
    last_error: null,
  });

  logger.info({ projectId, imported, disputesFound, pages, reasociados }, 'Stripe sync OK');
  return { imported, disputes: disputesFound, pages, reasociados };
}

export async function manualLink(stripePaymentId, { leadId, conversionId, userId }) {
  let cpId = null;
  let importe = 0;
  let yaExistia = false;
  if (conversionId) {
    const { rows } = await query(
      `SELECT amount, stripe_id, stripe_created_at FROM stripe_payments WHERE id=$1`, [stripePaymentId]);
    const amount = Number(rows[0]?.amount || 0);
    // Fecha REAL del cobro en Stripe (antes se guardaba la de hoy y la factura salía con
    // fecha equivocada). Si faltara, se cae a hoy.
    const fecha = rows[0]?.stripe_created_at
      ? new Date(rows[0].stripe_created_at).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    if (amount > 0) {
      importe = amount;
      // Si la asesora ya registró ese mismo cobro a mano, se engancha al pago existente
      // (y a su factura) en vez de crear otro: se vincula pero NO vuelve a sumar.
      const dup = await model.findPagoDuplicado(conversionId, amount, fecha, rows[0]?.stripe_id);
      if (dup) {
        cpId = dup.id;
        yaExistia = true;
      } else {
        // Mismo camino que un pago manual: salda la cuota pendiente más antigua (FIFO)
        // para que el cobro aparezca en las mensualidades de la venta.
        const convModel = await import('../conversions/conversion.model.js');
        const res = await convModel.addPayment(conversionId, {
          importe: amount, fecha, notas: `Stripe ${rows[0]?.stripe_id || stripePaymentId}`, metodo: 'tarjeta',
        }, { allowOverpay: true, allowDuplicate: true });
        cpId = res?.payment?.id || null;
      }
    }
  }
  await model.linkPayment(stripePaymentId, { leadId, conversionId, conversionPaymentId: cpId, userId, method: yaExistia ? 'manual_dedup' : 'manual' });
  // Asociar el cargo NO emite la factura: el cobro queda registrado en la venta y
  // espera en la cola. La emite una persona cuando comprueba que los datos del
  // cliente estan bien.
  if (cpId) {
    logger.info({ conversionId, paymentId: cpId, stripePaymentId },
      'cargo de Stripe asociado a mano; queda en la cola de facturacion');
  }
}

export async function updateDisputeDecision(stripePaymentId, { decision, notes, userId }) {
  await query(
    `UPDATE stripe_payments SET
       dispute_my_decision = $1,
       dispute_notes = COALESCE($2, dispute_notes),
       dispute_decided_at = NOW(),
       dispute_decided_by = $3,
       updated_at = NOW()
     WHERE id = $4`,
    [decision, notes || null, userId || null, stripePaymentId]
  );
}

// ─── Webhook handler (Stripe → CRM en tiempo real) ───────────────────────────
export function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  for (const p of sigHeader.split(',')) {
    const [k, v] = p.split('=');
    if (k && v) (parts[k] = parts[k] || []).push(v);
  }
  const t = parts.t?.[0];
  const v1List = parts.v1 || [];
  if (!t || !v1List.length) return false;
  // La firma incluye la marca de tiempo, pero de nada sirve si no se comprueba:
  // sin esto, quien capture una peticion valida puede reenviarla mañana y el
  // cobro se duplica. Cinco minutos, la misma ventana que recomienda Stripe.
  const edadSegundos = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (!Number.isFinite(edadSegundos) || edadSegundos > 300) return false;
  const payload = `${t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  for (const v1 of v1List) {
    if (v1.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))) return true;
  }
  return false;
}

export async function handleWebhookEvent(projectId, event) {
  const apiKey = await getStripeKey(projectId);
  const obj = event.data?.object;
  if (!obj) return { skipped: 'no data' };

  switch (event.type) {
    case 'charge.succeeded':
    case 'charge.updated':
    case 'charge.refunded':
    case 'charge.failed': {
      const payment = chargeToPayment(obj, projectId);
      const dbRow = await model.upsertPayment(payment);
      try { await autoLinkIfPossible(projectId, payment, dbRow); } catch (e) { logger.warn({ err: e.message }, 'autoLink wh fail'); }
      if (obj.disputed && apiKey) await fetchAndUpdateDispute(apiKey, projectId, obj);
      return { processed: event.type, stripeId: obj.id };
    }
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed': {
      // obj is the dispute object
      await query(
        `UPDATE stripe_payments SET
           disputed = true,
           dispute_id = $1, dispute_status = $2, dispute_reason = $3,
           dispute_amount = $4,
           dispute_evidence_due_by = to_timestamp($5),
           updated_at = NOW()
         WHERE project_id = $6 AND stripe_id = $7`,
        [obj.id, obj.status, obj.reason, (obj.amount || 0) / 100,
         obj.evidence_details?.due_by || null, projectId, obj.charge]
      );
      return { processed: event.type, stripeId: obj.id };
    }
    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed': {
      // Fetch the charge via API for full info (PI no incluye billing_details completos)
      if (apiKey && obj.latest_charge) {
        try {
          const ch = await stripeGet(apiKey, `/v1/charges/${obj.latest_charge}`);
          const payment = chargeToPayment(ch, projectId);
          const dbRow = await model.upsertPayment(payment);
          try { await autoLinkIfPossible(projectId, payment, dbRow); } catch {}
        } catch (e) { logger.warn({ err: e.message }, 'fetch charge from PI failed'); }
      }
      return { processed: event.type, stripeId: obj.id };
    }
    default:
      return { skipped: event.type };
  }
}
