import { AppError } from '../../shared/utils/AppError.js';
import { ruleSchema, ruleUpdateSchema, paySchema } from './commission.validation.js';
import * as model from './commission.model.js';

// ===== RULES (superadmin only via routes) =====
export async function listRules(req, res, next) {
  try {
    const { projectId, userId, productId } = req.query;
    const rows = await model.listRules({
      projectId: projectId ? Number(projectId) : null,
      userId: userId ? Number(userId) : null,
      productId: productId ? Number(productId) : null,
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

export async function createRule(req, res, next) {
  try {
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Invalid', 400, 'VALIDATION_ERROR');
    const r = await model.createRule(parsed.data);
    res.status(201).json({ success: true, data: r });
  } catch (err) { next(err); }
}

export async function updateRule(req, res, next) {
  try {
    const parsed = ruleUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Invalid', 400, 'VALIDATION_ERROR');
    const r = await model.updateRule(Number(req.params.id), parsed.data);
    if (!r) throw new AppError('No encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

export async function deleteRule(req, res, next) {
  try {
    await model.deleteRule(Number(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ===== COMMISSIONS =====
export async function listMine(req, res, next) {
  try {
    const { from, to, estado } = req.query;
    const rows = await model.listCommissions({
      userId: req.user.id,
      estado: estado || null,
      from: from || null,
      to: to || null,
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

export async function listAll(req, res, next) {
  try {
    const { userId, projectId, estado, from, to } = req.query;
    const rows = await model.listCommissions({
      userId: userId ? Number(userId) : null,
      projectId: projectId ? Number(projectId) : null,
      estado: estado || null,
      from: from || null,
      to: to || null,
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

export async function statsMine(req, res, next) {
  try {
    const { from, to } = req.query;
    const s = await model.getStats({
      userId: req.user.id,
      from: from || null,
      to: to || null,
    });
    res.json({ success: true, data: s });
  } catch (err) { next(err); }
}

export async function statsAll(req, res, next) {
  try {
    const { userId, projectId, from, to } = req.query;
    const s = await model.getStats({
      userId: userId ? Number(userId) : null,
      projectId: projectId ? Number(projectId) : null,
      from: from || null,
      to: to || null,
    });
    res.json({ success: true, data: s });
  } catch (err) { next(err); }
}

export async function pay(req, res, next) {
  try {
    const parsed = paySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Invalid', 400, 'VALIDATION_ERROR');
    const c = await model.payCommission(Number(req.params.id), parsed.data.fecha_pago, parsed.data.notas);
    if (!c) throw new AppError('Comision no encontrada o ya pagada', 404, 'NOT_FOUND');
    res.json({ success: true, data: c });
  } catch (err) { next(err); }
}

export async function recalculate(req, res, next) {
  try {
    const r = await model.recalculateCommission(Number(req.params.conversionId));
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}
