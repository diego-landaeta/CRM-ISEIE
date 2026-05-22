import * as model from './expense.model.js';
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
    const expense = await model.createExpense(parsed.data, req.user.userId);
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
    const updated = await model.updateExpense(id, parsed.data);
    if (!updated) throw new AppError('Sin cambios', 400, 'NO_FIELDS');
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteExpense(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    await model.deleteExpense(id);
    res.json({ success: true, data: { message: 'Gasto eliminado' } });
  } catch (err) { next(err); }
}
