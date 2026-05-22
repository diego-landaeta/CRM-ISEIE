import * as model from './project.model.js';
import { createProjectSchema, updateProjectSchema } from './project.validation.js';
import { AppError } from '../../shared/utils/AppError.js';

export async function list(req, res, next) {
  try {
    const projects = await model.findAll({ active: req.query.active });
    res.json({ success: true, data: projects });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const project = await model.findById(id);
    if (!project) throw new AppError('Proyecto no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: project });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const exists = await model.slugExists(parsed.data.slug);
    if (exists) throw new AppError('El slug ya existe', 409, 'SLUG_EXISTS');
    const project = await model.create(parsed.data);
    res.status(201).json({ success: true, data: project });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const updated = await model.update(id, parsed.data);
    if (!updated) throw new AppError('No se actualizo', 400, 'NO_FIELDS');
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function regenerateKey(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const newKey = await model.regenerateWebhookKey(id);
    if (!newKey) throw new AppError('Proyecto no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: { webhook_api_key: newKey } });
  } catch (err) { next(err); }
}
