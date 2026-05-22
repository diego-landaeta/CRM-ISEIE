import { z } from 'zod';
import * as model from './form.model.js';
import { AppError } from '../../shared/utils/AppError.js';
import * as leadModel from '../leads/lead.model.js';
import * as matriculaModel from '../matriculas/matricula.model.js';
import { autoMap } from './field-aliases.js';
import { parseInboundEmail } from './mail-parser.js';
import { query } from '../../shared/config/db.js';

// Normaliza URL para matching: quita protocol, www, query string, fragment, trailing slash
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/?(\?.*)?(\#.*)?$/, '')
    .replace(/\/$/, '');
}

// Extrae el slug "interesante" de una URL (último segmento de path).
function pathSlug(normUrl) {
  if (!normUrl) return '';
  const parts = normUrl.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

// Similaridad simple por tokens: cuántos tokens del slug del producto aparecen en el slug del lead.
// Devuelve 0..1.
function slugSimilarity(slugA, slugB) {
  if (!slugA || !slugB) return 0;
  const tA = slugA.split(/[-_]+/).filter((t) => t.length >= 3);
  const tB = slugB.split(/[-_]+/).filter((t) => t.length >= 3);
  if (tA.length === 0 || tB.length === 0) return 0;
  const setB = new Set(tB);
  const hits = tA.filter((t) => setB.has(t)).length;
  return hits / Math.max(tA.length, tB.length);
}

// Busca el producto del proyecto cuya url_info matchea la URL dada.
// 3 niveles de match:
//   1) Exacto (URL normalizada idéntica)
//   2) Prefijo: la URL del lead empieza con la URL del producto (o viceversa)
//   3) Similaridad de slug: comparar los últimos segmentos de path por tokens
// Devuelve { product_id, source: 'exact'|'prefix'|'slug_similarity', score }
async function findProductByUrlScored(projectId, url) {
  if (!url) return null;
  const norm = normalizeUrl(url);
  if (!norm) return null;

  const { rows: products } = await query(
    `SELECT id, url_info FROM products
     WHERE project_id = $1 AND url_info IS NOT NULL AND active = true`,
    [projectId]
  );
  if (products.length === 0) return null;

  // 1) Exacto
  for (const p of products) {
    if (normalizeUrl(p.url_info) === norm) return { product_id: p.id, source: 'exact', score: 1 };
  }
  // 2) Prefijo
  for (const p of products) {
    const pn = normalizeUrl(p.url_info);
    if (pn && (norm.startsWith(pn + '/') || norm === pn || pn.startsWith(norm + '/'))) {
      return { product_id: p.id, source: 'prefix', score: 0.85 };
    }
  }
  // 3) Similaridad de slug del último path
  const leadSlug = pathSlug(norm);
  let best = null;
  for (const p of products) {
    const productNorm = normalizeUrl(p.url_info);
    const productSlug = pathSlug(productNorm);
    const sim = slugSimilarity(leadSlug, productSlug);
    if (sim >= 0.5 && (!best || sim > best.score)) {
      best = { product_id: p.id, source: 'slug_similarity', score: sim };
    }
  }
  return best;
}

// Wrapper de retrocompatibilidad: devuelve solo el id (uso interno legacy).
async function findProductByUrl(projectId, url) {
  const r = await findProductByUrlScored(projectId, url);
  return r ? r.product_id : null;
}

const createSchema = z.object({
  project_id: z.number().int().positive(),
  nombre: z.string().min(1).max(200),
  kind: z.enum(['form', 'webhook']).optional(),
  webhook_mode: z.enum(['json', 'email', 'both']).optional(),  // solo si kind=webhook
  destination: z.enum(['lead', 'matricula']).optional(),
  template_kind: z.enum(['contacto_basico', 'lead_con_producto', 'custom']).optional(),
  schema: z.record(z.string(), z.any()).optional(),
  config: z.record(z.string(), z.any()).optional(),
  field_mapping: z.record(z.string(), z.union([
    z.string(),                                                                    // 'path.al.value'
    z.array(z.string()),                                                           // ['path1', 'path2'] -> concatenados con ' '
    z.object({                                                                     // { sources, separator?, prefix?, suffix? }
      sources: z.array(z.string()),
      separator: z.string().optional(),
      prefix: z.string().optional(),
      suffix: z.string().optional(),
    }),
  ])).optional(),
  active: z.boolean().optional(),
  default_product_id: z.number().int().positive().nullable().optional(),
  url_match_enabled: z.boolean().optional(),
});
const updateSchema = createSchema.partial().omit({ project_id: true });

export async function list(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    if (!projectId) throw new AppError('projectId requerido', 400, 'PROJECT_REQUIRED');
    const kind = req.query.kind === 'form' || req.query.kind === 'webhook' ? req.query.kind : null;
    res.json({ success: true, data: await model.findAll(projectId, kind) });
  } catch (err) { next(err); }
}
export async function getById(req, res, next) {
  try {
    const f = await model.findById(parseInt(req.params.id));
    if (!f) throw new AppError('Form no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: f });
  } catch (err) { next(err); }
}
export async function create(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    res.status(201).json({ success: true, data: await model.create({ ...parsed.data, created_by: req.user.id }) });
  } catch (err) { next(err); }
}
export async function update(req, res, next) {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    const u = await model.update(parseInt(req.params.id), parsed.data);
    if (!u) throw new AppError('Form no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: u });
  } catch (err) { next(err); }
}
export async function remove(req, res, next) {
  try { await model.remove(parseInt(req.params.id)); res.json({ success: true }); }
  catch (err) { next(err); }
}

export async function startListening(req, res, next) {
  try {
    const r = await model.setListenMode(parseInt(req.params.id), true);
    if (!r) throw new AppError('Form no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}
export async function stopListening(req, res, next) {
  try {
    const r = await model.setListenMode(parseInt(req.params.id), false);
    if (!r) throw new AppError('Form no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}
export async function getStatus(req, res, next) {
  try {
    const f = await model.findById(parseInt(req.params.id));
    if (!f) throw new AppError('Form no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: { awaiting_sample: f.awaiting_sample, sample_payload: f.sample_payload, sample_received_at: f.sample_received_at, field_mapping: f.field_mapping } });
  } catch (err) { next(err); }
}

// PUBLIC: render meta del form (frontend embed lo lee)
export async function publicMeta(req, res, next) {
  try {
    const f = await model.findByEmbed(req.params.embedId);
    if (!f) throw new AppError('Form no disponible', 404, 'NOT_FOUND');
    res.json({
      success: true, data: {
        nombre: f.nombre,
        template_kind: f.template_kind,
        schema: f.schema,
        config: f.config,
        project: { nombre: f.project_nombre, emoji: f.project_emoji, logo: f.project_logo, producto_label: f.producto_label, producto_label_plural: f.producto_label_plural },
      },
    });
  } catch (err) { next(err); }
}

// Resuelve un path tipo "data.contact.email" sobre un objeto
function resolvePath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

// Normaliza el body del webhook según el formato enviado por el cliente:
//   - JSON simple: {nombre: "Juan", email: "..."}                                -> tal cual
//   - Elementor Pro Webhook: {form_id, form_name, fields: {nombre: {value, ...}, email: {value, ...}}}
//     -> aplana a {nombre: "Juan", email: "...", _form_id, _form_name}
//   - form-urlencoded de Elementor Pro: form_fields[nombre]=Juan&form_fields[email]=...
//     -> aplana las keys form_fields[X]
//   - Otros: pasa tal cual y deja que autoMap haga su magia
function normalizeWebhookBody(body) {
  if (!body || typeof body !== 'object') return {};

  // Detectar Elementor Pro Webhook (tiene 'fields' como objeto con .value)
  if (body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)) {
    const sampleKey = Object.keys(body.fields)[0];
    const sampleVal = body.fields[sampleKey];
    if (sampleVal && typeof sampleVal === 'object' && 'value' in sampleVal) {
      const flat = {};
      for (const [k, v] of Object.entries(body.fields)) {
        flat[k] = v?.value ?? v;
      }
      if (body.form_id) flat._form_id = body.form_id;
      if (body.form_name) flat._form_name = body.form_name;
      return flat;
    }
  }

  // Detectar form-urlencoded estilo form_fields[X]
  const flatFields = {};
  let hasFormFields = false;
  for (const [k, v] of Object.entries(body)) {
    const m = k.match(/^form_fields\[([^\]]+)\]$/);
    if (m) {
      flatFields[m[1]] = v;
      hasFormFields = true;
    }
  }
  if (hasFormFields) {
    if (body.form_id) flatFields._form_id = body.form_id;
    if (body.form_name) flatFields._form_name = body.form_name;
    return flatFields;
  }

  return body;
}

// PUBLIC: webhook receptor JSON. NUNCA devuelve error al cliente — registra en historial.
// Solo 404 legítimo si el embed_id no existe (puede que el creador haya borrado el webhook).
export async function publicWebhook(req, res, next) {
  try {
    const f = await model.findByEmbed(req.params.embedId);
    if (!f || f.kind !== 'webhook') {
      return res.status(404).json({ success: false, error: 'Webhook no encontrado', code: 'NOT_FOUND' });
    }
    // Aunque el modo no coincida, RESPONDER 200 para no romper UX del form externo,
    // y registrar el evento como 'wrong_mode' para que el admin se entere.
    if (f.webhook_mode === 'email') {
      await safeLogEvent(f.id, 'webhook', req.body, 'error', 'Endpoint configurado solo para email; usar /mailhook/', req.ip);
      return res.json({ success: true, data: { received: true } });
    }
    const normalized = normalizeWebhookBody(req.body || {});
    return processInboundPayload(req, res, next, normalized, 'webhook', f);
  } catch (err) {
    // Cualquier error inesperado: registrar y devolver 200
    await safeLogEvent(null, 'webhook', req.body, 'error', err.message, req.ip).catch(() => {});
    return res.json({ success: true, data: { received: true } });
  }
}

// PUBLIC: mailhook. Mismo principio: nunca rompe el cliente.
export async function publicMailhook(req, res, next) {
  try {
    const f = await model.findByEmbed(req.params.embedId);
    if (!f || f.kind !== 'webhook') {
      return res.status(404).json({ success: false, error: 'Mailhook no encontrado', code: 'NOT_FOUND' });
    }
    if (f.webhook_mode === 'json') {
      await safeLogEvent(f.id, 'mailhook', req.body, 'error', 'Endpoint configurado solo para JSON; usar /webhook/', req.ip);
      return res.json({ success: true, data: { received: true } });
    }
    const { fields: extracted, meta } = parseInboundEmail(req.body);
    extracted._mail_from = meta.from;
    extracted._mail_subject = meta.subject;
    return processInboundPayload(req, res, next, extracted, 'mailhook', f);
  } catch (err) {
    await safeLogEvent(null, 'mailhook', req.body, 'error', err.message, req.ip).catch(() => {});
    return res.json({ success: true, data: { received: true } });
  }
}

// Helper: log event sin lanzar excepciones (silencioso)
async function safeLogEvent(formId, source, payload, status, errorMessage, ip) {
  if (!formId) return;
  try {
    await model.logEvent({ form_template_id: formId, source, payload, status, error_message: errorMessage, ip_address: ip });
  } catch { /* no romper nunca */ }
}

// Procesa payload (de webhook o mailhook) con tolerancia: auto-detect, custom_fields, no rompe.
async function processInboundPayload(req, res, next, body, source, preloadedForm = null) {
  try {
    const f = preloadedForm || await model.findByEmbed(req.params.embedId);
    if (!f || f.kind !== 'webhook') throw new AppError('Webhook no disponible', 404, 'NOT_FOUND');

    // Modo escucha: capturar payload sin procesar (estilo Make/Zapier)
    if (f.awaiting_sample) {
      await model.saveSample(f.id, body);
      await model.logEvent({ form_template_id: f.id, source, payload: body, status: 'sample_captured', ip_address: req.ip });
      return res.json({ success: true, data: { mode: 'listen', captured: true, source, message: 'Payload capturado para mapeo.' } });
    }

    const mapping = f.field_mapping || {};
    // Resolver mapping explícito. Cada entry puede ser:
    //   - string:  { telefono: 'path.al.tel' }
    //   - array:   { telefono: ['Prefijo país', 'telefono'] }      <- concatenado con espacio
    //   - objeto:  { telefono: { sources: ['Pref', 'tel'], separator: ' ', prefix: '+' } }
    //
    // Si es array u objeto con sources, se concatenan los valores no vacíos.
    const mapped = {};
    for (const [target, def] of Object.entries(mapping)) {
      if (typeof def === 'string') {
        const v = resolvePath(body, def);
        if (v !== undefined && v !== null && v !== '') mapped[target] = v;
      } else if (Array.isArray(def)) {
        // Concatenación simple: array de paths con separador ' '
        const values = def.map(p => resolvePath(body, p)).filter(v => v !== undefined && v !== null && v !== '');
        if (values.length) mapped[target] = values.join(' ').trim();
      } else if (def && typeof def === 'object' && Array.isArray(def.sources)) {
        // Concatenación con configuración avanzada
        const sep = def.separator !== undefined ? def.separator : ' ';
        const prefix = def.prefix || '';
        const suffix = def.suffix || '';
        const values = def.sources.map(p => resolvePath(body, p)).filter(v => v !== undefined && v !== null && v !== '');
        if (values.length) mapped[target] = `${prefix}${values.join(sep)}${suffix}`.trim();
      }
    }

    // Auto-detect fallback: para cualquier campo del lead que NO se haya mapeado explícitamente,
    // intentamos detectarlo del body por aliases comunes (Nombre/Email/Teléfono/etc en cualquier idioma)
    const auto = autoMap(body);
    const final = { ...auto, ...mapped };  // mapping explícito gana sobre auto-detect

    // Cualquier key del body que no se mapeó va a custom_fields para no perder info
    const customFields = { ...(final.custom_fields || {}), ...(auto._unmapped || {}) };
    delete final._unmapped;
    delete final.custom_fields;

    // Concatenar prefijo país + teléfono si vienen separados (típico Elementor:
    // PREFIJO PAÍS = +34, TELÉFONO = 600123456 -> final '+34 600123456')
    if (final._phone_prefix && final.telefono) {
      const prefix = String(final._phone_prefix).trim();
      const num = String(final.telefono).trim();
      // Si el número ya empieza con + o con el mismo prefijo, no duplicar
      if (!num.startsWith('+') && !num.startsWith(prefix.replace(/^\+/, ''))) {
        const cleanPrefix = prefix.startsWith('+') ? prefix : `+${prefix}`;
        final.telefono = `${cleanPrefix} ${num}`;
      }
    } else if (final._phone_prefix && !final.telefono) {
      // Solo llegó prefijo sin número - guardarlo en custom_fields, no como telefono
      customFields.phone_prefix_only = final._phone_prefix;
    }
    delete final._phone_prefix;

    // Routing por destination
    const destination = f.destination || 'lead';
    if (destination === 'matricula') {
      const dedupe = final.dni || final.email || null;
      if (dedupe) {
        const exists = await matriculaModel.findByDedupe(f.project_id, dedupe);
        if (exists) {
          await model.incrementSubmissions(f.id);
          return res.json({ success: true, data: { matricula_id: exists.id, action: 'duplicate_skipped' } });
        }
      }
      const m = await matriculaModel.create({
        project_id: f.project_id,
        dni: final.dni || null,
        titulo: final.titulo || null,
        notas: final.notas || null,
        datos_admision: req.body,
        source: 'webhook',
        dedupe_key: dedupe,
        estado: 'solicitud_admision',
      });
      await model.incrementSubmissions(f.id);
      return res.json({ success: true, data: { matricula_id: m.id, action: 'created' } });
    }

    // destination 'lead' (default)
    const fallbackNombre = final.nombre || customFields._mail_subject || '(sin nombre)';
    if (!final.email) {
      throw new AppError('Sin email no se puede crear lead. Payload guardado para debug.', 422, 'NO_EMAIL_FOUND');
    }

    // Resolver producto_interes_id por URL matching o default
    // SAFE parseInt: si el valor mapeado no es numérico (ej. nombre del producto), NaN -> null
    let productoInteresId = null;
    if (final.producto_interes_id !== undefined && final.producto_interes_id !== null) {
      const parsed = parseInt(final.producto_interes_id);
      if (!isNaN(parsed) && parsed > 0) productoInteresId = parsed;
    }
    let productoMatchSource = productoInteresId ? 'manual' : null;

    if (!productoInteresId && f.url_match_enabled !== false) {
      // Recolectar candidatos de URL agresivamente:
      //   - los conocidos en snake_case
      //   - los headers HTTP
      //   - CUALQUIER key del body cuyo nombre contenga "page|url|referer|landing"
      //     y cuyo valor parezca URL (http://...)
      const candidateUrls = [
        final.landing_url,
        body.landing_url,
        body.page_url,
        body.referrer,
        body.referer,
        req.headers?.referer,
        req.headers?.referrer,
        body._wp_http_referer,
        body.page,
      ].filter(Boolean);

      // Scanner del body: keys con "page|url|referer|landing" + valor http(s)://
      if (body && typeof body === 'object') {
        for (const [k, v] of Object.entries(body)) {
          if (!v || typeof v !== 'string') continue;
          if (!/^https?:\/\//i.test(v)) continue;
          if (/page|url|referer|landing|source|origen/i.test(k)) {
            if (!candidateUrls.includes(v)) candidateUrls.push(v);
          }
        }
      }

      for (const url of candidateUrls) {
        const matched = await findProductByUrl(f.project_id, url);
        if (matched) {
          productoInteresId = matched;
          productoMatchSource = `url_match:${url}`;
          break;
        }
      }
      // Si no matcheó NINGÚN producto, al menos guardamos la primera URL detectada
      // como landing_url para que el admin la vea en el detalle.
      if (!productoInteresId && candidateUrls.length > 0) {
        if (!final.landing_url) final.landing_url = candidateUrls[0];
      }
    }

    // Fallback al producto por defecto del webhook si no hubo match
    if (!productoInteresId && f.default_product_id) {
      productoInteresId = f.default_product_id;
      productoMatchSource = 'default_product';
    }

    const lead = await leadModel.createLeadWithRoundRobin({
      projectId: f.project_id,
      nombre: fallbackNombre,
      email: final.email,
      telefono: final.telefono || null,
      productoInteresId,
      notas: final.notas || null,
      landingUrl: final.landing_url || body.landing_url || req.headers?.referer || null,
      utms: {
        utm_source: final.utm_source || source,
        utm_medium: final.utm_medium || (source === 'mailhook' ? 'email' : 'api'),
        utm_campaign: final.utm_campaign || f.embed_id,
      },
      customFields,
    });
    await model.incrementSubmissions(f.id);
    await model.logEvent({
      form_template_id: f.id, source, payload: body, status: 'success',
      result_type: 'lead', result_id: lead.id, ip_address: req.ip,
    });
    res.json({
      success: true,
      data: {
        lead_id: lead.id,
        source,
        mapped_fields: Object.keys(final),
        unmapped_count: Object.keys(customFields).length,
        producto_interes_id: productoInteresId,
        producto_match_source: productoMatchSource,
      },
    });
  } catch (err) {
    // Registrar el error en el historial pero NUNCA devolver error al cliente.
    // El form externo (Elementor/Make/etc) debe ver siempre 200 para no romper UX.
    try {
      const f = preloadedForm || await model.findByEmbed(req.params.embedId).catch(() => null);
      if (f) await model.logEvent({
        form_template_id: f.id, source, payload: body, status: 'error',
        error_message: err.message, ip_address: req.ip,
      });
    } catch { /* silencioso */ }
    // Respuesta 200 con detalle del error para debug interno (no impacta UX del form externo)
    return res.json({
      success: true,
      data: { received: true, processing_error: err.message?.slice(0, 200) || 'Internal error' },
    });
  }
}

// GET /api/forms/:id/events - historial de eventos recibidos (admin)
export async function listEvents(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) throw new AppError('ID inválido', 400, 'INVALID_ID');
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const events = await model.listEvents(id, limit);
    res.json({ success: true, data: events });
  } catch (err) { next(err); }
}

// PUBLIC: submission. Crea lead.
export async function publicSubmit(req, res, next) {
  try {
    const f = await model.findByEmbed(req.params.embedId);
    if (!f) throw new AppError('Form no disponible', 404, 'NOT_FOUND');
    const body = req.body || {};
    if (!body.nombre || !body.email) throw new AppError('Nombre y email requeridos', 400, 'VALIDATION_ERROR');
    const lead = await leadModel.createLeadWithRoundRobin({
      projectId: f.project_id,
      nombre: body.nombre,
      email: body.email,
      telefono: body.telefono || null,
      productoInteresId: body.producto_interes_id ? parseInt(body.producto_interes_id) : null,
      notas: body.notas || null,
      landingUrl: body.landing_url || null,
      utms: {
        utm_source: body.utm_source || 'form',
        utm_medium: body.utm_medium || 'embed',
        utm_campaign: body.utm_campaign || f.embed_id,
      },
      customFields: body.custom_fields || {},
    });
    await model.incrementSubmissions(f.id);
    res.json({ success: true, data: { lead_id: lead.id, redirect_url: f.config?.redirect_url || null } });
  } catch (err) { next(err); }
}
