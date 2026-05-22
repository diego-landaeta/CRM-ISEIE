import { z } from 'zod';
import * as model from './payroll.model.js';
import { AppError } from '../../shared/utils/AppError.js';

const planSchema = z.object({
  project_id: z.number().int().positive(),
  user_id: z.number().int().positive(),
  modo_fijo: z.number().nonnegative().nullable().optional(),
  modo_horas: z.number().nonnegative().nullable().optional(),
  modo_comisiones: z.boolean().optional(),
  active: z.boolean().optional(),
  notas: z.string().max(2000).optional(),
}).refine(d => d.modo_fijo != null || d.modo_horas != null || d.modo_comisiones === true, { message: 'Al menos un modo (fijo/horas/comisiones)' });

const hoursSchema = z.object({
  project_id: z.number().int().positive(),
  user_id: z.number().int().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horas: z.number().positive(),
  notas: z.string().max(500).optional(),
});

const adjSchema = z.object({
  period_id: z.number().int().positive(),
  tipo: z.enum(['bono', 'anticipo', 'descuento', 'extra']),
  importe: z.number(),
  concepto: z.string().min(1).max(255),
});

function pid(req) { const p = parseInt(req.query.projectId); if (!p) throw new AppError('projectId requerido', 400, 'PROJECT_REQUIRED'); return p; }

export const listPlans = async (req, res, next) => { try { res.json({ success: true, data: await model.listPlans(pid(req)) }); } catch (e) { next(e); } };
export const upsertPlan = async (req, res, next) => {
  try {
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos: ' + parsed.error.issues[0]?.message, 400, 'VALIDATION_ERROR');
    res.json({ success: true, data: await model.upsertPlan(parsed.data) });
  } catch (e) { next(e); }
};
export const deletePlan = async (req, res, next) => { try { await model.deletePlan(parseInt(req.params.id)); res.json({ success: true }); } catch (e) { next(e); } };

export const listHours = async (req, res, next) => {
  try {
    res.json({ success: true, data: await model.listHours({
      projectId: pid(req),
      userId: req.query.userId ? parseInt(req.query.userId) : null,
      from: req.query.from, to: req.query.to,
    })});
  } catch (e) { next(e); }
};
export const createHours = async (req, res, next) => {
  try {
    const parsed = hoursSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    res.status(201).json({ success: true, data: await model.createHours({ ...parsed.data, created_by: req.user.id }) });
  } catch (e) { next(e); }
};
export const deleteHours = async (req, res, next) => { try { await model.deleteHours(parseInt(req.params.id)); res.json({ success: true }); } catch (e) { next(e); } };

export const listPeriods = async (req, res, next) => {
  try {
    res.json({ success: true, data: await model.listPeriods({
      projectId: pid(req),
      userId: req.query.userId ? parseInt(req.query.userId) : null,
      year: req.query.year ? parseInt(req.query.year) : null,
      month: req.query.month ? parseInt(req.query.month) : null,
    })});
  } catch (e) { next(e); }
};
export const getPeriod = async (req, res, next) => {
  try {
    const p = await model.getPeriod(parseInt(req.params.id));
    if (!p) throw new AppError('Periodo no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: p });
  } catch (e) { next(e); }
};
export const generatePeriod = async (req, res, next) => {
  try {
    const { project_id, user_id, year, month } = req.body || {};
    if (!project_id || !user_id || !year || !month) throw new AppError('project_id, user_id, year, month requeridos', 400, 'VALIDATION_ERROR');
    const row = await model.generatePeriod({ projectId: project_id, userId: user_id, year, month, calledBy: req.user.id });
    if (!row) throw new AppError('Sin plan activo para este usuario', 404, 'NO_PLAN');
    res.json({ success: true, data: row });
  } catch (e) { next(e); }
};
export const closePeriod = async (req, res, next) => {
  try {
    const r = await model.closePeriod(parseInt(req.params.id), req.user.id);
    if (!r) throw new AppError('Periodo no encontrado o ya cerrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: r });
  } catch (e) { next(e); }
};
export const payPeriod = async (req, res, next) => {
  try {
    const fecha = req.body?.fecha_pago || new Date().toISOString().slice(0, 10);
    const r = await model.payPeriod(parseInt(req.params.id), fecha);
    if (!r) throw new AppError('Periodo no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: r });
  } catch (e) { next(e); }
};

export const addAdjustment = async (req, res, next) => {
  try {
    const parsed = adjSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    res.status(201).json({ success: true, data: await model.addAdjustment({ ...parsed.data, created_by: req.user.id }) });
  } catch (e) { next(e); }
};
export const deleteAdjustment = async (req, res, next) => { try { await model.deleteAdjustment(parseInt(req.params.id)); res.json({ success: true }); } catch (e) { next(e); } };
