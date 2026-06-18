import * as service from './change-request.service.js';
import * as model from './change-request.model.js';
import { AppError } from '../../shared/utils/AppError.js';
import fs from 'fs';
import path from 'path';
import multer from 'multer';

const UPLOAD_DIR = path.resolve('./uploads/rfc');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {}

// Multer con disk storage específico para RFC (fotos/docs). Acepta imágenes
// comunes + PDF. Tope de 15MB por archivo (los RFC pueden traer fotos densas).
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    cb(null, `rfc${req.params.id || 'new'}_${ts}_${safe}`);
  },
});
const ALLOWED = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf',
]);
export const uploadRfc = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(new AppError('Tipo de archivo no permitido (PNG/JPG/WEBP/PDF)', 400, 'INVALID_TYPE'));
    cb(null, true);
  },
  limits: { fileSize: 15 * 1024 * 1024 },
}).single('file');

export async function list(req, res, next) {
  try {
    const projectId = req.query.projectId ? parseInt(req.query.projectId) : null;
    const estado = req.query.estado || null;
    const result = await service.list({
      projectId, userId: req.user.userId, role: req.user.role, estado,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const { projectId, titulo, ...payload } = req.body || {};
    const result = await service.create({
      projectId: parseInt(projectId),
      titulo,
      solicitanteUserId: req.user.userId,
      ...payload,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const result = await service.getById(id, { userId: req.user.userId, role: req.user.role });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const result = await service.update(id, req.body || {}, { userId: req.user.userId, role: req.user.role });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function approve(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const { rol, decision, timing, firmaData, comentarios } = req.body || {};
    const result = await service.approve(id, {
      rol, decision, timing, firmaData, comentarios,
      userId: req.user.userId, userRole: req.user.role,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function getApprovalSignature(req, res, next) {
  try {
    const aid = parseInt(req.params.approvalId);
    const firmaData = await service.getApprovalSignature(aid, { userId: req.user.userId, role: req.user.role });
    res.json({ success: true, data: { firma_data: firmaData } });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const result = await service.remove(id, { role: req.user.role });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function reopen(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const { motivo } = req.body || {};
    const result = await service.reopen(id, { userId: req.user.userId, role: req.user.role, motivo });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function uploadAttachment(req, res, next) {
  try {
    const rfcId = parseInt(req.params.id);
    if (!req.file) throw new AppError('Archivo requerido', 400, 'MISSING_FILE');
    // multer ya guardó el archivo en UPLOAD_DIR. Persistimos metadata.
    const result = await service.addAttachment({
      rfcId,
      filePath: req.file.path,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    }, { userId: req.user.userId });
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function downloadAttachment(req, res, next) {
  try {
    const aid = parseInt(req.params.attachmentId);
    const att = await service.getAttachment(aid);
    if (!att) throw new AppError('Adjunto no encontrado', 404, 'NOT_FOUND');
    if (!fs.existsSync(att.file_path)) throw new AppError('Archivo no encontrado en disco', 404, 'FILE_MISSING');
    res.download(att.file_path, att.file_name);
  } catch (err) { next(err); }
}

export async function deleteAttachment(req, res, next) {
  try {
    const aid = parseInt(req.params.attachmentId);
    const filePath = await service.deleteAttachment(aid);
    if (filePath) { try { fs.unlinkSync(filePath); } catch (_) {} }
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
}
