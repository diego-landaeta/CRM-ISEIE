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
    const { status, linked, search, from, to, page, limit } = req.query;
    const data = await model.listPayments({
      projectId: pid, status, linked, search, from, to,
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

export async function link(req, res, next) {
  try {
    const pid = projectId(req);
    const id = Number(req.params.id);
    const { leadId, conversionId } = req.body || {};
    if (!leadId && !conversionId) throw new AppError('leadId o conversionId requerido', 400, 'BAD_REQUEST');
    void pid;
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
