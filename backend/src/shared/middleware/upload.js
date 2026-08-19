import multer from 'multer';
import { AppError } from '../utils/AppError.js';

const PDF_MAGIC_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

const storage = multer.memoryStorage();

function fileFilter(_req, file, cb) {
  if (file.mimetype !== 'application/pdf') {
    return cb(new AppError('Solo se permiten archivos PDF', 400, 'INVALID_FILE_TYPE'), false);
  }
  cb(null, true);
}

export const uploadPdf = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
}).single('file');

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

function imageFilter(_req, file, cb) {
  if (!IMAGE_MIMES.has(file.mimetype)) {
    return cb(new AppError('Solo PNG, JPG, WEBP o SVG', 400, 'INVALID_IMAGE_TYPE'), false);
  }
  cb(null, true);
}

export const uploadImage = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).single('file');

const DOC_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'application/pdf',
]);
function docFilter(_req, file, cb) {
  if (!DOC_MIMES.has(file.mimetype)) {
    return cb(new AppError('Solo PDF, PNG, JPG o WEBP', 400, 'INVALID_DOC_TYPE'), false);
  }
  cb(null, true);
}
export const uploadDoc = multer({
  storage,
  fileFilter: docFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
}).single('file');

export function validatePdfMagicBytes(req, _res, next) {
  if (!req.file) {
    return next(new AppError('Archivo PDF requerido', 400, 'FILE_REQUIRED'));
  }

  const header = req.file.buffer.subarray(0, 4);
  if (!header.equals(PDF_MAGIC_BYTES)) {
    return next(new AppError('El archivo no es un PDF valido', 400, 'INVALID_FILE_TYPE'));
  }

  next();
}

// Adjuntos de WhatsApp. Se acepta lo mismo que acepta WhatsApp: audio (notas de
// voz), imagen, video y documento. El limite de 16 MB es el suyo, no nuestro:
// mandar mas grande lo rechaza el propio WhatsApp.
export const uploadWhatsapp = multer({
  storage,
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^(audio|image|video)\//.test(file.mimetype)
      || /^application\/(pdf|msword|vnd\.|zip)/.test(file.mimetype)
      || file.mimetype === 'text/plain';
    cb(ok ? null : new Error('Tipo de archivo no admitido por WhatsApp'), ok);
  },
});
