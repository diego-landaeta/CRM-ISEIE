import { z } from 'zod';
import { query } from '../../shared/config/db.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import { AppError } from '../../shared/utils/AppError.js';

const sendEmailSchema = z.object({
  subject:   z.string().min(1).max(500),
  body_html: z.string().min(1).max(50000),
  body_text: z.string().max(50000).optional(),
});

// POST /api/leads/:id/send-email
export async function sendLeadEmail(req, res, next) {
  try {
    const leadId = parseInt(req.params.id);
    if (isNaN(leadId) || leadId <= 0) throw new AppError('ID invalido', 400, 'INVALID_ID');
    if (!req.user?.userId) throw new AppError('Auth invalida', 401, 'AUTH_REQUIRED');

    const parsed = sendEmailSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');

    const { rows } = await query(
      `SELECT l.id, l.email, l.nombre, l.project_id, p.nombre AS project_nombre
       FROM leads l JOIN projects p ON p.id = l.project_id
       WHERE l.id = $1`,
      [leadId]
    );
    if (!rows[0]) throw new AppError('Lead no encontrado', 404, 'NOT_FOUND');
    const lead = rows[0];
    if (!lead.email) throw new AppError('El lead no tiene email', 400, 'NO_EMAIL');

    const { subject, body_html, body_text } = parsed.data;

    const result = await sendEmail({
      to: { email: lead.email, name: lead.nombre },
      subject,
      htmlContent: body_html,
      textContent: body_text,
      tags: ['manual', `project-${lead.project_id}`],
      projectId: lead.project_id,
    });

    if (!result.sent) {
      throw new AppError(`No se pudo enviar el email: ${result.reason}`, 502, 'EMAIL_NOT_SENT');
    }

    await query(
      `INSERT INTO lead_emails (lead_id, user_id, subject, body_html, brevo_msg_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [leadId, req.user.userId, subject, body_html, result.messageId || null]
    );

    res.json({ success: true, data: { sent: true, messageId: result.messageId } });
  } catch (err) { next(err); }
}

// GET /api/leads/:id/emails
export async function listLeadEmails(req, res, next) {
  try {
    const leadId = parseInt(req.params.id);
    if (isNaN(leadId)) throw new AppError('ID invalido', 400, 'INVALID_ID');

    const { rows } = await query(
      `SELECT le.id, le.subject, le.brevo_msg_id, le.sent_at,
              u.nombre AS sent_by_nombre, u.email AS sent_by_email
       FROM lead_emails le
       LEFT JOIN users u ON u.id = le.user_id
       WHERE le.lead_id = $1
       ORDER BY le.sent_at DESC`,
      [leadId]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}
