import * as model from './channel.model.js';
import { AppError } from '../../shared/utils/AppError.js';
import { z } from 'zod';

const channelSchema = z.object({
  project_id: z.coerce.number().int().positive(),
  label: z.string().min(1).max(100),
  url: z.string().url(),
  icon: z.string().max(50).optional(),
  position: z.coerce.number().int().min(0).optional(),
});

const updateSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  icon: z.string().max(50).optional(),
  position: z.coerce.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

export async function list(req, res, next) {
  try {
    const projectId = Number(req.query.projectId);
    if (!projectId) throw new AppError('projectId requerido', 400, 'MISSING_PROJECT');
    const data = await model.findByProject(projectId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const body = channelSchema.parse(req.body);
    const channel = await model.create(body);
    res.status(201).json({ success: true, data: channel });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body);
    const channel = await model.update(Number(req.params.id), body);
    if (!channel) throw new AppError('Canal no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: channel });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    await model.remove(Number(req.params.id));
    res.json({ success: true, data: { message: 'Canal eliminado' } });
  } catch (err) { next(err); }
}
