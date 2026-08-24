import { AppError } from '../../shared/utils/AppError.js';
import * as leadModel from './lead.model.js';
import { query } from '../../shared/config/db.js';
import { sendLeadAssignedEmail } from '../../shared/services/brevo.service.js';
import { logger } from '../../shared/utils/logger.js';
import { normalizePhone } from '../../shared/utils/normalizePhone.js';
import { notifyAdmins } from '../notifications/notifications.service.js';
import * as dupQueue from './dup-queue.service.js';
import * as leadProducts from './lead-products.service.js';

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

/**
 * Saca las UTM de dentro de la propia direccion.
 *
 * Make manda la pagina donde la persona dejo sus datos, y esa direccion YA trae
 * las UTM pegadas — es como llegan de Meta:
 *
 *   .../curso-de-coaching-familiar/?fbclid=...&utm_source=fb&utm_medium=paid
 *      &utm_campaign=120244428100730715&utm_content=...&utm_term=...
 *
 * El CRM guardaba esa direccion entera y no la leia, asi que un lead de Meta se
 * quedaba en «directo» teniendo `utm_source=fb` delante. Pedirle a Make que las
 * mande otra vez aparte seria mandar dos veces el mismo dato y confiar en que
 * nadie se olvide de una.
 *
 * Lo que venga suelto en el cuerpo MANDA sobre lo que diga la direccion: si
 * alguien se molesto en mapearlo a mano, sabra por que.
 */
function utmsDeLaUrl(url) {
  if (!url || typeof url !== 'string') return {};
  let params;
  try {
    params = new URL(url).searchParams;
  } catch {
    return {};   // no es una direccion valida: no se inventa nada
  }
  const sacar = (clave) => {
    const v = params.get(clave);
    return v && v.trim() ? v.trim() : undefined;
  };
  return {
    utm_source: sacar('utm_source'),
    utm_medium: sacar('utm_medium'),
    utm_campaign: sacar('utm_campaign'),
    utm_content: sacar('utm_content'),
    utm_term: sacar('utm_term'),
  };
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
  // Las UTM, sacadas de la propia direccion si no vinieron sueltas.
  //
  // Va AQUI y no en processWebhook porque hay dos puertas de entrada y por la
  // otra —la de Make, `createFromExternalWebhook`— entran casi todos. Ponerlo en
  // una sola dejaba fuera justo el camino que importa: el lead #3417 de ISAEG
  // llego con `utm_source=fb` dentro de la direccion y se guardo como «directo».
  //
  // Este es el sitio por el que pasan las dos.
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    if (!leadData[k]) {
      const deLaUrl = utmsDeLaUrl(leadData?.landing_url);
      if (deLaUrl[k]) leadData[k] = deLaUrl[k];
    }
  }
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

  // Burst-merge: si el MISMO email/tel pide el MISMO producto en una ventana
  // corta (default 2min), no creamos un lead nuevo — sumamos una interacción
  // al lead original. Esto agrupa los rebotes de Make / form duplicados y
  // mantiene limpia la cola del gestor.
  const BURST_WINDOW_S = parseInt(process.env.LEAD_BURST_WINDOW_SECONDS || '120', 10);
  if (duplicate && reincidente && BURST_WINDOW_S > 0) {
    const dupAgeS = (Date.now() - new Date(duplicate.created_at).getTime()) / 1000;
    if (dupAgeS <= BURST_WINDOW_S) {
      const msg = leadData.notas || leadData.message || null;
      const msgTag = msg ? ` — mensaje: "${String(msg).substring(0, 200)}"` : '';
      const utmTag = leadData.utm_source ? ` · utm_source=${leadData.utm_source}` : '';
      const text = `🔁 Re-envío del mismo formulario (mismo producto) detectado por webhook · hace ${Math.round(dupAgeS)}s${msgTag}${utmTag}`;
      leadModel.createInteraction(duplicate.id, 'nota', text, null, null)
        .catch((err) => logger.warn({ err: err.message, leadId: duplicate.id }, 'No se pudo registrar burst-merge interaction'));
      logger.info({ leadId: duplicate.id, dupAgeS, window: BURST_WINDOW_S, project: project.id }, 'lead burst-merged into existing');
      return {
        lead_id: duplicate.id,
        responsable_id: duplicate.responsable_id || null,
        assignment_source: 'burst_merged',
        duplicado: true,
        reincidente: true,
        burst_merged: true,
        canal: canalDetectado,
      };
    }
  }

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

    // #13: encolar para revisión de admin (no bloquea Make — fire-and-forget)
    dupQueue.enqueue({
      leadId: lead.id,
      originalLeadId: duplicadoDe,
      projectId: project.id,
      matchByEmail: !!(duplicate && duplicate.match_by_email),
      matchByPhone: !!(duplicate && duplicate.match_by_phone),
      source: 'webhook',
      leadName: lead.nombre,
    });

    // #18: si el duplicado pidió OTRO producto, añadirlo al lead original como secundario.
    // Esto permite al admin ver "este cliente ya pidió esto + ahora también esto otro" en una sola ficha.
    if (productoInteresId && duplicate && duplicate.producto_interes_id !== productoInteresId) {
      leadProducts.autoAddFromReincidente({
        originalLeadId: duplicadoDe,
        newProductId: productoInteresId,
        newLeadId: lead.id,
        addedByUserId: null,
      });
    }
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

  // Registrar como interacción para trazabilidad en el feed (aparte de notif).
  // Iconos varían según reason — facilitan lectura rápida del timeline.
  if (motivo && motivo.trim()) {
    const icon = reason === 'spam' ? '🛑' : reason === 'duplicado_manual' ? '🔁' : reason === 'test' ? '🧪' : '🗑️';
    const label = reason === 'spam' ? 'Marcado spam' : reason === 'duplicado_manual' ? 'Duplicado manual' : reason === 'test' ? 'Lead de prueba' : 'Eliminado';
    try {
      await leadModel.createInteraction(leadId, 'nota', `${icon} ${label} · ${motivo.trim()}`, userId, null);
    } catch (_) { /* no crítico */ }
  }

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

  // Cuando se marca como NO INTERESADO con motivo: guardar también una nota
  // en interacciones para que el motivo quede en el feed del lead (no solo en
  // status_history). El equipo necesita trazabilidad rápida del por qué.
  if (newStatus === 'no_interesado' && motivo && motivo.trim()) {
    try {
      await leadModel.createInteraction(leadId, 'nota', `❌ No interesado · ${motivo.trim()}`, userId, null);
    } catch (err) {
      logger.warn({ err: err.message, leadId }, 'No se pudo registrar interaction de no_interesado');
    }
  }

  // Disparar email sequences con trigger status_changed (async)
  triggerSequences('status_changed', leadId, lead.project_id);

  return { previous: lead.status, current: newStatus };
}

export async function addInteraction(leadId, tipo, nota, userId, fecha) {
  const lead = await leadModel.findByIdLight(leadId);
  if (!lead) throw new AppError('Lead no encontrado', 404, 'LEAD_NOT_FOUND');

  return await leadModel.createInteraction(leadId, tipo, nota, userId, fecha);
}

// Edición de una interacción existente. Gestor solo puede editar las suyas;
// admin/superadmin pueden editar cualquiera. Útil para corregir notas/fecha
// que se grabaron mal sin tener que borrar y re-crear.
export async function updateInteractionFn(leadId, interactionId, fields, requestUser) {
  const interaction = await leadModel.findInteractionById(interactionId);
  if (!interaction) throw new AppError('Interacción no encontrada', 404, 'INTERACTION_NOT_FOUND');
  if (interaction.lead_id !== leadId) throw new AppError('Interacción no pertenece al lead', 400, 'WRONG_LEAD');
  if (requestUser?.role === 'gestor' && interaction.created_by !== requestUser.userId) {
    throw new AppError('No tienes permiso para editar esta interacción', 403, 'FORBIDDEN');
  }
  const updated = await leadModel.updateInteraction(interactionId, fields);
  if (!updated) throw new AppError('Sin cambios', 400, 'NO_FIELDS');
  return updated;
}

export async function deleteInteractionFn(leadId, interactionId, requestUser) {
  const interaction = await leadModel.findInteractionById(interactionId);
  if (!interaction) throw new AppError('Interacción no encontrada', 404, 'INTERACTION_NOT_FOUND');
  if (interaction.lead_id !== leadId) throw new AppError('Interacción no pertenece al lead', 400, 'WRONG_LEAD');
  if (requestUser?.role === 'gestor' && interaction.created_by !== requestUser.userId) {
    throw new AppError('No tienes permiso para eliminar esta interacción', 403, 'FORBIDDEN');
  }
  await leadModel.deleteInteraction(interactionId);
  return { deleted: true };
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

  // Ni profesores ni quien lleva las colaboraciones. Se comprueba AQUI y no solo
  // escondiendolos del desplegable: quien no sale en una lista sigue teniendo un
  // numero, y basta con mandarlo a mano para colarlo. Y un prospecto en la
  // bandeja de alguien que no atiende prospectos no lo llama nadie.
  const { rows: destino } = await query(
    `SELECT nombre, role, COALESCE(gestor_colaboraciones, false) AS colaboraciones
       FROM users WHERE id = $1 AND active = true`, [newResponsableId]);
  if (!destino.length) throw new AppError('Esa persona no existe o está desactivada', 400, 'DESTINO_INVALIDO');
  if (destino[0].role === 'tutor') {
    throw new AppError(`${destino[0].nombre} es profesor: no lleva prospectos`, 400, 'NO_ATIENDE_PROSPECTOS');
  }
  if (destino[0].colaboraciones) {
    throw new AppError(`${destino[0].nombre} lleva las colaboraciones de los profesores: no atiende prospectos`, 400, 'NO_ATIENDE_PROSPECTOS');
  }

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
    const result = await leadModel.mergeLeads({ winnerId, loserId, comment: comment.trim(), userId });
    // Si el loser estaba en cola de revisión, marcarlo como merged.
    // CON AWAIT: sin él, el endpoint podía devolver respuesta antes de que la
    // UPDATE corra, dejando la entrada como 'pending' aunque el merge se hizo.
    await dupQueue.markMerged(loserId, userId);
    // Notif admin/superadmin (visibilidad operativa, como en softDelete)
    notifyAdmins({
      type: 'lead_merged',
      title: `Fusión: lead #${loserId} → #${winnerId}`,
      message: comment.trim(),
      link_path: `/leads/${winnerId}`,
      metadata: { winner_id: winnerId, loser_id: loserId },
      triggered_by_user_id: userId || null,
    });
    return result;
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
  // Se mantiene el aviso enmascarado solo si NO hay responsable identificable;
  // entre gestoras se enseñan los datos, que es lo que permite decidir si es la
  // misma persona sin tener que preguntar.
  if (false && requestUser?.role === 'gestor' && dup.responsable_id && dup.responsable_id !== requestUser.userId) {
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
    const telefonoOriginal = data.telefono;
    data.telefono = normalizePhone(telefonoOriginal);
    if (telefonoOriginal && !data.telefono) {
      throw new AppError('El teléfono no tiene un formato válido. Incluye el código de país y al menos 7 dígitos.', 400, 'INVALID_PHONE');
    }
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

  // Un cambio exclusivo de canal no toca la tabla leads; aun así es válido.
  const updated = Object.keys(data).length > 0
    ? await leadModel.updateLead(leadId, data)
    : lead;

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
