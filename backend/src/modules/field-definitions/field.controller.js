import * as model from './field.model.js';
import { createFieldSchema, updateFieldSchema, reorderFieldsSchema } from './field.validation.js';
import { AppError } from '../../shared/utils/AppError.js';

export async function listByProject(req, res, next) {
  try {
    const projectId = parseInt(req.params.projectId);
    if (isNaN(projectId)) throw new AppError('projectId invalido', 400, 'INVALID_ID');
    const entity = ['lead', 'client', 'product'].includes(req.query.entity) ? req.query.entity : null;
    const fields = await model.listByProject(projectId, entity);
    res.json({ success: true, data: fields });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createFieldSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');

    const exists = await model.keyExists(parsed.data.project_id, parsed.data.entity, parsed.data.field_key);
    if (exists) throw new AppError('Ya existe un campo con esa clave en esta entidad del proyecto', 409, 'KEY_EXISTS');

    const field = await model.create(parsed.data);
    res.status(201).json({ success: true, data: field });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = updateFieldSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const updated = await model.update(id, parsed.data);
    if (!updated) throw new AppError('No se actualizo', 400, 'NO_FIELDS');
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    await model.remove(id);
    res.json({ success: true, data: { message: 'Campo eliminado' } });
  } catch (err) { next(err); }
}

export async function reorder(req, res, next) {
  try {
    const parsed = reorderFieldsSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    await model.reorder(parsed.data.project_id, parsed.data.order);
    res.json({ success: true, data: { message: 'Orden actualizado' } });
  } catch (err) { next(err); }
}
