import { logger } from '../../shared/utils/logger.js';
import { decrypt } from '../../shared/utils/crypto.js';
import * as integrationsModel from '../integrations/integrations.model.js';
import * as model from './stripe-payments.model.js';

async function getStripeKey(projectId) {
  try {
    const row = await integrationsModel.get(projectId, 'stripe');
    if (row?.encrypted_value) return decrypt(row.encrypted_value, row.iv, row.auth_tag);
  } catch (e) { logger.warn({ e: e.message }, 'getStripeKey failed'); }
  return process.env.STRIPE_SECRET_KEY || null;
}

async function stripeGet(apiKey, path, params = {}) {
  const url = new URL(`https://api.stripe.com${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!r.ok) throw new Error(`Stripe ${path} HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}

function chargeToPayment(charge, projectId) {
  return {
    project_id: projectId,
    stripe_id: charge.id,
    type: 'charge',
    status: charge.status,
    amount: (charge.amount || 0) / 100,
    currency: (charge.currency || 'eur').toUpperCase(),
    customer_email: charge.billing_details?.email || charge.receipt_email || null,
    customer_name: charge.billing_details?.name || null,
    customer_stripe_id: charge.customer || null,
    description: charge.description || null,
    metadata: charge.metadata || {},
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
  if (dbRow.conversion_id) return; // ya linkeado
  if (payment.status !== 'succeeded' || !payment.customer_email) return;
  const lead = await model.findLeadByEmail(projectId, payment.customer_email);
  if (!lead) return;
  // Solo auto-asociar si el lead está en status convertido (decision del usuario)
  if (lead.status !== 'convertido') {
    await model.linkPayment(dbRow.id, { leadId: lead.id, conversionId: null, conversionPaymentId: null, userId: null, method: 'auto_email_match_pending' });
    return;
  }
  const conv = await model.findConversionByLeadId(lead.id);
  if (!conv) {
    await model.linkPayment(dbRow.id, { leadId: lead.id, conversionId: null, conversionPaymentId: null, userId: null, method: 'auto_email_match_pending' });
    return;
  }
  const fecha = new Date(payment.stripe_created_at * 1000).toISOString().slice(0, 10);
  const notas = `Auto-asociado desde Stripe ${payment.stripe_id}`;
  const cpId = await model.createConversionPayment(conv.id, payment.amount, fecha, notas);
  await model.updateConversionPaid(conv.id, payment.amount);
  await model.linkPayment(dbRow.id, { leadId: lead.id, conversionId: conv.id, conversionPaymentId: cpId, userId: null, method: 'auto_email_match' });
}

export async function syncStripePayments(projectId, { fullHistory = false } = {}) {
  const apiKey = await getStripeKey(projectId);
  if (!apiKey) throw new Error('Stripe API key no configurada para este proyecto');

  const state = await model.getSyncState(projectId);
  let createdGte = null;
  if (!fullHistory && state?.last_synced_until) {
    // sincronización incremental: desde la última fecha − 1 hora (overlap por si quedó algo)
    createdGte = Math.floor(new Date(state.last_synced_until).getTime() / 1000) - 3600;
  }

  let imported = 0;
  let lastCreated = state?.last_synced_until ? Math.floor(new Date(state.last_synced_until).getTime() / 1000) : 0;
  let startingAfter = null;
  let pages = 0;
  const MAX_PAGES = 200; // safety: 100/page * 200 = 20k pagos máx por sync

  while (pages < MAX_PAGES) {
    const params = { limit: 100 };
    if (createdGte) params['created[gte]'] = createdGte;
    if (startingAfter) params.starting_after = startingAfter;

    const data = await stripeGet(apiKey, '/v1/charges', params);
    if (!data.data?.length) break;

    for (const ch of data.data) {
      const payment = chargeToPayment(ch, projectId);
      const dbRow = await model.upsertPayment(payment);
      await autoLinkIfPossible(projectId, payment, dbRow);
      imported++;
      if (ch.created > lastCreated) lastCreated = ch.created;
    }
    if (!data.has_more) break;
    startingAfter = data.data[data.data.length - 1].id;
    pages++;
  }

  await model.upsertSyncState(projectId, {
    last_sync_at: new Date().toISOString(),
    last_full_sync_at: fullHistory ? new Date().toISOString() : (state?.last_full_sync_at || null),
    last_synced_until: lastCreated ? new Date(lastCreated * 1000).toISOString() : (state?.last_synced_until || null),
    total_imported: (state?.total_imported || 0) + imported,
    last_error: null,
  });

  return { imported, pages };
}

export async function manualLink(stripePaymentId, { leadId, conversionId, userId }) {
  const fecha = new Date().toISOString().slice(0, 10);
  let cpId = null;
  if (conversionId) {
    const { rows } = await import('../../shared/config/db.js').then(m => m.query(`SELECT amount FROM stripe_payments WHERE id=$1`, [stripePaymentId]));
    const amount = Number(rows[0]?.amount || 0);
    if (amount > 0) {
      cpId = await model.createConversionPayment(conversionId, amount, fecha, `Asociado manual desde Stripe payment #${stripePaymentId}`);
      await model.updateConversionPaid(conversionId, amount);
    }
  }
  await model.linkPayment(stripePaymentId, { leadId, conversionId, conversionPaymentId: cpId, userId, method: 'manual' });
}
