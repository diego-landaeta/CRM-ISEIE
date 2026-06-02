import * as salesService from './sales.service.js';
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
    const result = await salesService.getTopProducts({ projectId, limit, days });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
