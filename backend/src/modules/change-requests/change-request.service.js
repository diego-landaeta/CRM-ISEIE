import * as model from './change-request.model.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import * as P from '../../shared/services/email-plantilla.service.js';
import { notifyAdmins } from '../notifications/notifications.service.js';
import { query } from '../../shared/config/db.js';

// Roles con visibilidad/edición total sobre los RFCs.
const FULL_VISIBILITY = ['superadmin', 'admin', 'project_manager', 'soporte'];
const PM_ROLES = ['project_manager', 'admin', 'superadmin', 'soporte']; // pueden rellenar la parte técnica
const CEO_ROLES = ['superadmin', 'soporte']; // firma como CEO (soporte = PMI/dev gestiona todo)

function canEditFull(role) { return FULL_VISIBILITY.includes(role); }
function canFillPM(role) { return PM_ROLES.includes(role); }
function canFillCEO(role) { return CEO_ROLES.includes(role); }

export async function create({ projectId, titulo, solicitanteUserId, ...payload }) {
  // projectId opcional: null = solicitud "General" (cambios cross-proyecto o de plataforma).
  if (!titulo || titulo.trim().length < 3) throw new AppError('Título requerido (min 3 chars)', 400, 'INVALID_TITLE');
  const cleanProjectId = projectId ? parseInt(projectId) : null;
  const codigoRfc = await model.getNextRfcCode(cleanProjectId);
  const rfc = await model.create({ projectId: cleanProjectId, codigoRfc, titulo: titulo.trim(), solicitanteUserId, ...payload });

  // Notif PM por email + notif in-app a admins
  notifyPmsOfNewRfc(rfc).catch((err) => logger.warn({ err: err.message, rfcId: rfc.id }, 'No se pudo notificar PM'));
  notifyAdmins({
    type: 'rfc_created',
    title: `Nueva solicitud de cambio: ${rfc.codigo_rfc}`,
    message: `${rfc.titulo}`,
    link_path: `/solicitudes-cambio/${rfc.id}`,
    metadata: { rfc_id: rfc.id, project_id: projectId },
    triggered_by_user_id: solicitanteUserId || null,
  });

  return rfc;
}

export async function list({ projectId, userId, role, estado }) {
  return await model.listForUser({ projectId, userId, role, estado });
}

export async function getById(id, { userId, role }) {
  const rfc = await model.getById(id);
  if (!rfc) throw new AppError('RFC no encontrado', 404, 'NOT_FOUND');
  if (!canEditFull(role) && rfc.solicitante_user_id !== userId) {
    throw new AppError('Sin acceso a esta solicitud', 403, 'FORBIDDEN');
  }
  return rfc;
}

export async function update(id, patch, { userId, role }) {
  const rfc = await model.getById(id);
  if (!rfc) throw new AppError('RFC no encontrado', 404, 'NOT_FOUND');

  // Reglas de qué campos puede tocar cada rol.
  const isOwner = rfc.solicitante_user_id === userId;
  if (!canFillPM(role) && !isOwner) {
    throw new AppError('Sin permiso para editar este RFC', 403, 'FORBIDDEN');
  }

  // Campos de la parte técnica (PM): solo PM/admin/superadmin
  const pmOnly = ['opciones_consideradas', 'impacto_alcance', 'impacto_tiempo', 'impacto_costo',
                  'impacto_riesgos', 'recomendacion_decision', 'recomendacion_justif',
                  'plan_alcance', 'plan_hitos', 'plan_responsables',
                  'baseline_alcance', 'baseline_cronograma', 'baseline_costos', 'estado'];
  if (!canFillPM(role)) {
    for (const f of pmOnly) {
      if (patch[f] !== undefined) {
        throw new AppError(`Solo el PM puede editar "${f}"`, 403, 'FORBIDDEN_FIELD');
      }
    }
  }

  // Transición a "enviado_ceo" → notificar superadmins (CEO)
  const terminalStates = ['aprobado', 'aprobado_inmediato', 'aprobado_futuro', 'rechazado', 'diferido'];
  const wasNotSentToCeo = rfc.estado !== 'enviado_ceo' && !terminalStates.includes(rfc.estado);
  const updated = await model.update(id, patch);
  if (wasNotSentToCeo && patch.estado === 'enviado_ceo') {
    notifyCeoOfRfc(updated).catch((err) => logger.warn({ err: err.message, rfcId: id }, 'No se pudo notificar CEO'));
  }
  return updated;
}

export async function approve(id, { rol, decision, timing, firmaData, comentarios, userId, userRole }) {
  if (!['ceo', 'pm', 'dev'].includes(rol)) throw new AppError('Rol inválido (ceo|pm|dev)', 400, 'INVALID_ROL');
  if (!['a_favor', 'en_contra', 'diferir'].includes(decision)) throw new AppError('Decisión inválida', 400, 'INVALID_DECISION');

  // Validar que el rol del user coincida con el slot.
  if (rol === 'ceo' && !canFillCEO(userRole)) throw new AppError('Solo CEO/superadmin firma como CEO', 403, 'FORBIDDEN');
  if (rol === 'pm' && !canFillPM(userRole)) throw new AppError('Solo PM/admin/superadmin firma como PM', 403, 'FORBIDDEN');
  // DEV es libre: cualquier role autenticado puede firmar como DEV.

  const rfc = await model.getById(id);
  if (!rfc) throw new AppError('RFC no encontrado', 404, 'NOT_FOUND');

  await model.setApproval({ rfcId: id, rol, userId, decision, firmaData, comentarios });

  // Si firma CEO con a_favor → aprobado_inmediato (default) o aprobado_futuro (si timing='futuro').
  // en_contra → rechazado. diferir → diferido.
  if (rol === 'ceo') {
    let newStatus;
    if (decision === 'a_favor') {
      newStatus = timing === 'futuro' ? 'aprobado_futuro' : 'aprobado_inmediato';
    } else if (decision === 'en_contra') {
      newStatus = 'rechazado';
    } else {
      newStatus = 'diferido';
    }
    await query(`UPDATE change_requests SET estado=$1, updated_at=NOW() WHERE id=$2`, [newStatus, id]);
  }

  return await model.getById(id);
}

export async function getApprovalSignature(approvalId, { userId, role }) {
  // Solo admin/PM/superadmin o el solicitante pueden ver las firmas
  const { rows } = await query(
    `SELECT a.firma_data, r.solicitante_user_id
     FROM change_request_approvals a
     JOIN change_requests r ON r.id = a.change_request_id
     WHERE a.id = $1`,
    [approvalId]
  );
  if (!rows[0]) throw new AppError('Firma no encontrada', 404, 'NOT_FOUND');
  if (!canEditFull(role) && rows[0].solicitante_user_id !== userId) {
    throw new AppError('Sin acceso', 403, 'FORBIDDEN');
  }
  return rows[0].firma_data;
}

export async function addAttachment(attachment, { userId }) {
  return await model.addAttachment({ ...attachment, uploadedBy: userId });
}

export async function getAttachment(id) {
  return await model.getAttachment(id);
}

export async function deleteAttachment(id) {
  return await model.deleteAttachment(id);
}

export async function remove(id, { role }) {
  if (!canEditFull(role)) throw new AppError('Solo admin/PM puede eliminar', 403, 'FORBIDDEN');
  await model.remove(id);
  return { deleted: true };
}

/**
 * Reabre una RFC que estaba en estado terminal (rechazado / diferido / aprobado).
 * Vuelve al estado 'en_analisis' y limpia la decisión + firma del CEO para que
 * pueda volver a pasar por el flujo. Solo PM/admin/superadmin.
 *
 * Motivo: el solicitante quiere intentarlo de nuevo con ajustes, sin perder
 * el histórico de las decisiones previas (las firmas de PM y DEV se conservan).
 */
export async function reopen(id, { userId, role, motivo }) {
  if (!canEditFull(role)) throw new AppError('Solo PM/admin/superadmin puede reabrir', 403, 'FORBIDDEN');
  const rfc = await model.getById(id);
  if (!rfc) throw new AppError('RFC no encontrada', 404, 'NOT_FOUND');
  const terminal = ['aprobado', 'aprobado_inmediato', 'aprobado_futuro', 'rechazado', 'diferido'];
  if (!terminal.includes(rfc.estado)) {
    throw new AppError(`Solo se pueden reabrir RFCs ${terminal.join('/')}, no '${rfc.estado}'`, 400, 'INVALID_STATE');
  }
  if (!motivo || motivo.trim().length < 3) {
    throw new AppError('Motivo de reapertura requerido (mín. 3 caracteres)', 400, 'MOTIVO_REQUIRED');
  }
  // Volver al estado de análisis del PM. La firma del CEO se borra (ya no es
  // válida); las de PM y DEV se conservan como histórico — el PM puede ajustar.
  await query(
    `UPDATE change_requests SET estado='en_analisis', updated_at=NOW() WHERE id=$1`,
    [id]
  );
  await query(
    `UPDATE change_request_approvals
     SET decision = NULL, firma_data = NULL, firma_at = NULL,
         user_id = NULL,
         comentarios = COALESCE(comentarios || E'\n', '') || '[Reabierta el ' || to_char(NOW(),'YYYY-MM-DD HH24:MI') || ': ' || $2 || ']'
     WHERE change_request_id = $1 AND rol = 'ceo'`,
    [id, motivo.trim()]
  );
  return await model.getById(id);
}

// ─── Notificaciones email ───────────────────────────────────────

// Los dos avisos de solicitudes de cambio, con la plantilla común y la marca de
// su proyecto, o la del CRM si es general (Diego, 10/10: «cada correo con un
// formato completo y lindo, y con el branding»).
async function correoRfc(rfc, { titulo, texto }) {
  let marca = { nombre: 'ISEIE', slug: 'iseie' };
  if (rfc.project_id) {
    const { rows } = await query('SELECT nombre, slug, logo_url, emoji FROM projects WHERE id = $1', [rfc.project_id]);
    if (rows[0]) marca = rows[0];
  }
  return P.correo({
    proyecto: marca,
    titulo,
    resumen: `${rfc.codigo_rfc} · ${rfc.titulo}`,
    bloques: [
      P.nota(`<strong>${P.esc(rfc.codigo_rfc)}</strong> · ${P.esc(rfc.titulo)}<br><span style="color:#71717a">Estado: ${P.esc(rfc.estado || '—')}</span>`),
      P.parrafo(P.esc(texto)),
      P.boton({ texto: 'Abrir la solicitud', url: P.enlace(`/solicitudes-cambio/${rfc.id}`) }),
    ],
  });
}

async function notifyPmsOfNewRfc(rfc) {
  const pms = await model.listUsersByRole('project_manager');
  // Si no hay PM dedicado, notificar a admins.
  const recipients = pms.length > 0 ? pms : await model.listUsersByRole('admin');
  if (recipients.length === 0) {
    logger.info({ rfcId: rfc.id }, 'RFC: sin destinatarios PM/admin para notificar');
    return;
  }
  const subject = `Nueva solicitud de cambio: ${rfc.codigo_rfc} · ${rfc.titulo}`;
  const html = await correoRfc(rfc, {
    titulo: 'Nueva solicitud de cambio',
    texto: 'Revisa la solicitud en el CRM para completar la parte técnica.',
  });
  for (const r of recipients) {
    if (!r.email) continue;
    try {
      await sendEmail({ to: [{ email: r.email, name: r.nombre }], subject, ...html, projectId: rfc.project_id ?? null, tags: ['rfc', 'created'] });
    } catch (err) {
      logger.warn({ err: err.message, to: r.email }, 'Brevo: fallo al notificar PM');
    }
  }
}

async function notifyCeoOfRfc(rfc) {
  const ceos = await model.listUsersByRole('superadmin');
  if (ceos.length === 0) return;
  const subject = `${rfc.codigo_rfc}: pendiente de tu aprobación`;
  const html = await correoRfc(rfc, {
    titulo: 'Una solicitud de cambio espera tu aprobación',
    texto: 'Entra al CRM, revisa la propuesta y firma tu decisión.',
  });
  for (const c of ceos) {
    if (!c.email) continue;
    try {
      await sendEmail({ to: [{ email: c.email, name: c.nombre }], subject, ...html, projectId: rfc.project_id ?? null, tags: ['rfc', 'ceo_review'] });
    } catch (err) {
      logger.warn({ err: err.message, to: c.email }, 'Brevo: fallo al notificar CEO');
    }
  }
}
