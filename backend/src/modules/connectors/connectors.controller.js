import { z } from 'zod';
import * as model from './connectors.model.js';
import * as service from './connectors.service.js';
import { AppError } from '../../shared/utils/AppError.js';

const VALID_TYPES = ['woocommerce_products', 'woocommerce_orders', 'wp_rest', 'acf', 'custom_api'];
const VALID_DESTINATIONS = ['product', 'lead', 'matricula', 'category'];

const createSchema = z.object({
  project_id:   z.number().int().positive(),
  type:         z.enum(VALID_TYPES),
  label:        z.string().min(1).max(150),
  destination:  z.enum(VALID_DESTINATIONS).default('product'),
  config:       z.record(z.any()).optional(),
  field_mapping: z.record(z.any()).optional(),
});

const updateSchema = z.object({
  label:         z.string().min(1).max(150).optional(),
  destination:   z.enum(VALID_DESTINATIONS).optional(),
  config:        z.record(z.any()).optional(),
  field_mapping: z.record(z.any()).optional(),
  active:        z.boolean().optional(),
});

function pid(req) {
  const p = parseInt(req.query.projectId);
  if (isNaN(p) || p <= 0) throw new AppError('projectId requerido', 400, 'PROJECT_REQUIRED');
  return p;
}
function cid(req) {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id <= 0) throw new AppError('id invalido', 400, 'INVALID_ID');
  return id;
}

export async function list(req, res, next) {
  try { res.json({ success: true, data: await model.listByProject(pid(req)) }); } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const c = await model.findById(cid(req));
    if (!c) throw new AppError('No encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: c });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const c = await model.create(parsed.data);
    res.status(201).json({ success: true, data: c });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const c = await model.update(cid(req), parsed.data);
    if (!c) throw new AppError('No encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: c });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    await model.remove(cid(req));
    res.json({ success: true });
  } catch (err) { next(err); }
}

// Trae 1-3 items de muestra del API externo + sugerencias de mapping
export async function preview(req, res, next) {
  try {
    const data = await service.previewConnector(cid(req));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// Ejecuta el import asincrono (responde 202 con jobId conceptual)
export async function runImport(req, res, next) {
  try {
    const id = cid(req);
    res.status(202).json({ success: true, data: { connector_id: id, status: 'running' } });
    // Background
    setImmediate(async () => {
      try {
        await service.importFromConnector(id);
        // El log ya queda en service. El frontend hace polling de last_sync_at + last_sync_status
      } catch (err) {
        // ya se registra en recordSync 'error'
      }
    });
  } catch (err) { next(err); }
}
