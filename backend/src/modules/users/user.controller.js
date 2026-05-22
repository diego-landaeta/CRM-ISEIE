import * as userService from './user.service.js';
import * as userModel from './user.model.js';
import { createUserSchema, updateUserSchema, listUsersSchema } from './user.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { saveLocal, getLocal, deleteLocal } from '../../shared/services/localStorage.service.js';
import { mimeToExt, extToMime } from '../../shared/utils/mime.js';
import crypto from 'crypto';

export async function list(req, res, next) {
  try {
    const parsed = listUsersSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const result = await userService.list(parsed.data);
    res.json({
      success: true,
      data: result.users,
      pagination: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages },
    });
  } catch (err) { next(err); }
}

export async function activityLog(req, res, next) {
  try {
    const { userId, action, search } = req.query;
    const limit  = Math.max(1, Math.min(500, parseInt(req.query.limit) || 100));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const result = await userModel.listActivityLog({
      userId: userId ? parseInt(userId) : null,
      action: action || null,
      search: search || null,
      limit,
      offset,
    });
    res.json({ success: true, data: result.items, pagination: { total: result.total, limit, offset } });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const user = await userService.getById(id);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const user = await userService.create(parsed.data);
    res.status(201).json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const user = await userService.update(id, parsed.data);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function deactivate(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const result = await userService.deactivate(id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function reactivate(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const result = await userService.reactivate(id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ===== AVATAR =====

export async function uploadAvatar(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    if (!req.file) throw new AppError('Imagen requerida (campo file)', 400, 'FILE_REQUIRED');

    // Permiso: solo el propio usuario o superadmin
    if (req.user.userId !== id && req.user.role !== 'superadmin') {
      throw new AppError('Solo puedes editar tu propio avatar', 403, 'FORBIDDEN');
    }

    const user = await userModel.findById(id);
    if (!user) throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');

    if (user.avatar_key) {
      try { await deleteLocal(user.avatar_key); } catch {}
    }

    const ext = mimeToExt(req.file.mimetype);
    const key = `avatars/user-${id}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    await saveLocal(key, req.file.buffer);

    const avatarUrl = `/api/users/${id}/avatar?v=${Date.now()}`;
    const updated = await userModel.update(id, { avatar_url: avatarUrl, avatar_key: key });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function getAvatar(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const user = await userModel.findById(id);
    if (!user?.avatar_key) return res.status(404).end();

    const ext = user.avatar_key.split('.').pop();
    const { buffer, size } = await getLocal(user.avatar_key);
    res.setHeader('Content-Type', extToMime(ext));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Length', size);
    res.end(buffer);
  } catch (err) { next(err); }
}

export async function deleteAvatar(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    if (req.user.userId !== id && req.user.role !== 'superadmin') {
      throw new AppError('Solo puedes editar tu propio avatar', 403, 'FORBIDDEN');
    }
    const user = await userModel.findById(id);
    if (!user) throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');
    if (user.avatar_key) {
      try { await deleteLocal(user.avatar_key); } catch {}
    }
    const updated = await userModel.update(id, { avatar_url: null, avatar_key: null });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}
