import { AppError } from '../../shared/utils/AppError.js';
import * as leadModel from './lead.model.js';
import { query } from '../../shared/config/db.js';
import { sendLeadAssignedEmail } from '../../shared/services/brevo.service.js';
import { logger } from '../../shared/utils/logger.js';
import { normalizePhone } from '../../shared/utils/normalizePhone.js';
import { notifyAdmins } from '../notifications/notifications.service.js';

// Dispara secuencias de email activas. STUB v1 mientras email-sequences no este portado.
async function triggerSequences(_triggerEvent, _leadId, _projectId) {
  return;
}

// ============================================================
// DETECCION DE CANAL POR UTMs
// ============================================================

function detectChannel(utmSource, utmMedium) {
  if (!utmSource && !utmMedium) return 'directo';

  const source = (utmSource || '').toLowerCase();
  const medium = (utmMedium || '').toLowerCase();

  if (source.includes('facebook') || source.includes('instagram') || source.includes('fb') || source.includes('meta')) return 'meta_ads';
  if (source.includes('google') && (medium === 'cpc' || medium === 'ppc')) return 'google_ads';
  if (source.includes('tiktok')) return 'tiktok_ads';
  if (source.includes('chatgpt') || source.includes('openai')) return 'chatgpt_ia';
  if (medium === 'referral' || source.includes('referido')) return 'referido';
  if (medium === 'organic' || source.includes('google') || source.includes('bing')) return 'organico';

  return 'directo';
}

// ============================================================
// WEBHOOK (publico, autenticado por API key)
// ============================================================

export async function processWebhook(slug, apiKey, leadData) {
  const project = await leadModel.findProjectBySlug(slug);
  if (!project) throw new AppError('Proyecto no encontrado', 404, 'PROJECT_NOT_FOUND');
  if (project.webhook_api_key !== apiKey) throw new AppError('API key invalida', 401, 'INVALID_API_KEY');
  return _createLeadCore(project, leadData);
}

// Entrypoint para webhooks externos que YA validaron su propio secret
// (ej. Make webhooks, Meta Lead Ads). Reutiliza toda la lógica de
// dedupe/spam/round-robin sin requerir el webhook_api_key del proyecto.
export async function createFromExternalWebhook(projectId, leadData, _opts = {}) {
  const { rows } = await query(
    `SELECT id, nombre, slug, webhook_api_key FROM projects WHERE id = $1 AND active = true`,
    [projectId]
  );
  const project = rows[0];
  if (!project) throw new AppError('Proyecto no encontrado o inactivo', 404, 'PROJECT_NOT_FOUND');
  return _createLeadCore(project, leadData);
}

async function _createLeadCore(project, leadData) {
  // Idempotency: si Make reintenta con el mismo key dentro de 24h, devolvemos
  // el lead que ya creamos en lugar de duplicar.
  if (leadData.idempotency_key) {
    const existing = await leadModel.findLeadByIdempotencyKey(project.id, leadData.idempotency_key);
    if (existing) {
      return {
        lead_id: existing.id,
        responsable_id: existing.responsable_id,
        duplicado: false,
        reincidente: false,
        canal: null,
        idempotent_replay: true,
      };
    }
  }

  // Resolver producto: id > sku > nombre > landing_url (slug) > nada.
  // El SKU es clave en multi-sitio (mismo catálogo, nombres distintos por idioma).
  // landing_url (slug) cubre el caso de subdominios espejo donde el form NO
  // manda SKU explícito pero la URL termina en el slug del producto.
  let productoInteresId = leadData.producto_interes_id || null;
  if (!productoInteresId && leadData.producto_interes_sku) {
    const product = await leadModel.findProductBySku(leadData.producto_interes_sku, project.id);
    if (product) productoInteresId = product.id;
  }
  if (!productoInteresId && leadData.producto_interes) {
    const product = await leadModel.findProductByName(leadData.producto_interes, project.id);
    if (product) productoInteresId = product.id;
  }
  if (!productoInteresId && leadData.landing_url) {
    const product = await leadModel.findProductByLandingSlug(leadData.landing_url, project.id);
    if (product) productoInteresId = product.id;
  }

  // Resolver responsable forzado (Make decide): id directo > email > nombre.
  // El nombre se resuelve dentro del proyecto (case-insensitive, primera palabra
  // del nombre completo del user). Así Make puede mandar "Dayana" o "Ana" sin
  // tener que conocer los emails.
  let forcedResponsableId = leadData.responsable_id || null;
  if (!forcedResponsableId && leadData.responsable_email) {
    const user = await leadModel.findUserByEmail(leadData.responsable_email);
    if (user && user.active) forcedResponsableId = user.id;
  }
  if (!forcedResponsableId && leadData.responsable_nombre) {
    const user = await leadModel.findProjectUserByName(leadData.responsable_nombre, project.id);
    if (user) forcedResponsableId = user.id;
  }

  // Detección de SPAM recurrente: si este email ya fue marcado como spam en este
  // proyecto, el nuevo lead nace ya marcado como spam (queda fuera de listas y
  // round-robin). Devolvemos un flag para que el llamante sepa que ocurrió.
  const spamHistory = leadData.email ? await leadModel.findSpamMatch(leadData.email, project.id) : null;

  // Detectar duplicado por email O por teléfono normalizado (cualquiera basta).
  const telNormWebhook = normalizePhone(leadData.telefono);
  const duplicate = (leadData.email || telNormWebhook)
    ? await leadModel.findDuplicateByEmailOrPhone(leadData.email, telNormWebhook, project.id)
    : null;
  const duplicadoDe = duplicate ? duplicate.id : null;

  // Reincidente = mismo proyecto + mismo producto que duplicado
  const reincidente = !!(
    duplicate &&
    productoInteresId &&
    duplicate.producto_interes_id === productoInteresId
  );

  // Propuesto (cross-sell) = ya existe un lead CONVERTIDO del mismo email
  // y este nuevo pregunta por OTRO producto. Es una oportunidad calificada.
  const converted = leadData.email
    ? await leadModel.findConvertedByEmail(leadData.email, project.id)
    : null;
  const esPropuesto = !!(
    converted &&
    productoInteresId &&
    converted.producto_interes_id !== productoInteresId
  );
  const propuestoDe = esPropuesto ? converted.id : null;

  // Canal: override de Make > deteccion automatica por UTMs
  const canalDetectado = leadData.canal || detectChannel(leadData.utm_source, leadData.utm_medium);

  // Si es spam recurrente, no malgastamos un slot del round-robin.
  // Forzamos responsable null pasandolo como flag y luego lo soft-deleteamos.
  const skipAssign = !!spamHistory;

  // Crear lead con round-robin (o asignacion forzada si forcedResponsableId)
  const lead = await leadModel.createLeadWithRoundRobin({
    projectId: project.id,
    nombre: leadData.nombre,
    email: leadData.email || null,
    telefono: normalizePhone(leadData.telefono),
    productoInteresId,
    notas: leadData.notas || null,
    landingUrl: leadData.landing_url || null,
    duplicadoDe,
    reincidente,
    esPropuesto,
    propuestoDe,
    forcedResponsableId: skipAssign ? null : forcedResponsableId,
    skipRoundRobin: skipAssign,
    idempotencyKey: leadData.idempotency_key || null,
    customFields: leadData.custom_fields || null,
    utms: {
      utm_source: leadData.utm_source || null,
      utm_medium: leadData.utm_medium || null,
      utm_campaign: leadData.utm_campaign || null,
      utm_content: leadData.utm_content || null,
      utm_term: leadData.utm_term || null,
      landing_url: leadData.landing_url || null,
      canal_detectado: canalDetectado,
    },
  });

  // Si es spam recurrente, lo marcamos como eliminado automaticamente con
  // motivo 'spam' (auditoria) y NO disparamos secuencias ni notificaciones.
  if (skipAssign) {
    await leadModel.softDeleteLead(lead.id, {
      reason: 'spam',
      motivo: `Auto: email ya marcado como spam previamente (lead #${spamHistory.id})`,
      userId: null,
    });
    return {
      lead_id: lead.id,
      responsable_id: null,
      assignment_source: 'spam_skipped',
      duplicado: !!duplicadoDe,
      reincidente: false,
      spam_recurrente: true,
      spam_previous_lead_id: spamHistory.id,
      canal: canalDetectado,
    };
  }

  // Disparar email sequences con trigger lead_created (async)
  triggerSequences('lead_created', lead.id, project.id);

  // Trazabilidad de duplicado por webhook (admin lo verá en el filtro).
  if (duplicadoDe) {
    const reincidenteTag = reincidente ? ' [REINCIDENTE — mismo producto]' : '';
    Promise.all([
      leadModel.createInteraction(lead.id, 'nota', `🔁 Marcado como duplicado del lead #${duplicadoDe}${reincidenteTag} — entrada por webhook.`, null, null),
      leadModel.createInteraction(duplicadoDe, 'nota', `📌 Llegó un nuevo lead duplicado #${lead.id} (${lead.nombre || 'sin nombre'}) por webhook.${reincidenteTag}`, null, null),
    ]).catch((err) => logger.warn({ err: err.message, leadId: lead.id, duplicadoDe }, 'No se pudo registrar interaction de duplicado webhook'));
  }

  // Notificar al gestor asignado (async - no bloquea respuesta del webhook <500ms)
  if (lead.responsableId) {
    (async () => {
      try {
        const { rows } = await query(`SELECT id, nombre, email FROM users WHERE id = $1`, [lead.responsableId]);
        if (rows[0]?.email) {
          const baseUrl = process.env.CRM_BASE_URL || 'http://localhost:5173/crm';
          await sendLeadAssignedEmail({
            gestor: rows[0],
            lead: { id: lead.id, nombre: lead.nombre, email: lead.email, telefono: lead.telefono },
            proyecto: { nombre: project.nombre },
            baseUrl,
          });
        }
      } catch (err) {
        logger.warn({ err: err.message, leadId: lead.id }, 'Notificacion gestor fallo');
      }
    })();
  }

  return {
    lead_id: lead.id,
    responsable_id: lead.responsableId,
    assignment_source: lead.assignmentSource,  // 'webhook' (Make decidió) o 'round_robin'
    duplicado: !!duplicadoDe,
    duplicado_de: duplicadoDe,
    reincidente,
    canal: canalDetectado,
  };
}

// ============================================================
// SOFT DELETE (superadmin)
// ============================================================

export async function softDelete(leadId, { reason, motivo, userId }) {
  const validReasons = ['spam', 'test', 'duplicado_manual', 'otro'];
  if (!validReasons.includes(reason)) {
    throw new AppError('reason invalido (spam, test, duplicado_manual, otro)', 400, 'INVALID_REASON');
  }
  // Lookup datos antes del delete para incluirlos en la notif (deleted_at filtra después).
  const leadRow = await leadModel.findByIdLight(leadId);
  const { rows: leadFull } = await query(`SELECT nombre, email, telefono FROM leads WHERE id = $1`, [leadId]);
  const leadInfo = leadFull[0] || {};
  const result = await leadModel.softDeleteLead(leadId, { reason, motivo, userId });
  if (!result) throw new AppError('Lead no encontrado o ya eliminado', 404, 'LEAD_NOT_FOUND');

  // Notif admin/superadmin (#16)
  notifyAdmins({
    type: 'lead_deleted',
    title: `Lead #${leadId} eliminado`,
    message: `${leadInfo.nombre || '—'} (${leadInfo.email || leadInfo.telefono || '—'}) — motivo: ${reason}${motivo ? ' · ' + motivo : ''}`,
    link_path: `/leads/papelera`,
    metadata: { lead_id: leadId, reason, motivo, project_id: leadRow?.project_id },
    triggered_by_user_id: userId || null,
  });

  return result;
}

export async function restore(leadId) {
  const result = await leadModel.restoreLead(leadId);
  if (!result) throw new AppError('Lead no encontrado', 404, 'LEAD_NOT_FOUND');
  return result;
}

// Historial de compra del email del lead: todas las conversiones previas en el proyecto.
// Util para mostrar en la ficha cuando el lead es "propuesto" (cross-sell).
export async function getPurchaseHistory(leadId) {
  const { rows } = await query(`SELECT email, project_id FROM leads WHERE id = $1`, [leadId]);
  if (!rows[0]?.email) return [];
  return await leadModel.findPurchaseHistory(rows[0].email, rows[0].project_id);
}

// ============================================================
// LISTADO + DETALLE
// ============================================================

export async function list(filters) {
  const result = await leadModel.findAll(filters);

  // Calcular valor_oportunidad por percentiles del proyecto.
  // - alto:  precio >= percentil 67 (top tercio)
  // - medio: percentil 34-66
  // - bajo:  percentil < 34
  // - n/a:   sin producto matcheado
  // Calculamos contra TODO el catálogo de productos del proyecto del lead.
  // Cache por proyecto para no recalcular en cada fila.
  // v1: `products.precio` no existe; todos los leads salen con producto_precio=NULL.
  // Skip todo el cálculo de oportunidad. Cuando se porte products extendido,
  // quitar el early-return.
  if (!result.leads.some((l) => l.producto_precio != null)) {
    for (const lead of result.leads) {
      lead.valor_oportunidad = 'sin_producto';
      lead.valor_oportunidad_score = 0;
    }
    return result;
  }

  const projectThresholdsCache = new Map();
  async function getThresholds(projectId) {
    if (projectThresholdsCache.has(projectId)) return projectThresholdsCache.get(projectId);
    try {
      const { rows } = await query(
        `SELECT
           PERCENTILE_CONT(0.34) WITHIN GROUP (ORDER BY precio) AS p34,
           PERCENTILE_CONT(0.67) WITHIN GROUP (ORDER BY precio) AS p67
         FROM products
         WHERE project_id = $1 AND active = true AND precio IS NOT NULL AND precio > 0`,
        [projectId]
      );
      const t = rows[0] && rows[0].p34 != null
        ? { p34: Number(rows[0].p34), p67: Number(rows[0].p67) }
        : { p34: 100, p67: 500 }; // fallback genérico
      projectThresholdsCache.set(projectId, t);
      return t;
    } catch (_) {
      const fallback = { p34: 100, p67: 500 };
      projectThresholdsCache.set(projectId, fallback);
      return fallback;
    }
  }
  for (const lead of result.leads) {
    if (lead.producto_precio == null) {
      lead.valor_oportunidad = 'sin_producto';
      lead.valor_oportunidad_score = 0;
      continue;
    }
    const t = await getThresholds(lead.project_id);
    const p = Number(lead.producto_precio);
    if (p >= t.p67) lead.valor_oportunidad = 'alto';
    else if (p >= t.p34) lead.valor_oportunidad = 'medio';
    else lead.valor_oportunidad = 'bajo';
    lead.valor_oportunidad_score = p;
  }
  return result;
}

export async function getById(id) {
  const lead = await leadModel.findById(id);
  if (!lead) throw new AppError('Lead no encontrado', 404, 'LEAD_NOT_FOUND');
  return lead;
}

export async function getStats(projectId, opts = {}) {
  return await leadModel.getStats(projectId, opts);
}

export async function getTodaySummary(ctx) {
  return await leadModel.getTodaySummary(ctx);
}

// ============================================================
// OPERACIONES
// ============================================================

export async function changeStatus(leadId, newStatus, motivo, userId) {
  const lead = await leadModel.findByIdLight(leadId);
  if (!lead) throw new AppError('Lead no encontrado', 404, 'LEAD_NOT_FOUND');
  if (lead.status === newStatus) throw new AppError('El lead ya tiene ese status', 400, 'SAME_STATUS');

  await leadModel.updateStatus(leadId, newStatus, lead.status, userId);

  // Disparar email sequences con trigger status_changed (async)
  triggerSequences('status_changed', leadId, lead.project_id);

  return { previous: lead.status, current: newStatus };
}

export async function addInteraction(leadId, tipo, nota, userId, fecha) {
  const lead = await leadModel.findByIdLight(leadId);
  if (!lead) throw new AppError('Lead no encontrado', 404, 'LEAD_NOT_FOUND');

  return await leadModel.createInteraction(leadId, tipo, nota, userId, fecha);
}

export async function addReminder(leadId, fechaRecordatorio, nota, userId) {
  const lead = await leadModel.findByIdLight(leadId);
  if (!lead) throw new AppError('Lead no encontrado', 404, 'LEAD_NOT_FOUND');

  return await leadModel.createReminder(leadId, fechaRecordatorio, nota, userId);
}

export async function markReminderComplete(reminderId) {
  await leadModel.completeReminder(reminderId);
  return { message: 'Recordatorio completado' };
}

export async function reassign(leadId, newResponsableId, userId) {
  const lead = await leadModel.findByIdLight(leadId);
  if (!lead) throw new AppError('Lead no encontrado', 404, 'LEAD_NOT_FOUND');

  const prevResponsableId = lead.responsable_id || null;
  await leadModel.reassignLead(leadId, newResponsableId);
  await leadModel.updateStatus(leadId, lead.status, lead.status, userId);

  // Registrar en historial: gestor anterior → nuevo gestor, quién lo hizo
  try {
    const { rows } = await query(
      `SELECT id, nombre, email FROM users WHERE id = ANY($1::int[])`,
      [[prevResponsableId, newResponsableId, userId].filter(Boolean)]
    );
    const byId = Object.fromEntries(rows.map((u) => [u.id, u.nombre || u.email]));
    const prevName = prevResponsableId ? (byId[prevResponsableId] || `gestor #${prevResponsableId}`) : 'sin asignar';
    const newName = byId[newResponsableId] || `gestor #${newResponsableId}`;
    const actorName = byId[userId] || 'sistema';
    await leadModel.createInteraction(
      leadId,
      'nota',
      `👤 Reasignado de ${prevName} a ${newName} por ${actorName}.`,
      userId,
      null
    );
  } catch (err) {
    logger.warn({ err: err.message, leadId }, 'No se pudo registrar interaction de reasignación (no crítico)');
  }

  return { message: 'Lead reasignado', responsable_id: newResponsableId };
}

export async function reassignPending(projectId) {
  return await leadModel.reassignPendingRoundRobin(projectId);
}

// Fusiona dos leads (winner + loser). Validaciones de negocio antes de llamar al model.
export async function mergeLeads({ winnerId, loserId, comment, userId }) {
  if (!comment || comment.trim().length < 3) {
    throw new AppError('Comentario obligatorio para auditoría', 400, 'COMMENT_REQUIRED');
  }
  try {
    return await leadModel.mergeLeads({ winnerId, loserId, comment: comment.trim(), userId });
  } catch (err) {
    throw new AppError(err.message || 'Error en fusión', 400, 'MERGE_FAILED');
  }
}

// Lookup público: devuelve leads con ese email en el proyecto, sólo metadata
// segura para mostrar a un gestor (sin acceso a contenido sensible).
export async function lookupByEmail(email, projectId) {
  const { rows } = await query(
    `SELECT l.id, l.nombre, l.email, l.status, l.created_at, l.responsable_id,
            u.nombre AS responsable_nombre
     FROM leads l
     LEFT JOIN users u ON u.id = l.responsable_id
     WHERE l.project_id = $1
       AND LOWER(l.email) = $2
       AND l.deleted_at IS NULL
     ORDER BY l.created_at DESC
     LIMIT 5`,
    [projectId, email]
  );
  return rows;
}

// Comprueba duplicado SIN crear nada. Para el confirm dialog del frontend.
// Si gestor consulta, solo busca dentro de leads asignados a él/su proyecto (delegamos seguridad a projectAccess).
export async function checkDuplicate({ project_id, email, telefono }, requestUser) {
  if (!project_id) throw new AppError('project_id requerido', 400, 'MISSING_PROJECT');
  const telNorm = normalizePhone(telefono);
  const cleanEmail = email ? String(email).toLowerCase().trim() : null;
  if (!cleanEmail && !telNorm) return { duplicate: null };
  const dup = await leadModel.findDuplicateByEmailOrPhone(cleanEmail, telNorm, project_id);
  if (!dup) return { duplicate: null };
  // Si quien pregunta es gestor y el dup pertenece a otro responsable, exponemos
  // solo lo necesario para que sepa a quién contactar (nombre del gestor + estado),
  // ocultando datos personales del lead (email/tel/nombre completo/notas).
  if (requestUser?.role === 'gestor' && dup.responsable_id && dup.responsable_id !== requestUser.userId) {
    return {
      duplicate: {
        id: dup.id,
        masked: true,
        responsable_nombre: dup.responsable_nombre || 'otro gestor',
        status: dup.status,
        created_at: dup.created_at,
        message: `Ya existe un lead con estos datos asignado a ${dup.responsable_nombre || 'otro gestor'}`,
      },
    };
  }
  return { duplicate: dup };
}

export async function createManualLead({ project_id, nombre, email, telefono, producto_interes_id, canal, notas, custom_fields }, opts = {}) {
  const creatorUser = opts.creatorUser || null;
  // Detectar duplicado por email O por teléfono normalizado (cualquiera basta).
  const telNorm = normalizePhone(telefono);
  const duplicate = (email || telNorm) ? await leadModel.findDuplicateByEmailOrPhone(email, telNorm, project_id) : null;

  // Dedupe rapido: si el duplicado es del mismo nombre y fue creado en los ultimos 10s,
  // asumimos doble submit y devolvemos el lead existente en vez de crear otro
  if (duplicate && duplicate.nombre === nombre) {
    const age = Date.now() - new Date(duplicate.created_at || duplicate.fecha_solicitud).getTime();
    if (age < 10_000) {
      return {
        lead_id: duplicate.id,
        responsable_id: duplicate.responsable_id,
        duplicado: true,
        reincidente: false,
        deduped: true,
      };
    }
  }

  const duplicadoDe = duplicate ? duplicate.id : null;

  const reincidente = !!(
    duplicate &&
    producto_interes_id &&
    duplicate.producto_interes_id === producto_interes_id
  );

  // Cross-sell: cliente ya convertido pregunta por otro producto
  const converted = email ? await leadModel.findConvertedByEmail(email, project_id) : null;
  const esPropuesto = !!(
    converted &&
    producto_interes_id &&
    converted.producto_interes_id !== producto_interes_id
  );
  const propuestoDe = esPropuesto ? converted.id : null;

  // Si el creador es gestor/admin (no superadmin/soporte), el lead se le asigna
  // a el/ella aunque venga por formulario manual — el round-robin avanza igual,
  // asi que la siguiente asignacion automatica no le vuelve a tocar.
  let forcedResponsableId = null;
  let advanceRoundRobin = false;
  if (creatorUser && (creatorUser.role === 'gestor' || creatorUser.role === 'admin')) {
    forcedResponsableId = creatorUser.userId;
    advanceRoundRobin = true;
  }

  const lead = await leadModel.createLeadWithRoundRobin({
    projectId: project_id,
    nombre,
    email,
    telefono: normalizePhone(telefono),
    productoInteresId: producto_interes_id || null,
    notas: notas || null,
    landingUrl: null,
    duplicadoDe,
    reincidente,
    esPropuesto,
    propuestoDe,
    forcedResponsableId,
    advanceRoundRobinAnyway: advanceRoundRobin,
    utms: {
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
      landing_url: null,
      canal_detectado: canal || 'directo',
    },
    customFields: custom_fields,
  });

  // Disparar email sequences con trigger lead_created (async)
  triggerSequences('lead_created', lead.id, project_id);

  // Registrar trazabilidad de duplicado en el historial de AMBOS leads, enlazados.
  // El usuario quiere ver claramente que es duplicado de X (y desde el original
  // ver que se creó Y como duplicado).
  if (duplicadoDe) {
    const creatorId = creatorUser?.userId || null;
    const creatorName = creatorUser?.email || creatorUser?.name || 'sistema';
    const reincidenteTag = reincidente ? ' [REINCIDENTE — mismo producto]' : '';
    try {
      await Promise.all([
        leadModel.createInteraction(
          lead.id,
          'nota',
          `🔁 Marcado como duplicado del lead #${duplicadoDe}${reincidenteTag} — creado por ${creatorName} tras confirmar el aviso de duplicado.`,
          creatorId,
          null
        ),
        leadModel.createInteraction(
          duplicadoDe,
          'nota',
          `📌 Se creó un nuevo lead duplicado #${lead.id} (${nombre || 'sin nombre'}) por ${creatorName}.${reincidenteTag}`,
          creatorId,
          null
        ),
      ]);
    } catch (err) {
      logger.warn({ err: err.message, leadId: lead.id, duplicadoDe }, 'No se pudo registrar interaction de duplicado (no crítico)');
    }
  }

  return {
    lead_id: lead.id,
    responsable_id: lead.responsableId,
    duplicado: !!duplicadoDe,
    duplicado_de: duplicadoDe,
    reincidente,
    canal: canal || 'directo',
  };
}

export async function updateLead(leadId, data, opts = {}) {
  const lead = await leadModel.findById(leadId);
  if (!lead) throw new AppError('Lead no encontrado', 404, 'LEAD_NOT_FOUND');

  // Normalizar teléfono si viene en el update
  if (Object.prototype.hasOwnProperty.call(data, 'telefono')) {
    data.telefono = normalizePhone(data.telefono);
  }
  // Normalizar email vacío a null
  if (Object.prototype.hasOwnProperty.call(data, 'email') && (data.email === '' || !data.email)) {
    data.email = null;
  }

  // El canal NO va en tabla leads sino en lead_utms — se maneja aparte
  const newCanal = data.canal;
  if (newCanal !== undefined) delete data.canal;

  // Snapshot de valores ANTERIORES (solo de campos que vienen en `data`).
  // Capturamos antes del UPDATE para registrar en el audit log.
  const auditFields = ['nombre', 'email', 'telefono', 'notas', 'producto_interes_id'];
  const auditableData = {};
  for (const f of auditFields) {
    if (Object.prototype.hasOwnProperty.call(data, f) && data[f] !== lead[f]) {
      auditableData[f] = { old: lead[f], new: data[f] };
    }
  }
  // Canal también auditable (viene en variable separada porque va a lead_utms)
  if (newCanal !== undefined) {
    const oldCanal = lead.utms?.canal_detectado || null;
    if (oldCanal !== newCanal) {
      auditableData.canal = { old: oldCanal, new: newCanal };
    }
  }

  const updated = await leadModel.updateLead(leadId, data);

  // UPDATE/INSERT lead_utms.canal_detectado si se cambió
  if (newCanal !== undefined) {
    await query(
      `INSERT INTO lead_utms (lead_id, canal_detectado, created_at)
       VALUES ($1, $2::utm_channel, NOW())
       ON CONFLICT (lead_id) DO UPDATE SET canal_detectado = EXCLUDED.canal_detectado`,
      [leadId, newCanal]
    );
  }
  if (!updated) throw new AppError('No se actualizo el lead', 400, 'NO_FIELDS');

  // Audit log: una fila por campo modificado. Si falla, log pero no rompe.
  const userId = opts.userId || null;
  for (const [field, { old, new: nv }] of Object.entries(auditableData)) {
    try {
      await query(
        `INSERT INTO lead_audit_log (lead_id, field_name, old_value, new_value, changed_by_user_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [leadId, field, old != null ? String(old) : null, nv != null ? String(nv) : null, userId]
      );
    } catch (err) {
      logger.warn({ err: err.message, leadId, field }, 'audit log insert falló (no crítico)');
    }
  }

  // APRENDIZAJE: si el usuario vinculó manualmente un producto a este lead
  // y el lead tiene landing_url, guardamos el slug como alias. Los futuros
  // leads desde esa URL se vincularán solos.
  if (
    'producto_interes_id' in data &&
    data.producto_interes_id &&
    data.producto_interes_id !== lead.producto_interes_id &&
    lead.landing_url
  ) {
    try {
      await leadModel.learnUrlAlias({
        projectId: lead.project_id,
        productId: data.producto_interes_id,
        landingUrl: lead.landing_url,
        userId: opts.userId || null,
      });
    } catch (err) {
      logger.warn({ err: err.message, leadId, productId: data.producto_interes_id }, 'learnUrlAlias failed (no critico)');
    }
  }

  return updated;
}

export async function getLeadSequences(_leadId, _requestUser) {
  // STUB v1 (depende de email_sequence_runs / email_sequences).
  return [];
}
