import * as model from './project.model.js';
import * as service from './project.service.js';
import { createProjectSchema, updateProjectSchema, createSociedadSchema } from './project.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { query } from '../../shared/config/db.js';
import { veTodoElCrm, exigirCampusSuyo } from '../../shared/utils/ambito.js';

// `projects.edit` de serie es de soporte. A un admin de empresa se le puede
// dar como excepción para configurar SUS campus (datos, módulos, columnas,
// clave del webhook): otro campus es un 404. Lo que no puede es pasar un campus
// a otra empresa: eso mueve sus datos y su equipo de una empresa a otra, y lo
// hace quien ve el CRM entero.
async function exigirQuePuedaConfigurar(req, id, cambios = {}) {
  await exigirCampusSuyo(req, id, 'Proyecto no encontrado');
  if (veTodoElCrm(req.user) || cambios.sociedad_emisora_id === undefined) return;
  const { rows: [p] } = await query('SELECT sociedad_emisora_id FROM projects WHERE id = $1', [id]);
  const antes = p?.sociedad_emisora_id == null ? null : Number(p.sociedad_emisora_id);
  if (antes !== cambios.sociedad_emisora_id) {
    throw new AppError('Pasar un campus a otra empresa lo hace el superadmin', 403, 'FORBIDDEN');
  }
}

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
    // Por el servicio: el campus llega a los admins de su empresa (#220).
    const project = await service.crear(parsed.data);
    res.status(201).json({ success: true, data: project });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    await exigirQuePuedaConfigurar(req, id, parsed.data);
    const updated = await service.actualizar(id, parsed.data);
    if (!updated) throw new AppError('No se actualizo', 400, 'NO_FIELDS');
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function listSociedades(req, res, next) {
  try {
    const rows = await model.listSociedades();
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

export async function createSociedad(req, res, next) {
  try {
    const parsed = createSociedadSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const soc = await model.createSociedad(parsed.data);
    res.status(201).json({ success: true, data: soc });
  } catch (err) { next(err); }
}

export async function regenerateKey(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    await exigirQuePuedaConfigurar(req, id);
    const newKey = await model.regenerateWebhookKey(id);
    if (!newKey) throw new AppError('Proyecto no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: { webhook_api_key: newKey } });
  } catch (err) { next(err); }
}
