import * as model from './expense.model.js';
import * as service from './expense.service.js';
import {
  createExpenseSchema,
  updateExpenseSchema,
  listExpensesSchema,
} from './expense.validation.js';
import { AppError } from '../../shared/utils/AppError.js';

// ---------- EXPENSES ----------

export async function createExpense(req, res, next) {
  try {
    const parsed = createExpenseSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const expense = await service.create(parsed.data, req.user.userId);
    res.status(201).json({ success: true, data: expense });
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
    const updated = await service.update(id, parsed.data);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteExpense(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    await service.remove(id);
    res.json({ success: true, data: { message: 'Gasto eliminado' } });
  } catch (err) { next(err); }
}

// ---------- COMPROBANTE ----------

/**
 * POST /api/expenses/upload-comprobante
 * Upload del archivo de comprobante. Devuelve {comprobante_url, key, mime, size}
 * que el frontend luego anexa al payload del create/update del expense.
 *
 * Multer ya parseó el archivo en req.file (middleware `uploadImageOrPdf`).
 */
export async function uploadComprobante(req, res, next) {
  try {
    if (!req.file) throw new AppError('Archivo requerido (campo "file")', 400, 'FILE_REQUIRED');
    const baseUrl = process.env.API_PUBLIC_BASE_URL || ''; // ej. https://crm.iseie.com (relativo si vacío)
    const result = await service.uploadComprobante({
      buffer: req.file.buffer,
      mime: req.file.mimetype,
      size: req.file.size,
      baseUrl,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

/**
 * GET /api/expenses/comprobante/:key
 * Descarga del comprobante. Key viene en la URL, validada para evitar path traversal.
 */
export async function downloadComprobante(req, res, next) {
  try {
    const key = decodeURIComponent(req.params.key || '');
    const { buffer } = await service.downloadComprobante(key);
    // Inferir mime del expense que la usa, si está, para devolver Content-Type adecuado.
    // (Aquí mantengo octet-stream por defecto; el cliente puede mostrarlo según ext.)
    const ext = key.split('.').pop()?.toLowerCase();
    const ctype = ext === 'pdf' ? 'application/pdf'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : 'application/octet-stream';
    res.setHeader('Content-Type', ctype);
    res.setHeader('Content-Disposition', `inline; filename="${key.split('/').pop()}"`);
    res.send(buffer);
  } catch (err) { next(err); }
}
