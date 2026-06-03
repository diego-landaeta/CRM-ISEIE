// Cola de revisión de duplicados (#13).
// El webhook nunca se bloquea — Make sigue su flujo, pero los duplicados
// detectados entran aquí para que admin/superadmin decida.

import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { notifyAdmins } from '../notifications/notifications.service.js';

/**
 * Encolar una entrada de revisión. Llamado tras crear el lead duplicado.
 * Idempotente: si ya existe entry para ese lead, no inserta de nuevo.
 */
export async function enqueue({ leadId, originalLeadId, projectId, matchByEmail = false, matchByPhone = false, source = 'webhook', leadName = null }) {
  try {
    const { rows } = await query(
      `INSERT INTO lead_duplicate_review_queue
         (lead_id, original_lead_id, project_id, match_by_email, match_by_phone, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (lead_id) DO NOTHING
       RETURNING id`,
      [leadId, originalLeadId, projectId, matchByEmail, matchByPhone, source]
    );
    if (rows[0]) {
      notifyAdmins({
        type: 'dup_review_pending',
        title: `Duplicado pendiente de revisión: lead #${leadId}`,
        message: `${leadName || 'Lead'} entró como duplicado de #${originalLeadId}. Decide: aprobar / fusionar / descartar.`,
        link_path: `/leads/revision-duplicados`,
        metadata: { lead_id: leadId, original_lead_id: originalLeadId, project_id: projectId },
        triggered_by_user_id: null,
      });
    }
    return rows[0] || null;
  } catch (err) {
    logger.warn({ err: err.message, leadId }, 'dup-queue enqueue falló (no crítico)');
    return null;
  }
}

/**
 * Lista entradas de la cola para admin/superadmin.
 */
export async function list({ projectId = null, status = 'pending', limit = 100 } = {}) {
  const params = [status, limit];
  const projectFilter = projectId ? `AND q.project_id = $3` : '';
  if (projectId) params.push(projectId);
  const { rows } = await query(
    `SELECT q.id, q.lead_id, q.original_lead_id, q.project_id,
            q.match_by_email, q.match_by_phone, q.source, q.status,
            q.decided_by_user_id, q.decided_at, q.notas, q.created_at,
            l.nombre AS lead_nombre, l.email AS lead_email, l.telefono AS lead_telefono,
            l.responsable_id AS lead_responsable_id,
            ru.nombre AS lead_responsable_nombre,
            l.reincidente, l.status AS lead_status,
            pr.nombre AS lead_producto,
            ol.nombre AS original_nombre, ol.email AS original_email,
            ol.status AS original_status, ol.responsable_id AS original_responsable_id,
            ou.nombre AS original_responsable_nombre,
            du.nombre AS decided_by_nombre
     FROM lead_duplicate_review_queue q
     LEFT JOIN leads l ON l.id = q.lead_id
     LEFT JOIN leads ol ON ol.id = q.original_lead_id
     LEFT JOIN users ru ON ru.id = l.responsable_id
     LEFT JOIN users ou ON ou.id = ol.responsable_id
     LEFT JOIN users du ON du.id = q.decided_by_user_id
     LEFT JOIN products pr ON pr.id = l.producto_interes_id
     WHERE q.status = $1 ${projectFilter}
     ORDER BY q.created_at DESC LIMIT $2`,
    params
  );
  return rows;
}

export async function counts(projectId = null) {
  const params = projectId ? [projectId] : [];
  const where = projectId ? `WHERE project_id = $1` : '';
  const { rows } = await query(
    `SELECT status, COUNT(*)::int AS n FROM lead_duplicate_review_queue ${where} GROUP BY status`,
    params
  );
  return rows.reduce((acc, r) => { acc[r.status] = r.n; return acc; }, { pending: 0, approved: 0, merged: 0, rejected: 0 });
}

/**
 * Decisión del admin sobre una entrada de la cola.
 * action: 'approve' | 'reject' (fusión usa endpoint /leads/:id/merge → marcar como 'merged' aparte).
 */
export async function decide({ queueId, action, notas, userId }) {
  const validActions = ['approve', 'reject'];
  if (!validActions.includes(action)) {
    throw new AppError('Acción inválida (approve | reject)', 400, 'INVALID_ACTION');
  }
  const { rows: existing } = await query(
    `SELECT id, lead_id, status FROM lead_duplicate_review_queue WHERE id = $1`,
    [queueId]
  );
  if (!existing[0]) throw new AppError('Entrada no encontrada', 404, 'NOT_FOUND');
  if (existing[0].status !== 'pending') {
    throw new AppError(`Ya estaba ${existing[0].status}`, 400, 'ALREADY_DECIDED');
  }
  const leadId = existing[0].lead_id;
  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  await query(
    `UPDATE lead_duplicate_review_queue
     SET status = $1, decided_by_user_id = $2, decided_at = NOW(), notas = $3
     WHERE id = $4`,
    [newStatus, userId || null, notas || null, queueId]
  );

  // Si se rechaza → soft-delete del lead duplicado
  if (action === 'reject') {
    await query(
      `UPDATE leads
       SET deleted_at = NOW(), deleted_reason = 'duplicado_manual',
           deleted_motivo = $2, deleted_by = $3, updated_at = NOW()
       WHERE id = $1`,
      [leadId, `Rechazado en cola de revisión: ${notas || 'sin motivo'}`, userId || null]
    );
    // Audit
    await query(
      `INSERT INTO lead_audit_log (lead_id, field_name, old_value, new_value, changed_by_user_id)
       VALUES ($1, 'dup_review_decision', 'pending', 'rejected', $2)`,
      [leadId, userId || null]
    );
  } else {
    // Approve: deja el lead activo. Si no tiene responsable, lo deja como está
    // (round-robin se aplicó al crearse). Audit:
    await query(
      `INSERT INTO lead_audit_log (lead_id, field_name, old_value, new_value, changed_by_user_id)
       VALUES ($1, 'dup_review_decision', 'pending', 'approved', $2)`,
      [leadId, userId || null]
    );
  }

  return { queue_id: queueId, lead_id: leadId, status: newStatus };
}

/**
 * Marcar como 'merged'. Llamado desde mergeLeads cuando el lead loser estaba en la cola.
 */
export async function markMerged(leadId, userId) {
  await query(
    `UPDATE lead_duplicate_review_queue
     SET status = 'merged', decided_by_user_id = $2, decided_at = NOW()
     WHERE lead_id = $1 AND status = 'pending'`,
    [leadId, userId || null]
  );
}
