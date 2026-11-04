import { proyectosDelAmbito, exigirCampusSuyo } from '../../shared/utils/ambito.js';
import { AppError } from '../../shared/utils/AppError.js';
import { createPayableSchema, updatePayableSchema, paymentSchema } from './payable.validation.js';
import * as model from './payable.model.js';

export async function list(req, res, next) {
  try {
    const { estado, from, to } = req.query;
    // De sus campus (Diego, 04/11; antes el campus de la dirección sin comprobar y, sin él, todo el CRM).
    const rows = await model.list({
      ...(await proyectosDelAmbito(req)),
      estado: estado || null,
      from: from || null,
      to: to || null,
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

export async function stats(req, res, next) {
  try {
    const { from, to } = req.query;
    // De sus campus (Diego, 04/11; antes el campus de la dirección sin comprobar y, sin él, todo el CRM).
    const s = await model.getStats({
      ...(await proyectosDelAmbito(req)),
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
    // De sus campus, como la lista (Diego, 04/11): la de otro, como si no existiera.
    await exigirCampusSuyo(req, p.project_id, 'Factura no encontrada');
    const payments = await model.getPayments(p.id);
    res.json({ success: true, data: { ...p, payments } });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createPayableSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Datos invalidos', 400, 'VALIDATION_ERROR');
    const p = await model.create(parsed.data, req.user.userId);
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
    const pay = await model.addPayment(Number(req.params.id), parsed.data, req.user.userId);
    if (!pay) throw new AppError('Factura no encontrada', 404, 'NOT_FOUND');
    res.status(201).json({ success: true, data: pay });
  } catch (err) {
    if (err.message === 'Pago excede el importe pendiente') {
      return next(new AppError(err.message, 400, 'PAYMENT_EXCEEDS_PENDING'));
    }
    next(err);
  }
}
