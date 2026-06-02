import * as salesService from './sales.service.js';
import * as goalsService from './sales.goals.js';
import { createSaleSchema } from './sales.validation.js';
import { AppError } from '../../shared/utils/AppError.js';

export async function create(req, res, next) {
  try {
    const parsed = createSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const result = await salesService.createSale(parsed.data, req.user);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function topProducts(req, res, next) {
  try {
    const projectId = req.query.projectId ? parseInt(req.query.projectId) : null;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const days = req.query.days ? parseInt(req.query.days) : null; // null = all-time
    let responsableId = req.query.responsableId ? parseInt(req.query.responsableId) : null;
    // Gestor: forzar su propio responsableId (no puede consultar el de otros)
    if (req.user.role === 'gestor') responsableId = req.user.userId;
    const result = await salesService.getTopProducts({ projectId, limit, days, responsableId });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// GET /api/sales/gestores-stats?periodo=YYYY-MM&projectId=N — ventas + metas por gestor
export async function gestoresStats(req, res, next) {
  try {
    const projectId = req.query.projectId ? parseInt(req.query.projectId) : null;
    const periodo = req.query.periodo || null;
    const result = await goalsService.getGestoresStats({ projectId, periodo });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// GET /api/sales/my-stats — el propio gestor consulta su progreso
export async function myStats(req, res, next) {
  try {
    const projectId = req.query.projectId ? parseInt(req.query.projectId) : null;
    const periodo = req.query.periodo || null;
    const result = await goalsService.getMyStats(req.user.userId, { projectId, periodo });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// POST /api/sales/goals — gestor setea su propia meta, admin puede setear cualquier
export async function setGoal(req, res, next) {
  try {
    const { user_id, project_id, periodo_yyyymm, meta_ventas, meta_facturacion, notas } = req.body || {};
    if (!user_id) throw new AppError('user_id requerido', 400, 'MISSING_USER');
    const result = await goalsService.setGoal({
      user_id: parseInt(user_id),
      project_id: project_id ? parseInt(project_id) : null,
      periodo_yyyymm,
      meta_ventas: Number(meta_ventas),
      meta_facturacion: Number(meta_facturacion),
      notas: notas || null,
    }, req.user);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

// DELETE /api/sales/goals/:id
export async function deleteGoal(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const result = await goalsService.deleteGoal(id, req.user);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
