import crypto from 'crypto';
import * as model from './matricula.model.js';
import { createSchema, updateSchema, setEstadoSchema } from './matricula.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { saveLocal, getLocal, deleteLocal } from '../../shared/services/localStorage.service.js';

export async function list(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    if (!projectId) throw new AppError('projectId requerido', 400, 'PROJECT_REQUIRED');
    const data = await model.findAll({
      projectId,
      estado: req.query.estado,
      search: req.query.search,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 50,
    });
    const stats = await model.getStats(projectId);
    res.json({ success: true, data: data.matriculas, pagination: { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages }, stats });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const m = await model.findById(parseInt(req.params.id));
    if (!m) throw new AppError('Matricula no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: m });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    if (parsed.data.conversion_id) {
      const exists = await model.findByConversion(parsed.data.conversion_id);
      if (exists) throw new AppError('Ya existe matricula para esta conversion', 409, 'DUPLICATE');
    }
    const created = await model.create(parsed.data);
    res.status(201).json({ success: true, data: created });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    const updated = await model.update(parseInt(req.params.id), parsed.data);
    if (!updated) throw new AppError('Matricula no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const m = await model.findById(parseInt(req.params.id));
    if (!m) throw new AppError('Matricula no encontrada', 404, 'NOT_FOUND');
    if (m.dni_doc_key) { try { await deleteLocal(m.dni_doc_key); } catch {} }
    if (m.titulo_doc_key) { try { await deleteLocal(m.titulo_doc_key); } catch {} }
    if (m.firma_key) { try { await deleteLocal(m.firma_key); } catch {} }
    await model.remove(m.id);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function setEstado(req, res, next) {
  try {
    const parsed = setEstadoSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    if (parsed.data.estado === 'rechazada' && !parsed.data.motivo_rechazo) {
      throw new AppError('motivo_rechazo requerido al rechazar', 400, 'MOTIVO_REQUIRED');
    }
    const updated = await model.setEstado(parseInt(req.params.id), parsed.data.estado, req.user.id, parsed.data.motivo_rechazo);
    if (!updated) throw new AppError('Matricula no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

const TIPOS_DOC = ['dni', 'titulo', 'firma'];

export async function uploadDoc(req, res, next) {
  try {
    const tipo = req.params.tipo;
    if (!TIPOS_DOC.includes(tipo)) throw new AppError('Tipo invalido', 400, 'INVALID_TYPE');
    if (!req.file) throw new AppError('Archivo requerido', 400, 'FILE_REQUIRED');
    const m = await model.findById(parseInt(req.params.id));
    if (!m) throw new AppError('Matricula no encontrada', 404, 'NOT_FOUND');
    const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const keyMap = { dni: 'dni_doc_key', titulo: 'titulo_doc_key', firma: 'firma_key' };
    const urlMap = { dni: 'dni_doc_url', titulo: 'titulo_doc_url', firma: 'firma_url' };
    const oldKey = m[keyMap[tipo]];
    if (oldKey) { try { await deleteLocal(oldKey); } catch {} }
    const key = `matriculas/${m.project_id}/m-${m.id}-${tipo}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    await saveLocal(key, req.file.buffer);
    const url = `/api/matriculas/${m.id}/doc/${tipo}?v=${Date.now()}`;
    const updated = await model.update(m.id, { [keyMap[tipo]]: key, [urlMap[tipo]]: url });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function getDoc(req, res, next) {
  try {
    const tipo = req.params.tipo;
    if (!TIPOS_DOC.includes(tipo)) throw new AppError('Tipo invalido', 400, 'INVALID_TYPE');
    const m = await model.findById(parseInt(req.params.id));
    const keyMap = { dni: 'dni_doc_key', titulo: 'titulo_doc_key', firma: 'firma_key' };
    if (!m || !m[keyMap[tipo]]) return res.status(404).end();
    const ext = m[keyMap[tipo]].split('.').pop().toLowerCase();
    const mime = ext === 'pdf' ? 'application/pdf' : (ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg'));
    const { buffer } = await getLocal(m[keyMap[tipo]]);
    res.setHeader('Content-Type', mime);
    res.send(buffer);
  } catch (err) { next(err); }
}
