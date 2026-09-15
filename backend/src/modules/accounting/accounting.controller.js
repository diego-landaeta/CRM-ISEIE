import * as model from './accounting.model.js';
import {
  createExpenseSchema,
  updateExpenseSchema,
  listExpensesSchema,
  accountingDashboardSchema,
} from './expense.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { saveLocal, getLocal, deleteLocal } from '../../shared/services/localStorage.service.js';
import crypto from 'crypto';

const ALLOWED_COMPROBANTE_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
function extFromMime(mime) {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

// ---------- EXPENSES ----------

export async function createExpense(req, res, next) {
  try {
    const parsed = createExpenseSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const expense = await model.createExpense(parsed.data, req.user.userId);
    res.status(201).json({ success: true, data: expense });
  } catch (err) { next(err); }
}

// GET /accounting/receivable — cuentas por cobrar con filtros gestora/proyecto/periodo.
// El gestor solo ve las suyas (se fuerza su responsableId).
export async function receivable(req, res, next) {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : null;
    let responsableId = req.query.responsableId ? Number(req.query.responsableId) : null;
    if (req.user.role === 'gestor') responsableId = req.user.userId; // seguridad
    const from = req.query.from || null;
    const to = req.query.to || null;
    const data = await model.getReceivable({ projectId, responsableId, from, to });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function listExpenses(req, res, next) {
  try {
    const parsed = listExpensesSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const result = await model.listExpenses(parsed.data);
    res.json({
      success: true,
      data: result.expenses,
      pagination: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages },
    });
  } catch (err) { next(err); }
}

export async function getExpense(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const expense = await model.findExpenseById(id);
    if (!expense) throw new AppError('Gasto no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: expense });
  } catch (err) { next(err); }
}

export async function updateExpense(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = updateExpenseSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const updated = await model.updateExpense(id, parsed.data);
    if (!updated) throw new AppError('Sin cambios', 400, 'NO_FIELDS');
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteExpense(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    // Antes de borrar el expense, borrar el comprobante del disco si existe.
    const existing = await model.findExpenseById(id);
    if (existing?.comprobante_key) {
      try { await deleteLocal(`expenses/${existing.comprobante_key}`); } catch (err) {
        logger.warn({ err: err.message, key: existing.comprobante_key }, 'No se pudo borrar comprobante (no crítico)');
      }
    }
    await model.deleteExpense(id);
    res.json({ success: true, data: { message: 'Gasto eliminado' } });
  } catch (err) { next(err); }
}

// ---------- COMPROBANTE ----------

export async function uploadComprobante(req, res, next) {
  try {
    if (!req.file) throw new AppError('Archivo requerido (campo "file")', 400, 'FILE_REQUIRED');
    if (!ALLOWED_COMPROBANTE_MIMES.has(req.file.mimetype)) {
      throw new AppError('Formato no permitido. Solo PDF, JPG, PNG, WEBP.', 400, 'INVALID_MIME');
    }
    const ext = extFromMime(req.file.mimetype);
    const hash = crypto.randomBytes(8).toString('hex');
    const key = `${Date.now()}-${hash}.${ext}`;
    await saveLocal(`expenses/${key}`, req.file.buffer);
    const baseUrl = process.env.API_PUBLIC_BASE_URL || '';
    res.status(201).json({
      success: true,
      data: {
        comprobante_url: `${baseUrl}/api/accounting/expenses/comprobante/${key}`,
        comprobante_key: key,
        comprobante_mime: req.file.mimetype,
        comprobante_size_bytes: req.file.size,
      },
    });
  } catch (err) { next(err); }
}

export async function downloadComprobante(req, res, next) {
  try {
    const key = req.params.key || '';
    if (!key || key.includes('/') || key.includes('..') || key.includes('\\')) {
      throw new AppError('Key inválida', 400, 'INVALID_KEY');
    }
    let buffer;
    try {
      const r = await getLocal(`expenses/${key}`);
      buffer = r.buffer;
    } catch (err) {
      if (err.code === 'ENOENT') throw new AppError('Comprobante no encontrado', 404, 'NOT_FOUND');
      throw err;
    }
    const ext = key.split('.').pop()?.toLowerCase();
    const ctype = ext === 'pdf' ? 'application/pdf'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : 'application/octet-stream';
    res.setHeader('Content-Type', ctype);
    res.setHeader('Content-Disposition', `inline; filename="${key}"`);
    res.send(buffer);
  } catch (err) { next(err); }
}

// ---------- DASHBOARD ----------

export async function dashboard(req, res, next) {
  try {
    const parsed = accountingDashboardSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const stats = await model.getDashboardStats(parsed.data);
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
}
