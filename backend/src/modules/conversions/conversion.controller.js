import * as conversionService from './conversion.service.js';
import * as installmentsModel from './installments.model.js';
import {
  createConversionSchema,
  updateConversionSchema,
  createPaymentSchema,
  listConversionsSchema,
} from './conversion.validation.js';
import { AppError } from '../../shared/utils/AppError.js';

export async function create(req, res, next) {
  try {
    const parsed = createConversionSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const conversion = await conversionService.create(parsed.data, req.user.userId);
    res.status(201).json({ success: true, data: conversion });
  } catch (err) { next(err); }
}

export async function list(req, res, next) {
  try {
    const parsed = listConversionsSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const filters = { ...parsed.data };
    // SEGURIDAD: gestor solo ve sus propias ventas, ignora filtro responsableId externo.
    if (req.user.role === 'gestor') {
      filters.responsableId = req.user.userId;
    }
    const result = await conversionService.list(filters);
    res.json({
      success: true,
      data: result.conversions,
      pagination: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages },
    });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const conv = await conversionService.getById(id);
    res.json({ success: true, data: conv });
  } catch (err) { next(err); }
}

export async function listByLead(req, res, next) {
  try {
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) throw new AppError('leadId invalido', 400, 'INVALID_ID');
    const conversions = await conversionService.listByLead(leadId);
    res.json({ success: true, data: conversions });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = updateConversionSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const updated = await conversionService.update(id, parsed.data);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function addPayment(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const result = await conversionService.addPayment(id, parsed.data);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function removePayment(req, res, next) {
  try {
    const paymentId = parseInt(req.params.paymentId);
    if (isNaN(paymentId)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    // RBAC: gestor solo puede borrar pagos de leads asignados a él.
    if (req.user.role === 'gestor') {
      const { getPaymentOwnership } = await import('./conversion.model.js');
      const own = await getPaymentOwnership(paymentId);
      if (!own) throw new AppError('Pago no encontrado', 404, 'PAYMENT_NOT_FOUND');
      if (own.responsable_id !== req.user.userId) {
        throw new AppError('Solo puedes borrar pagos de tus propios clientes', 403, 'FORBIDDEN_PAYMENT');
      }
    }
    const result = await conversionService.removePayment(paymentId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

const DELETE_REASONS = ['duplicada', 'error_carga', 'anulacion_cliente', 'otro'];

export async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const reason = String(req.body?.reason || '').toLowerCase().trim();
    const motivo = req.body?.motivo ? String(req.body.motivo).trim() : null;
    if (!DELETE_REASONS.includes(reason)) {
      throw new AppError(`Motivo requerido (${DELETE_REASONS.join(', ')})`, 400, 'REASON_REQUIRED');
    }
    if (reason === 'otro' && (!motivo || motivo.length < 3)) {
      throw new AppError('Detalle del motivo requerido cuando reason=otro', 400, 'MOTIVO_REQUIRED');
    }
    // RBAC: gestor solo puede borrar conversiones de sus propios leads
    const existing = await conversionService.getById(id);
    if (!existing) throw new AppError('Conversión no encontrada', 404, 'CONVERSION_NOT_FOUND');
    if (req.user.role === 'gestor') {
      const { rows } = await (await import('../../shared/config/db.js')).query(
        `SELECT responsable_id FROM leads WHERE id = $1`, [existing.lead_id]
      );
      if (rows[0]?.responsable_id !== req.user.userId) {
        throw new AppError('Solo puedes borrar conversiones de tus propios clientes', 403, 'FORBIDDEN_CONVERSION');
      }
    }
    const result = await conversionService.remove(id, { reason, motivo, userId: req.user.userId });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ===== INSTALLMENTS (CRM-183) =====

export async function listInstallments(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const rows = await installmentsModel.listByConversion(id);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

export async function generateInstallments(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const { num_cuotas, importe_total, fecha_inicio, installments } = req.body;
    // Modo "cuotas custom": cliente manda array completo con importe + fecha por cuota
    if (Array.isArray(installments) && installments.length > 0) {
      const rows = await installmentsModel.generateInstallments(id, null, null, null, installments);
      return res.json({ success: true, data: rows });
    }
    // Modo "auto": N cuotas iguales mensuales desde fecha_inicio
    if (!num_cuotas || num_cuotas < 2) throw new AppError('num_cuotas debe ser >= 2', 400, 'INVALID');
    if (!importe_total) throw new AppError('importe_total requerido', 400, 'INVALID');
    if (!fecha_inicio) throw new AppError('fecha_inicio requerida', 400, 'INVALID');
    const rows = await installmentsModel.generateInstallments(id, Number(num_cuotas), Number(importe_total), fecha_inicio);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

export async function updateInstallment(req, res, next) {
  try {
    const instId = parseInt(req.params.instId);
    const r = await installmentsModel.update(instId, req.body);
    if (!r) throw new AppError('Cuota no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

export async function payInstallment(req, res, next) {
  try {
    const instId = parseInt(req.params.instId);
    const { fecha_cobro, importe_cobrado, metodo, notas } = req.body;
    if (!fecha_cobro) throw new AppError('fecha_cobro requerida', 400, 'INVALID');
    const r = await installmentsModel.markPaid(instId, { fecha_cobro, importe_cobrado, metodo, notas });
    if (!r) throw new AppError('Cuota no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: r });
  } catch (err) {
    if (err.message === 'Cuota ya cobrada') return next(new AppError(err.message, 400, 'ALREADY_PAID'));
    next(err);
  }
}

export async function deleteInstallment(req, res, next) {
  try {
    const instId = parseInt(req.params.instId);
    await installmentsModel.remove(instId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

// PATCH /installments/:instId/paid  { fecha_cobro?, importe_cobrado? }
// Edita un pago YA realizado (no marcar pagada de nuevo, eso es payInstallment).
export async function editPaidInstallment(req, res, next) {
  try {
    const instId = parseInt(req.params.instId);
    const { fecha_cobro, importe_cobrado } = req.body || {};
    if (!fecha_cobro && importe_cobrado === undefined) {
      throw new AppError('Indica fecha_cobro o importe_cobrado', 400, 'INVALID');
    }
    const r = await installmentsModel.editPaid(instId, { fecha_cobro, importe_cobrado });
    if (!r) throw new AppError('Cuota no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: r });
  } catch (err) {
    if (err.message === 'Cuota no pagada') return next(new AppError(err.message, 400, 'NOT_PAID'));
    next(err);
  }
}

// POST /installments/:instId/unpay
// Deshace el pago, devuelve la cuota a pendiente.
export async function unpayInstallment(req, res, next) {
  try {
    const instId = parseInt(req.params.instId);
    const r = await installmentsModel.unpay(instId);
    if (!r) throw new AppError('Cuota no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: r });
  } catch (err) {
    if (err.message === 'Cuota no estaba pagada') return next(new AppError(err.message, 400, 'NOT_PAID'));
    next(err);
  }
}
