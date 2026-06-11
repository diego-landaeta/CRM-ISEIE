import * as service from './notifications.service.js';
import { AppError } from '../../shared/utils/AppError.js';

export async function list(req, res, next) {
  try {
    const unreadOnly = req.query.unreadOnly === 'true';
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const items = await service.list({ userId: req.user.userId, role: req.user.role, unreadOnly, limit });
    res.json({ success: true, data: items });
  } catch (err) { next(err); }
}

export async function unreadCount(req, res, next) {
  try {
    const count = await service.unreadCount(req.user.userId, req.user.role);
    res.json({ success: true, data: { count } });
  } catch (err) { next(err); }
}

export async function markRead(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const result = await service.markRead(id, req.user.userId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function markAllRead(req, res, next) {
  try {
    const result = await service.markAllRead(req.user.userId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
