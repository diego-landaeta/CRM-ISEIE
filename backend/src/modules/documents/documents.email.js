// F4-009: envio automatico de factura/certificado al cliente con PDF adjunto.
// Reusa Brevo via la misma API key configurada en credenciales del proyecto;
// si no hay key configurada, sendEmail devuelve { sent: false } y no rompe.

import fs from 'fs/promises';
import { sendEmail } from '../../shared/services/brevo.service.js';
import { logger } from '../../shared/utils/logger.js';
import pool from '../../shared/config/db.js';

// Lee el PDF desde disco (FS local) o desde R2 si solo tenemos r2_key.
// Devuelve { name, content (base64) } listo para el campo `attachment` de Brevo.
async function buildAttachment({ filePath, r2Key }) {
  if (filePath) {
    try {
      const buf = await fs.readFile(filePath);
      const name = filePath.split(/[\\/]/).pop();
      return { name, content: buf.toString('base64') };
    } catch (err) {
      logger.warn({ err: err.message, filePath }, 'attachment: filePath no accesible');
    }
  }
  if (r2Key) {
    const { getFromR2 } = await import('../../shared/services/r2.service.js');
    try {
      const obj = await getFromR2(r2Key);
      const chunks = [];
      for await (const chunk of obj.body) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      const name = r2Key.split('/').pop();
      return { name, content: buf.toString('base64') };
    } catch (err) {
      logger.warn({ err: err.message, r2Key }, 'attachment: r2Key no accesible');
    }
  }
  return null;
}

export async function isProjectAutoEmailEnabled(projectId) {
  try {
    const { rows } = await pool.query(
      'SELECT auto_email_documents FROM projects WHERE id = $1',
      [projectId]
    );
    return rows[0]?.auto_email_documents === true;
  } catch {
    return false;
  }
}

/**
 * Envia el documento por email. Best-effort: si Brevo no esta configurado o
 * falla, loguea y devuelve { sent: false } sin propagar excepcion.
 *
 * @param {object} args
 * @param {object} args.doc - registro de documents (con id, type, number, file_path, r2_key)
 * @param {object} args.data - data del documento (cliente_email/alumno_email, nombres)
 * @param {number} args.projectId - id del proyecto (para Brevo per-project key)
 */
export async function sendDocumentEmail({ doc, data, projectId }) {
  const isInvoice = doc.type === 'invoice';
  const recipientEmail = isInvoice
    ? (data.cliente_email || data.client_email)
    : (data.alumno_email || data.student_email);

  if (!recipientEmail || typeof recipientEmail !== 'string' || !recipientEmail.includes('@')) {
    return { sent: false, reason: 'NO_RECIPIENT' };
  }

  const recipientName = isInvoice
    ? (data.cliente_nombre || '')
    : (data.alumno_nombre || '');

  const subject = isInvoice
    ? `Factura ${doc.number} — Psiko Aprende`
    : `Certificado ${doc.number} — Psiko Aprende`;

  const htmlContent = isInvoice
    ? `<p>Estimado/a ${recipientName || 'cliente'},</p>
       <p>Adjuntamos la factura <strong>${doc.number}</strong>.</p>
       <p>Si tienes cualquier duda, responde a este email.</p>
       <p>Un saludo,<br/>Psiko Aprende</p>`
    : `<p>Estimado/a ${recipientName || 'alumno'},</p>
       <p>Enhorabuena por completar el curso. Adjuntamos tu certificado <strong>${doc.number}</strong>.</p>
       <p>Un saludo,<br/>Psiko Aprende</p>`;

  const attachment = await buildAttachment({ filePath: doc.file_path, r2Key: doc.r2_key });
  if (!attachment) {
    logger.warn({ docId: doc.id }, 'sendDocumentEmail: no se pudo cargar el PDF, abortando');
    return { sent: false, reason: 'ATTACHMENT_FAILED' };
  }

  try {
    const r = await sendEmail({
      to: { email: recipientEmail, name: recipientName },
      subject,
      htmlContent,
      tags: [`doc-${doc.type}`, `psiko-${projectId}`],
      projectId,
      attachment: [attachment],
    });
    return r;
  } catch (err) {
    logger.error({ err: err.message, docId: doc.id }, 'sendDocumentEmail: Brevo error');
    return { sent: false, reason: 'BREVO_ERROR' };
  }
}
