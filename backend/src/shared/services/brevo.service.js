import { logger } from '../utils/logger.js';

// Mientras no exista el módulo `credentials` (encriptación AES-256 de keys por
// proyecto/global en DB), la API key sale del env directamente. Al portar
// `credentials` desde el CRM hermano, reintroducir la lookup por DB en getApiKey.

const BREVO_API_URL = 'https://api.brevo.com/v3';
const FROM_EMAIL = process.env.BREVO_FROM_EMAIL || 'no-reply@crm-test.local';
const FROM_NAME = process.env.BREVO_FROM_NAME || 'CRM ISEIE';

function getApiKey() {
  const envKey = process.env.BREVO_API_KEY;
  if (!envKey || envKey === 'test') return null;
  return envKey;
}

async function sendEmail({ to, subject, htmlContent, textContent, tags = [], fromEmail, fromName, attachment }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    logger.warn({ to, subject }, 'Brevo: sin API key configurada, email no enviado');
    return { sent: false, reason: 'NO_API_KEY' };
  }

  const payload = {
    sender: { email: fromEmail || FROM_EMAIL, name: fromName || FROM_NAME },
    to: Array.isArray(to) ? to : [{ email: to.email || to, name: to.name }],
    subject,
    htmlContent,
    textContent,
    tags,
  };
  // Brevo acepta `attachment: [{ name, content }]` con content en base64.
  // PDFs de facturas/certs estan muy por debajo del limite de 10MB.
  if (Array.isArray(attachment) && attachment.length > 0) {
    payload.attachment = attachment;
  }

  try {
    const res = await fetch(`${BREVO_API_URL}/smtp/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
        'accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      logger.error({ status: res.status, err, to, subject }, 'Brevo error');
      return { sent: false, reason: `HTTP_${res.status}`, details: err };
    }

    const data = await res.json();
    logger.info({ messageId: data.messageId, to, subject }, 'Brevo email enviado');
    return { sent: true, messageId: data.messageId };
  } catch (err) {
    logger.error({ err: err.message, to, subject }, 'Brevo fetch error');
    return { sent: false, reason: 'FETCH_ERROR', details: err.message };
  }
}

// ============================================================
// TEMPLATES
// ============================================================

export async function sendWelcomeUserEmail({ nombre, email, setPasswordToken, baseUrl }) {
  const link = `${baseUrl}/set-password?token=${encodeURIComponent(setPasswordToken)}`;
  const subject = 'Bienvenido al CRM - Establece tu contrasena';
  const htmlContent = `
    <!DOCTYPE html>
    <html><body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #3b82f6, #8b5cf6); padding: 32px; border-radius: 12px; color: white; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">Bienvenido al CRM</h1>
      </div>
      <div style="background: white; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p>Hola <strong>${nombre}</strong>,</p>
        <p>Se ha creado tu cuenta en el CRM MultiProyecto. Para empezar, establece tu contrasena haciendo click en el siguiente boton:</p>
        <p style="text-align: center; margin: 32px 0;">
          <a href="${link}" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Establecer contrasena</a>
        </p>
        <p style="font-size: 13px; color: #6b7280;">O copia este enlace en tu navegador:<br><code style="background: #f3f4f6; padding: 4px 8px; border-radius: 4px; word-break: break-all;">${link}</code></p>
        <p style="font-size: 13px; color: #6b7280;">Este enlace expira en 24 horas.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 12px; color: #9ca3af;">Si no esperabas este email, ignoralo.</p>
      </div>
    </body></html>`;
  const textContent = `Hola ${nombre},\n\nSe ha creado tu cuenta en el CRM. Establece tu contrasena aqui:\n${link}\n\nEste enlace expira en 24 horas.`;

  return await sendEmail({
    to: [{ email, name: nombre }],
    subject,
    htmlContent,
    textContent,
    tags: ['welcome-user', 'crm'],
  });
}

export async function sendLeadAssignedEmail({ gestor, lead, proyecto, baseUrl }) {
  const link = `${baseUrl}/leads/${lead.id}`;
  const subject = `Nuevo lead asignado: ${lead.nombre}`;
  const htmlContent = `
    <!DOCTYPE html>
    <html><body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #3b82f6;">Nuevo lead asignado</h2>
      <p>Hola <strong>${gestor.nombre}</strong>, te han asignado un nuevo lead.</p>
      <div style="background: #f9fafb; padding: 16px; border-radius: 8px; border-left: 4px solid #3b82f6;">
        <p style="margin: 0 0 8px;"><strong>${lead.nombre}</strong></p>
        <p style="margin: 0 0 4px; font-size: 14px;">${lead.email}</p>
        ${lead.telefono ? `<p style="margin: 0 0 4px; font-size: 14px;">${lead.telefono}</p>` : ''}
        <p style="margin: 8px 0 0; font-size: 13px; color: #6b7280;">Proyecto: ${proyecto.nombre}</p>
      </div>
      <p style="text-align: center; margin: 24px 0;">
        <a href="${link}" style="background: #3b82f6; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold;">Ver lead</a>
      </p>
      <p style="font-size: 12px; color: #9ca3af;">Contactalo lo antes posible para maximizar la conversion.</p>
    </body></html>`;
  const textContent = `Hola ${gestor.nombre},\nNuevo lead asignado:\n${lead.nombre} <${lead.email}>\nProyecto: ${proyecto.nombre}\nVer: ${link}`;

  return await sendEmail({
    to: [{ email: gestor.email, name: gestor.nombre }],
    subject,
    htmlContent,
    textContent,
    tags: ['lead-assigned', 'crm'],
  });
}

export { sendEmail };
