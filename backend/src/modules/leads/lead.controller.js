import * as leadService from './lead.service.js';
import * as leadModel from './lead.model.js';
import { webhookLeadSchema, listLeadsSchema, updateStatusSchema, createInteractionSchema, createReminderSchema, reassignSchema, updateLeadSchema, createLeadManualSchema } from './lead.validation.js';
import * as dupQueue from './dup-queue.service.js';
import * as leadProducts from './lead-products.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import { leadsToWasapiCsv, leadsToWasapiXlsx, detectCountry } from '../../shared/utils/wasapiCsv.js';

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
      // Filtros operativos (admin/superadmin); gestor no los usa.
      filters.duplicated = false;
      filters.reincidente = false;
    }
    const result = await leadService.list(filters);
    res.json({
      success: true,
      data: result.leads,
      pagination: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages },
    });
  } catch (err) { next(err); }
}

// GET /api/leads/export/wasapi?projectId=X&status=&responsableId=&dateFrom=&dateTo=&productId=&pais=&onlyWithPhone=
// Descarga CSV con formato Wasapi (plantilla bulk WhatsApp).
// Todos los filtros son opcionales — el único requisito real es `projectId`.
// SEGURIDAD: si el rol es 'gestor', filtra automáticamente a sus propios leads
// (ignora cualquier responsableId que venga por query).
export async function exportWasapi(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    if (!projectId) throw new AppError('projectId requerido', 400, 'MISSING_PROJECT');

    const filters = {
      projectId,
      status: req.query.status || null,
      responsableId: req.query.responsableId ? parseInt(req.query.responsableId) : null,
      unassigned: false,
      canal: null,
      productId: req.query.productId ? parseInt(req.query.productId) : null,
      search: null,
      page: 1,
      limit: 10000, // tope defensivo — Wasapi en un envío típico nunca pasa de unos miles
      includeConverted: req.query.includeConverted === 'true',
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      sort: 'fecha_desc',
      archived: false,
      duplicated: false,
      reincidente: false,
    };

    // Gestor solo ve los suyos — bloqueamos cualquier override por query.
    if (req.user.role === 'gestor') {
      filters.responsableId = req.user.userId;
    }

    const result = await leadModel.findAll(filters);
    let leads = result.leads.map((l) => ({
      nombre: l.nombre,
      email: l.email,
      telefono: l.telefono,
      status: l.status,
      producto_nombre: l.producto_interes, // alias del findAll
    }));

    // Filtros aplicados POST-query (sobre el resultado, antes de generar CSV).
    if (req.query.onlyWithPhone === 'true') {
      leads = leads.filter((l) => l.telefono && String(l.telefono).replace(/[^\d]/g, '').length >= 7);
    }
    if (req.query.pais) {
      const paisFilter = String(req.query.pais).toLowerCase();
      leads = leads.filter((l) => (detectCountry(l.telefono) || '').toLowerCase() === paisFilter);
    }

    const format = String(req.query.format || 'csv').toLowerCase();
    const baseName = `wasapi-leads-${new Date().toISOString().slice(0, 10)}`;
    if (format === 'xlsx' || format === 'xls') {
      const buf = await leadsToWasapiXlsx(leads);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
      res.send(buf);
      return;
    }
    const csv = leadsToWasapiCsv(leads, { withHeader: req.query.header !== 'false' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
    res.send(csv);
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

// ── #13 Cola de revisión de duplicados ─────────────────────────
export async function listReviewQueue(req, res, next) {
  try {
    const projectId = req.query.projectId ? parseInt(req.query.projectId) : null;
    const status = req.query.status || 'pending';
    const result = await dupQueue.list({ projectId, status });
    const counts = await dupQueue.counts(projectId);
    res.json({ success: true, data: result, counts });
  } catch (err) { next(err); }
}

export async function decideReviewQueue(req, res, next) {
  try {
    const queueId = parseInt(req.params.id);
    if (isNaN(queueId)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const { action, notas } = req.body || {};
    const result = await dupQueue.decide({ queueId, action, notas, userId: req.user.userId });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ── #18 Multi-cursos por lead ─────────────────────────────────
export async function listLeadProducts(req, res, next) {
  try {
    const leadId = parseInt(req.params.id);
    if (isNaN(leadId)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const items = await leadProducts.listForLead(leadId);
    res.json({ success: true, data: items });
  } catch (err) { next(err); }
}

export async function addLeadProduct(req, res, next) {
  try {
    const leadId = parseInt(req.params.id);
    if (isNaN(leadId)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const { product_id, responsable_id, notas } = req.body || {};
    const result = await leadProducts.addProduct({
      leadId, productId: parseInt(product_id),
      responsableId: responsable_id ? parseInt(responsable_id) : null,
      notas: notas || null,
      addedByUserId: req.user.userId,
      addedVia: 'manual',
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function updateLeadProduct(req, res, next) {
  try {
    const leadId = parseInt(req.params.id);
    const leadProductId = parseInt(req.params.lpId);
    if (isNaN(leadId) || isNaN(leadProductId)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const result = await leadProducts.updateProduct({
      leadProductId, leadId, fields: req.body || {}, userId: req.user.userId,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function removeLeadProduct(req, res, next) {
  try {
    const leadId = parseInt(req.params.id);
    const leadProductId = parseInt(req.params.lpId);
    if (isNaN(leadId) || isNaN(leadProductId)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const result = await leadProducts.removeProduct({ leadProductId, leadId });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
