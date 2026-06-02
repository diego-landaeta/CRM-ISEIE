import * as leadService from './lead.service.js';
import * as leadModel from './lead.model.js';
import { webhookLeadSchema, listLeadsSchema, updateStatusSchema, createInteractionSchema, createReminderSchema, reassignSchema, updateLeadSchema, createLeadManualSchema } from './lead.validation.js';
import { AppError } from '../../shared/utils/AppError.js';

// ============================================================
// WEBHOOK (publico, autenticado por API key en header)
// ============================================================

export async function webhook(req, res, next) {
  try {
    const { slug } = req.params;
    // Acepta Authorization: Bearer {key} (PDF spec) o X-API-Key (compat)
    let apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      const authHeader = req.headers['authorization'];
      if (authHeader?.startsWith('Bearer ')) {
        apiKey = authHeader.slice(7).trim();
      }
    }
    if (!apiKey) throw new AppError('API key requerida (Authorization: Bearer o X-API-Key)', 401, 'API_KEY_REQUIRED');

    const parsed = webhookLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }

    const result = await leadService.processWebhook(slug, apiKey, parsed.data);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ============================================================
// LISTADO + DETALLE + STATS
// ============================================================

export async function list(req, res, next) {
  try {
    const parsed = listLeadsSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const filters = { ...parsed.data };
    // SEGURIDAD: el rol 'gestor' SOLO puede ver leads asignados a él.
    // Ignoramos cualquier responsableId/unassigned que venga del cliente.
    if (req.user.role === 'gestor') {
      filters.responsableId = req.user.userId;
      filters.unassigned = false;
      // Filtro duplicados es operativo (admin/superadmin); el gestor no lo usa.
      filters.duplicated = false;
    }
    const result = await leadService.list(filters);
    res.json({
      success: true,
      data: result.leads,
      pagination: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages },
    });
  } catch (err) { next(err); }
}

// GET /api/leads/lookup-by-email?email=X&projectId=Y
// Devuelve metadata MÍNIMA (id, nombre, email, status, responsable_nombre)
// de leads con ese email en el proyecto. Bypassea el filtro RBAC de gestor
// porque el objetivo es informativo (detección de duplicados).
export async function lookupByEmail(req, res, next) {
  try {
    const email = (req.query.email || '').toLowerCase().trim();
    const projectId = parseInt(req.query.projectId);
    if (!email || !email.includes('@')) {
      return res.json({ success: true, data: [] });
    }
    if (isNaN(projectId)) throw new AppError('projectId requerido', 400, 'MISSING_PROJECT');
    const data = await leadService.lookupByEmail(email, projectId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// POST /api/leads/check-duplicate — body {email?, telefono?, project_id}
// Devuelve el lead duplicado existente si lo hay, sin crear nada.
// Sirve para que el FE muestre diálogo de confirmación antes de submit.
export async function checkDuplicate(req, res, next) {
  try {
    const data = await leadService.checkDuplicate(req.body, req.user);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const lead = await leadService.getById(id);
    // SEGURIDAD: el rol 'gestor' SOLO puede ver leads asignados a él.
    if (req.user.role === 'gestor' && lead && lead.responsable_id !== req.user.userId) {
      throw new AppError('No tienes acceso a este lead', 403, 'FORBIDDEN_LEAD');
    }
    res.json({ success: true, data: lead });
  } catch (err) { next(err); }
}

export async function today(req, res, next) {
  try {
    const projectId = req.query.projectId ? parseInt(req.query.projectId) : null;
    const data = await leadService.getTodaySummary({
      userId: req.user.userId,
      role: req.user.role,
      projectId: projectId && !isNaN(projectId) ? projectId : null,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function stats(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    if (isNaN(projectId)) throw new AppError('projectId requerido', 400, 'MISSING_PROJECT');
    const opts = req.user.role === 'gestor' ? { responsableId: req.user.userId } : {};
    const data = await leadService.getStats(projectId, opts);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function dashboardSummary(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    if (isNaN(projectId)) throw new AppError('projectId requerido', 400, 'MISSING_PROJECT');
    const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30));
    const opts = { days };
    if (req.user.role === 'gestor') opts.responsableId = req.user.userId;
    const data = await leadModel.getDashboardSummary(projectId, opts);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ============================================================
// OPERACIONES
// ============================================================

export async function changeStatus(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const result = await leadService.changeStatus(id, parsed.data.status, parsed.data.motivo, req.user.userId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function addInteraction(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = createInteractionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const result = await leadService.addInteraction(id, parsed.data.tipo, parsed.data.nota, req.user.userId, parsed.data.fecha);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function addReminder(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = createReminderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const result = await leadService.addReminder(id, parsed.data.fecha_recordatorio, parsed.data.nota, req.user.userId);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function completeReminder(req, res, next) {
  try {
    const reminderId = parseInt(req.params.reminderId);
    if (isNaN(reminderId)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const result = await leadService.markReminderComplete(reminderId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function createManual(req, res, next) {
  try {
    const parsed = createLeadManualSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const result = await leadService.createManualLead(parsed.data, { creatorUser: req.user });
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

// CRM-import CSV: bulk insert con tolerancia a errores por fila
export async function bulkCreate(req, res, next) {
  try {
    const { projectId, leads } = req.body || {};
    if (!projectId || !Array.isArray(leads)) {
      throw new AppError('projectId y leads[] requeridos', 400, 'VALIDATION_ERROR');
    }
    if (leads.length > 500) {
      throw new AppError('Maximo 500 leads por bulk', 400, 'BULK_TOO_LARGE');
    }
    let ok = 0; let fail = 0; const errors = [];
    const created = [];
    for (let i = 0; i < leads.length; i++) {
      const row = leads[i] || {};
      try {
        if (!row.nombre || !row.email) throw new Error('nombre y email requeridos');
        const result = await leadService.createManualLead({
          project_id: Number(projectId),
          nombre: row.nombre,
          email: String(row.email).toLowerCase().trim(),
          telefono: row.telefono || null,
          notas: row.notas || null,
          producto_interes_id: row.producto_interes_id ? parseInt(row.producto_interes_id) : null,
          canal: row.canal || null,
        });
        created.push({ line: i + 1, lead_id: result.lead_id || result.id });
        ok++;
      } catch (err) {
        errors.push({ line: i + 1, email: row.email || null, error: err.message?.slice(0, 200) || 'error' });
        fail++;
      }
    }
    res.status(201).json({ success: true, data: { ok, fail, errors, created } });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = updateLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const result = await leadService.updateLead(id, parsed.data, { userId: req.user.userId });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// GET /api/leads/:id/purchase-history
// Devuelve todas las conversiones del email del lead en el proyecto.
export async function getPurchaseHistory(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const data = await leadService.getPurchaseHistory(id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// DELETE /api/leads/:id  (superadmin only — soft delete con motivo)
export async function softDelete(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const reason = (req.body?.reason || 'otro').toLowerCase();
    const motivo = req.body?.motivo || null;
    const result = await leadService.softDelete(id, { reason, motivo, userId: req.user.userId });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// POST /api/leads/:id/merge   { loser_id, comment }
// Fusiona dos leads del mismo proyecto. :id es el WINNER (queda activo).
// loser_id es el lead que se borra (soft) tras mover su historial.
// Permisos: gestor + admin + superadmin. Comentario obligatorio (auditoría).
export async function mergeLeads(req, res, next) {
  try {
    const winnerId = parseInt(req.params.id);
    const loserId = parseInt(req.body?.loser_id);
    const comment = (req.body?.comment || '').trim();
    if (isNaN(winnerId) || isNaN(loserId)) throw new AppError('IDs invalidos', 400, 'INVALID_ID');
    if (!comment || comment.length < 3) throw new AppError('Comentario obligatorio (mínimo 3 caracteres)', 400, 'COMMENT_REQUIRED');

    // Si el solicitante es gestor, debe ser dueño del winner
    if (req.user.role === 'gestor') {
      const w = await leadService.getById(winnerId);
      if (!w || w.responsable_id !== req.user.userId) {
        throw new AppError('Solo puedes fusionar leads asignados a ti', 403, 'FORBIDDEN_LEAD');
      }
    }
    const result = await leadService.mergeLeads({ winnerId, loserId, comment, userId: req.user.userId });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const result = await leadService.restore(id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function reassign(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = reassignSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const result = await leadService.reassign(id, parsed.data.responsable_id, req.user.userId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// POST /api/leads/reassign-pending?projectId=X
// Re-aplica round-robin a leads con responsable_id IS NULL del proyecto.
export async function reassignPending(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    if (isNaN(projectId) || projectId <= 0) {
      throw new AppError('projectId requerido', 400, 'PROJECT_REQUIRED');
    }
    const result = await leadService.reassignPending(projectId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function getLeadSequences(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const result = await leadService.getLeadSequences(id, req.user);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
