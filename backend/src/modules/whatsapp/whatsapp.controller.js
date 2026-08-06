import * as model from './whatsapp.model.js';
import { createSchema, updateSchema } from './whatsapp.validation.js';
import { AppError } from '../../shared/utils/AppError.js';

function proyecto(req) {
  const p = req.query.projectId || req.body?.projectId;
  const n = p ? parseInt(p) : null;
  if (!n) throw new AppError('projectId requerido', 400, 'MISSING_PROJECT');
  return n;
}

const esAdmin = (req) => ['admin', 'superadmin', 'soporte'].includes(req.user.role);

// GET /api/whatsapp/templates?projectId=N
export async function listTemplates(req, res, next) {
  try {
    res.json({ success: true, data: await model.listTemplates({
      projectId: proyecto(req), userId: req.user.userId,
    })});
  } catch (err) { next(err); }
}

// POST /api/whatsapp/templates
export async function createTemplate(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Datos invalidos', 400, 'VALIDATION_ERROR');
    const { projectId, label, body, ambito } = parsed.data;
    // Una compartida la ve todo el equipo, asi que la crea quien manda. Las
    // personales, cualquiera: son suyas.
    if (ambito === 'compartida' && !esAdmin(req)) {
      throw new AppError('Solo un administrador crea plantillas compartidas', 403, 'FORBIDDEN');
    }
    const row = await model.createTemplate({
      projectId, label, body, ambito,
      ownerId: req.user.userId, createdBy: req.user.userId,
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) { next(err); }
}

// Quien puede tocar esta plantilla: la suya siempre; las compartidas, solo admin.
async function permitida(req, id) {
  const t = await model.getTemplate(id);
  if (!t) throw new AppError('Plantilla no encontrada', 404, 'NOT_FOUND');
  const propia = t.ambito === 'personal' && t.owner_id === req.user.userId;
  if (!propia && !esAdmin(req)) throw new AppError('No puedes tocar esta plantilla', 403, 'FORBIDDEN');
  return t;
}

// PATCH /api/whatsapp/templates/:id
export async function updateTemplate(req, res, next) {
  try {
    await permitida(req, parseInt(req.params.id));
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Datos invalidos', 400, 'VALIDATION_ERROR');
    res.json({ success: true, data: await model.updateTemplate(parseInt(req.params.id), parsed.data) });
  } catch (err) { next(err); }
}

// DELETE /api/whatsapp/templates/:id
export async function deleteTemplate(req, res, next) {
  try {
    await permitida(req, parseInt(req.params.id));
    await model.deleteTemplate(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
}

// GET /api/whatsapp/cola?projectId=N&responsableId=&estado=&productoId=&sinContactar=
export async function cola(req, res, next) {
  try {
    // Una gestora ve SU cola, ignorando lo que pida por query. Un admin puede
    // mirar la de quien quiera, o la de todos si no pide a nadie.
    const responsableId = req.user.role === 'gestor'
      ? req.user.userId
      : (req.query.responsableId ? parseInt(req.query.responsableId) : null);

    res.json({ success: true, data: await model.cola({
      projectId: proyecto(req),
      responsableId,
      estado: req.query.estado || null,
      productoId: req.query.productoId ? parseInt(req.query.productoId) : null,
      soloSinContactar: req.query.sinContactar === '1' || req.query.sinContactar === 'true',
      limite: Math.min(300, parseInt(req.query.limite) || 100),
    })});
  } catch (err) { next(err); }
}
