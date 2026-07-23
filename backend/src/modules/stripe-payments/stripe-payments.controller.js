import * as model from './stripe-payments.model.js';
import * as service from './stripe-payments.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

function projectId(req) {
  const pid = Number(req.query.projectId || req.body?.projectId);
  if (!pid) throw new AppError('projectId requerido', 400, 'BAD_REQUEST');
  return pid;
}

export async function list(req, res, next) {
  try {
    const pid = projectId(req);
    const { status, linked, search, from, to, page, limit, facturables } = req.query;
    const data = await model.listPayments({
      projectId: pid, status, linked, search, from, to,
      facturables: facturables === '1' || facturables === 'true',
      page: Number(page) || 1,
      limit: Math.min(Number(limit) || 50, 200),
    });
    res.json({ success: true, data: data.rows, pagination: { total: data.total, page: Number(page) || 1, limit: Number(limit) || 50 } });
  } catch (e) { next(e); }
}

export async function stats(req, res, next) {
  try {
    const pid = projectId(req);
    const s = await model.getStats(pid);
    const sync = await model.getSyncState(pid);
    res.json({ success: true, data: { ...s, sync } });
  } catch (e) { next(e); }
}

export async function sync(req, res, next) {
  try {
    const pid = projectId(req);
    const fullHistory = req.body?.fullHistory === true || req.query?.fullHistory === 'true';
    const result = await service.syncStripePayments(pid, { fullHistory });
    res.json({ success: true, data: result });
  } catch (e) {
    logger.error({ e: e.message }, 'sync stripe failed');
    next(e);
  }
}

export async function getOne(req, res, next) {
  try {
    const id = Number(req.params.id);
    const row = await model.getById(id);
    if (!row) throw new AppError('Pago no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: row });
  } catch (e) { next(e); }
}

export async function link(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { leadId, conversionId } = req.body || {};
    if (!leadId && !conversionId) throw new AppError('leadId o conversionId requerido', 400, 'BAD_REQUEST');
    await service.manualLink(id, { leadId, conversionId, userId: req.user?.id });
    res.json({ success: true });
  } catch (e) { next(e); }
}

export async function unlink(req, res, next) {
  try {
    const id = Number(req.params.id);
    await model.linkPayment(id, { leadId: null, conversionId: null, conversionPaymentId: null, userId: req.user?.id, method: null });
    res.json({ success: true });
  } catch (e) { next(e); }
}

export async function updateDispute(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { decision, notes } = req.body || {};
    const allowed = ['pending', 'accept_refund', 'contest', 'won', 'lost', 'closed'];
    if (!allowed.includes(decision)) throw new AppError(`decision debe ser: ${allowed.join(', ')}`, 400, 'BAD_DECISION');
    await service.updateDisputeDecision(id, { decision, notes, userId: req.user?.id });
    res.json({ success: true });
  } catch (e) { next(e); }
}

// Webhook publico - sin auth, verifica firma
export async function webhook(req, res, next) {
  try {
    const pid = Number(req.params.projectId);
    if (!pid) return res.status(400).send('projectId requerido en URL');
    const sigHeader = req.get('stripe-signature');
    const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : null);
    if (!rawBody) {
      logger.warn('Webhook recibido sin rawBody');
      return res.status(400).send('rawBody requerido');
    }
    const secret = await service.getWebhookSecret(pid);
    // Si no hay secret configurado, aceptar pero loggear warning (modo permisivo)
    if (secret) {
      const ok = service.verifyStripeSignature(rawBody, sigHeader, secret);
      if (!ok) return res.status(400).send('Firma invalida');
    } else {
      logger.warn({ projectId: pid }, 'Webhook sin secret configurado - aceptando sin verificar');
    }
    const event = JSON.parse(rawBody);
    const result = await service.handleWebhookEvent(pid, event);
    res.json({ received: true, ...result });
  } catch (e) {
    logger.error({ e: e.message }, 'webhook stripe failed');
    res.status(500).send(`Error: ${e.message}`);
  }
}
