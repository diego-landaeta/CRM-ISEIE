import { AppError } from '../../shared/utils/AppError.js';
import * as svc from './make.service.js';
import { createWebhookSchema, updateWebhookSchema } from './make.validation.js';

// ============================================================
// ENDPOINT PÚBLICO — recibe payloads de Make
// ============================================================
export async function receive(req, res, next) {
  try {
    const { slug } = req.params;
    const secret = req.headers['x-make-secret'] || req.query.secret;

    // La asesora (responsable) puede venir en 3 sitios además del body:
    //   1) Header X-Asesora-Email / X-Asesora-Nombre
    //   2) Query param ?asesora_email=... / ?asesora_nombre=...
    //   3) Dentro del JSON del body (lo procesa el mapping normal)
    // Cualquiera de las 3 funciona. Los headers/query tienen prioridad sobre el body
    // para que sea fácil inyectar la asesora sin reconstruir el JSON en Make.
    const overrides = {};
    const hdrEmail = req.headers['x-asesora-email'] || req.query.asesora_email;
    const hdrNombre = req.headers['x-asesora-nombre'] || req.query.asesora_nombre;
    if (hdrEmail) overrides.responsable_email = String(hdrEmail);
    if (hdrNombre) overrides.responsable_nombre = String(hdrNombre);

    // Canal también soportado por header/query (X-Canal / ?canal=)
    // Acepta cualquier string razonable; el CRM lo normaliza si matchea
    // (whatsapp, instagram, web, email, meta_ads, google_ads, tiktok_ads,
    //  chatgpt_ia, referido, organico, directo).
    const hdrCanal = req.headers['x-canal'] || req.query.canal;
    if (hdrCanal) overrides.canal = String(hdrCanal).toLowerCase().trim();

    const result = await svc.handleIncoming({
      slug,
      secret: typeof secret === 'string' ? secret : '',
      payload: req.body || {},
      overrides,
      ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
    });
    res.status(result.mode === 'test' ? 200 : 201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ============================================================
// ADMIN — CRUD de webhooks
// ============================================================
export async function list(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    if (isNaN(projectId)) throw new AppError('projectId requerido', 400, 'MISSING_PROJECT');
    const hooks = await svc.model.listByProject(projectId);
    // No exponer el secret al listado — solo en getById/create/rotate
    res.json({ success: true, data: hooks });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const hook = await svc.model.findById(id);
    if (!hook) throw new AppError('Webhook no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: hook });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createWebhookSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const hook = await svc.model.create(parsed.data);
    res.status(201).json({ success: true, data: hook });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const parsed = updateWebhookSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const hook = await svc.model.update(id, parsed.data);
    res.json({ success: true, data: hook });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    await svc.model.remove(id);
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
}

export async function rotateSecret(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const hook = await svc.model.rotateSecret(id);
    res.json({ success: true, data: hook });
  } catch (err) { next(err); }
}

export async function deliveries(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const items = await svc.model.listDeliveries(id, limit);
    res.json({ success: true, data: items });
  } catch (err) { next(err); }
}
