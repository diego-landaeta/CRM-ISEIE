import * as service from './meta-ads.service.js';
import { AppError } from '../../shared/utils/AppError.js';

function pid(req) {
  const v = req.query.projectId || req.body?.project_id;
  const n = parseInt(v);
  if (!n || isNaN(n)) throw new AppError('projectId requerido', 400, 'MISSING_PROJECT');
  return n;
}

export async function getAccount(req, res, next) {
  try {
    const account = await service.getAccount(pid(req));
    res.json({ success: true, data: account });
  } catch (err) { next(err); }
}

export async function connect(req, res, next) {
  try {
    const { project_id, ad_account_id, access_token } = req.body || {};
    const result = await service.connect({
      project_id: parseInt(project_id),
      ad_account_id,
      access_token,
      userId: req.user.userId,
    });
    res.status(201).json({ success: true, data: { ...result, access_token: undefined } });
  } catch (err) { next(err); }
}

export async function updateToken(req, res, next) {
  try {
    const { project_id, access_token } = req.body || {};
    const result = await service.updateToken({
      project_id: parseInt(project_id),
      access_token,
    });
    res.json({ success: true, data: { rotated: result.rotated, ad_account_nombre: result.validation?.nombre } });
  } catch (err) { next(err); }
}

export async function disconnect(req, res, next) {
  try {
    const result = await service.disconnect(pid(req));
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function syncNow(req, res, next) {
  try {
    const result = await service.syncIncremental(pid(req));
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function backfill(req, res, next) {
  try {
    const days = Math.min(parseInt(req.body?.days || 90), 365);
    // Lanza en background y responde inmediatamente
    const projectId = pid(req);
    setImmediate(() => service.runBackfill(projectId, days).catch(() => {}));
    res.json({ success: true, data: { started: true, days, message: 'Backfill iniciado en background. Recarga en unos minutos.' } });
  } catch (err) { next(err); }
}

export async function listCampaigns(req, res, next) {
  try {
    const result = await service.listCampaignsForUI({
      projectId: pid(req),
      status: req.query.status || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function dashboard(req, res, next) {
  try {
    const result = await service.getDashboard({
      projectId: pid(req),
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function listAdSets(req, res, next) {
  try {
    const result = await service.listAdSetsForUI({
      projectId: pid(req),
      campaignId: req.params.campaignId,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function listAds(req, res, next) {
  try {
    const result = await service.listAdsForUI({
      projectId: pid(req),
      adsetId: req.params.adsetId,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function campaignDetail(req, res, next) {
  try {
    const result = await service.getCampaignDetail({
      projectId: pid(req),
      campaignId: req.params.campaignId,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function listAssociations(req, res, next) {
  try {
    const result = await service.listAssociations(pid(req), req.query.campaignId || null);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function setAssociations(req, res, next) {
  try {
    const { project_id, campaign_id, product_ids } = req.body || {};
    if (!campaign_id) throw new AppError('campaign_id requerido', 400, 'MISSING_CAMPAIGN');
    const result = await service.setAssociations({
      projectId: parseInt(project_id),
      campaignId: campaign_id,
      productIds: Array.isArray(product_ids) ? product_ids.map((id) => parseInt(id)) : [],
      userId: req.user.userId,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function getRoi(req, res, next) {
  try {
    const result = await service.getRoi({
      projectId: pid(req),
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
