import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { uploadToR2, deleteFromR2 } from '../../shared/services/r2.service.js';
import { generatePresignedUrl } from '../../shared/utils/presignedUrl.js';
import { sendDocumentEmail, isProjectAutoEmailEnabled } from './documents.email.js';
import * as model from './documents.model.js';
import { generateInvoicePdf, generateCertificatePdf } from './documents.service.js';
import {
  generateSchema, previewSchema, setNumberSchema,
  peekNumberQuerySchema, projectQuerySchema,
} from './documents.validation.js';

// Helper: parsea con Zod y mapea ZodError -> AppError 400 con mensaje legible.
function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new AppError(msg, 400, 'VALIDATION');
  }
  return r.data;
}

// Helper: extrae datos del request para el audit log.
function auditCtx(req, documentId, action, metadata) {
  return {
    documentId,
    action,
    userId: req.user?.id || req.user?.userId || null,
    ip: req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: (req.headers['user-agent'] || '').slice(0, 500),
    metadata,
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Mismo default que documents.service.js — fallback Windows-friendly cuando
// no se setea UPLOAD_DIR en .env (en prod Linux suele ser /var/crm-uploads/...).
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../../uploads/documents');

function formatDate(n, prefix) {
  const y = new Date().getFullYear();
  return `${prefix}-${y}-${String(n).padStart(4, '0')}`;
}

export async function generate(req, res, next) {
  try {
    const body = parse(generateSchema, req.body);
    const { projectId, type, numero_override } = body;
    const data = body.data || {};

    // Si el form pasa un numero manual, reposicionamos el contador antes de
    // pedir el siguiente. La sucesion posterior continua desde ese valor.
    if (numero_override != null && numero_override !== '') {
      await model.setNextNumber(projectId, type, Number(numero_override));
    }

    const n = await model.nextNumber(projectId, type);
    const prefix = type === 'invoice' ? 'FAC' : 'CERT';
    const number = formatDate(n, prefix);
    const filename = `${number}.pdf`;
    data.numero = n;

    const filePath = type === 'invoice'
      ? await generateInvoicePdf(data, filename)
      : await generateCertificatePdf(data, filename);

    // F4-003: subir a R2 (best-effort). Skip si las credenciales son
    // placeholder (e.g. "test" en dev) — evita 3min de retries del AWS SDK
    // contra un host que no resuelve. En prod las credenciales reales hacen
    // que esta condicion sea false y se intente el upload.
    let r2Key = null;
    const r2Configured = process.env.CLOUDFLARE_R2_ACCOUNT_ID
      && process.env.CLOUDFLARE_R2_ACCOUNT_ID !== 'test'
      && process.env.CLOUDFLARE_R2_ACCESS_KEY
      && process.env.CLOUDFLARE_R2_ACCESS_KEY !== 'test';
    if (r2Configured) {
      try {
        const buf = await fs.readFile(filePath);
        r2Key = `documents/${projectId}/${filename}`;
        await uploadToR2(r2Key, buf, 'application/pdf');
      } catch (err) {
        logger.warn({ err: err.message, filename }, 'R2 upload fallo — PDF queda solo en FS');
        r2Key = null;
      }
    }

    const doc = await model.createDocument({
      project_id: projectId,
      type,
      number,
      client_nombre: data.cliente_nombre || data.alumno_nombre || null,
      client_dni: data.cliente_dni || data.alumno_dni || null,
      client_direccion: data.cliente_direccion || null,
      data,
      file_path: filePath,
      r2_key: r2Key,
      created_by: req.user.id,
    });

    await model.logAudit(auditCtx(req, doc.id, 'generated', { number, type, r2: !!r2Key }));
    if (numero_override != null && numero_override !== '') {
      await model.logAudit(auditCtx(req, doc.id, 'number_overridden', {
        override: Number(numero_override),
      }));
    }

    // F4-009: auto-email si el proyecto lo tiene activado y hay email destinatario.
    if (await isProjectAutoEmailEnabled(projectId)) {
      const r = await sendDocumentEmail({ doc, data, projectId });
      if (r.sent) {
        await model.logAudit(auditCtx(req, doc.id, 'emailed', {
          messageId: r.messageId,
          to: data.cliente_email || data.alumno_email,
        }));
      }
    }

    res.json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
}

export async function list(req, res, next) {
  try {
    const { projectId, type } = parse(projectQuerySchema, req.query);
    const docs = await model.listDocuments(projectId, type);
    res.json({ success: true, data: docs });
  } catch (err) {
    next(err);
  }
}

export async function download(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    if (!Number.isFinite(projectId)) throw new AppError('projectId requerido', 400);
    const doc = await model.getDocument(parseInt(req.params.id), projectId);
    if (!doc) throw new AppError('Documento no encontrado', 404);

    // F4-003: si el doc esta en R2, devolvemos URL pre-firmada (15min). El
    // frontend hace fetch a esa URL directamente. Audit log se registra antes
    // de redirigir.
    if (doc.r2_key) {
      const url = await generatePresignedUrl(doc.r2_key);
      await model.logAudit(auditCtx(req, doc.id, 'downloaded', { via: 'r2' }));
      return res.redirect(url);
    }

    if (!doc.file_path) throw new AppError('Archivo no disponible', 404);

    // Path stored en DB. En docs viejos puede apuntar a UPLOAD_DIR antiguo
    // (e.g. /var/crm-uploads/... que no existe en Windows). Si no se encuentra
    // ahi, probamos el UPLOAD_DIR actual con el mismo basename. Si tampoco,
    // regeneramos el PDF desde `doc.data` y reescribimos el path en la DB.
    let filePath = doc.file_path;
    try {
      await fs.access(filePath);
    } catch {
      const fallback = path.join(UPLOAD_DIR, path.basename(doc.file_path));
      try {
        await fs.access(fallback);
        filePath = fallback;
      } catch {
        // Regenerar desde la data original — usa el UPLOAD_DIR actual.
        const filename = path.basename(doc.file_path);
        filePath = doc.type === 'invoice'
          ? await generateInvoicePdf(doc.data, filename)
          : await generateCertificatePdf(doc.data, filename);
        await model.updateFilePath(doc.id, filePath);
      }
    }

    await model.logAudit(auditCtx(req, doc.id, 'downloaded', { filePath: path.basename(filePath) }));
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    if (err.code === 'ENOENT') return next(new AppError('Archivo no encontrado en disco', 404));
    next(err);
  }
}

export async function remove(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    if (!Number.isFinite(projectId)) throw new AppError('projectId requerido', 400);
    const doc = await model.getDocument(parseInt(req.params.id), projectId);
    if (!doc) throw new AppError('Documento no encontrado', 404);
    // Audit log ANTES del delete (FK ON DELETE CASCADE borra los logs tambien,
    // pero registramos el evento en el log de aplicacion via console).
    await model.logAudit(auditCtx(req, doc.id, 'deleted', { number: doc.number, hadR2: !!doc.r2_key }));
    // Borra de R2 (si esta) y FS local — best effort.
    if (doc.r2_key) {
      try { await deleteFromR2(doc.r2_key); } catch (err) {
        logger.warn({ err: err.message, key: doc.r2_key }, 'R2 delete fallo');
      }
    }
    if (doc.file_path) {
      try { await fs.unlink(doc.file_path); } catch { /* archivo ya no existe — OK */ }
    }
    await model.deleteDocument(doc.id, projectId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// Reenvia el documento por email al cliente/alumno (manual). El email
// destino se toma de doc.data.cliente_email / alumno_email; si no existe
// devolvemos 400 para que el frontend muestre un error claro.
export async function resendEmail(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    const id = parseInt(req.params.id);
    if (!Number.isFinite(projectId) || !Number.isFinite(id)) {
      throw new AppError('projectId y id requeridos', 400);
    }
    const doc = await model.getDocument(id, projectId);
    if (!doc) throw new AppError('Documento no encontrado', 404);

    const data = doc.data || {};
    const recipient = doc.type === 'invoice'
      ? (data.cliente_email || data.client_email)
      : (data.alumno_email || data.student_email);
    if (!recipient) {
      throw new AppError('El documento no tiene email del destinatario', 400, 'NO_RECIPIENT');
    }

    const r = await sendDocumentEmail({ doc, data, projectId });
    if (r.sent) {
      await model.logAudit(auditCtx(req, doc.id, 'emailed', {
        messageId: r.messageId, to: recipient, manual: true,
      }));
      res.json({ success: true, data: { sent: true, to: recipient, messageId: r.messageId } });
    } else {
      throw new AppError(`No se envió: ${r.reason || 'desconocido'}`, 502, r.reason || 'EMAIL_FAILED');
    }
  } catch (err) {
    next(err);
  }
}

export async function preview(req, res, next) {
  try {
    const { type, data } = parse(previewSchema, req.body);
    const { buildInvoicePreviewHtml, buildCertPreviewHtml } = await import('./documents.service.js');
    const html = type === 'invoice' ? buildInvoicePreviewHtml(data) : await buildCertPreviewHtml(data);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    next(err);
  }
}

// Peek: devuelve el siguiente numero sin incrementar el contador. El form lo
// muestra al usuario y le permite override manual antes de generar.
export async function peekNumber(req, res, next) {
  try {
    const { projectId, type } = parse(peekNumberQuerySchema, req.query);
    const n = await model.peekNextNumber(projectId, type);
    const prefix = type === 'invoice' ? 'FAC' : 'CERT';
    const formatted = formatDate(n, prefix);
    res.json({ success: true, data: { number: n, formatted } });
  } catch (err) {
    next(err);
  }
}

// Re-genera un PDF desde `documents.data` con el template actual. Util cuando
// el template cambia (e.g. nueva version visual del Canva) y queremos
// refrescar PDFs existentes sin re-introducir datos. Mantiene el mismo
// `number` y NO incrementa el contador.
export async function regenerate(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    const id = parseInt(req.params.id);
    if (!projectId || !id) throw new AppError('projectId y id requeridos', 400);

    const doc = await model.getDocument(id, projectId);
    if (!doc) throw new AppError('Documento no encontrado', 404);

    // Reusa el mismo filename para que el path sea estable
    const filename = doc.file_path
      ? path.basename(doc.file_path)
      : `${doc.number}.pdf`;
    const filePath = doc.type === 'invoice'
      ? await generateInvoicePdf(doc.data, filename)
      : await generateCertificatePdf(doc.data, filename);

    await model.updateFilePath(doc.id, filePath);
    await model.logAudit(auditCtx(req, doc.id, 'regenerated', { number: doc.number }));

    res.json({ success: true, data: { id: doc.id, number: doc.number, file_path: filePath } });
  } catch (err) {
    next(err);
  }
}

// Devuelve el historial de audit log de un documento. Solo superadmin —
// expone IPs y user agents que pueden ser sensibles.
export async function audit(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    const id = parseInt(req.params.id);
    if (!Number.isFinite(projectId) || !Number.isFinite(id)) {
      throw new AppError('projectId y id requeridos', 400);
    }
    const doc = await model.getDocument(id, projectId);
    if (!doc) throw new AppError('Documento no encontrado', 404);
    const log = await model.getAuditLog(doc.id);
    res.json({ success: true, data: log });
  } catch (err) {
    next(err);
  }
}

// Permite ajustar manualmente el contador desde un panel de configuracion sin
// generar un documento. Util para "establecer inicio de factura = 200".
export async function setNumber(req, res, next) {
  try {
    const { projectId, type, value } = parse(setNumberSchema, req.body);
    await model.setNextNumber(projectId, type, value);
    res.json({ success: true, data: { next: value } });
  } catch (err) {
    next(err);
  }
}
