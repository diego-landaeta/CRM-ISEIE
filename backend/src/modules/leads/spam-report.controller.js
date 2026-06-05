import { z } from 'zod';
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import * as leadService from './lead.service.js';

// Motivo OBLIGATORIO (min 3 chars). El equipo necesita trazabilidad del por qué
// se reportó como spam — no debería poder reportarse en blanco.
const reportSchema = z.object({
  motivo: z.string().trim().min(3, 'Motivo requerido (mínimo 3 caracteres)').max(500),
});

const resolveSchema = z.object({
  action: z.enum(['confirm', 'dismiss']),
});

// POST /api/leads/:id/report-spam
// Cualquier usuario autenticado puede levantar un reporte.
export async function reportSpam(req, res, next) {
  try {
    const leadId = parseInt(req.params.id);
    if (isNaN(leadId)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = reportSchema.safeParse(req.body || {});
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');

    const { rows: leadRows } = await query(
      `SELECT id, project_id, deleted_at FROM leads WHERE id = $1`,
      [leadId]
    );
    if (!leadRows[0]) throw new AppError('Lead no encontrado', 404, 'LEAD_NOT_FOUND');
    if (leadRows[0].deleted_at) throw new AppError('El lead ya está eliminado', 400, 'LEAD_ALREADY_DELETED');

    try {
      const { rows } = await query(
        `INSERT INTO lead_spam_reports (lead_id, project_id, reported_by, motivo)
         VALUES ($1, $2, $3, $4)
         RETURNING id, lead_id, motivo, status, created_at`,
        [leadId, leadRows[0].project_id, req.user.userId, parsed.data.motivo]
      );
      // Registrar también como interacción para trazabilidad en el feed del lead.
      try {
        await query(
          `INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, fecha)
           VALUES ($1, 'nota', $2, $3, NOW())`,
          [leadId, `🛑 Reportado como spam · ${parsed.data.motivo}`, req.user.userId]
        );
      } catch (_) { /* no crítico, el reporte ya está */ }
      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      if (err.code === '23505') {
        throw new AppError('Ya hay un reporte pendiente para este lead', 409, 'REPORT_ALREADY_PENDING');
      }
      throw err;
    }
  } catch (err) { next(err); }
}

// GET /api/leads/spam-reports  (superadmin)
export async function listPending(_req, res, next) {
  try {
    const { rows } = await query(
      `SELECT r.id, r.lead_id, r.motivo, r.status, r.created_at,
              l.nombre AS lead_nombre, l.email AS lead_email, l.telefono AS lead_telefono,
              p.nombre AS proyecto_nombre, p.slug AS proyecto_slug,
              u.nombre AS reportado_por_nombre, u.email AS reportado_por_email
         FROM lead_spam_reports r
         JOIN leads l ON l.id = r.lead_id
         JOIN projects p ON p.id = r.project_id
         JOIN users u ON u.id = r.reported_by
        WHERE r.status = 'pending'
        ORDER BY r.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

// GET /api/leads/spam-reports/count  (superadmin)
export async function countPending(_req, res, next) {
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS count FROM lead_spam_reports WHERE status = 'pending'`
    );
    res.json({ success: true, data: { count: rows[0].count } });
  } catch (err) { next(err); }
}

// PATCH /api/leads/spam-reports/:reportId  (superadmin) → confirm | dismiss
export async function resolveReport(req, res, next) {
  try {
    const reportId = parseInt(req.params.reportId);
    if (isNaN(reportId)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');

    const { rows: reports } = await query(
      `SELECT id, lead_id, motivo, status FROM lead_spam_reports WHERE id = $1`,
      [reportId]
    );
    if (!reports[0]) throw new AppError('Reporte no encontrado', 404, 'REPORT_NOT_FOUND');
    if (reports[0].status !== 'pending') {
      throw new AppError('Reporte ya resuelto', 400, 'REPORT_ALREADY_RESOLVED');
    }

    const newStatus = parsed.data.action === 'confirm' ? 'confirmed' : 'dismissed';

    if (parsed.data.action === 'confirm') {
      await leadService.softDelete(reports[0].lead_id, {
        reason: 'spam',
        motivo: `Confirmado desde reporte #${reportId}` + (reports[0].motivo ? `: ${reports[0].motivo}` : ''),
        userId: req.user.userId,
      });
    }

    await query(
      `UPDATE lead_spam_reports SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3`,
      [newStatus, req.user.userId, reportId]
    );

    res.json({ success: true, data: { id: reportId, status: newStatus } });
  } catch (err) { next(err); }
}
