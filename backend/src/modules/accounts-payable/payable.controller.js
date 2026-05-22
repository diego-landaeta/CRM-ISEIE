import { AppError } from '../../shared/utils/AppError.js';
import { createPayableSchema, updatePayableSchema, paymentSchema } from './payable.validation.js';
import * as model from './payable.model.js';

export async function list(req, res, next) {
  try {
    const { projectId, estado, from, to } = req.query;
    const rows = await model.list({
      projectId: projectId ? Number(projectId) : null,
      estado: estado || null,
      from: from || null,
      to: to || null,
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

export async function stats(req, res, next) {
  try {
    const { projectId, from, to } = req.query;
    const s = await model.getStats({
      projectId: projectId ? Number(projectId) : null,
      from: from || null,
      to: to || null,
    });
    res.json({ success: true, data: s });
  } catch (err) { next(err); }
}

export async function getOne(req, res, next) {
  try {
    const p = await model.getById(Number(req.params.id));
    if (!p) throw new AppError('Factura no encontrada', 404, 'NOT_FOUND');
    const payments = await model.getPayments(p.id);
    res.json({ success: true, data: { ...p, payments } });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createPayableSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Datos invalidos', 400, 'VALIDATION_ERROR');
    const p = await model.create(parsed.data, req.user.id);
    res.status(201).json({ success: true, data: p });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const parsed = updatePayableSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Datos invalidos', 400, 'VALIDATION_ERROR');
    const p = await model.update(Number(req.params.id), parsed.data);
    if (!p) throw new AppError('Factura no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: p });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    await model.remove(Number(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function addPayment(req, res, next) {
  try {
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Datos invalidos', 400, 'VALIDATION_ERROR');
    const pay = await model.addPayment(Number(req.params.id), parsed.data, req.user.id);
    if (!pay) throw new AppError('Factura no encontrada', 404, 'NOT_FOUND');
    res.status(201).json({ success: true, data: pay });
  } catch (err) {
    if (err.message === 'Pago excede el importe pendiente') {
      return next(new AppError(err.message, 400, 'PAYMENT_EXCEEDS_PENDING'));
    }
    next(err);
  }
}
