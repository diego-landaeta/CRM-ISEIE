import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { resolvePath } from '../connectors/connectors.adapters.js';
import * as model from './make.model.js';
// NOTA: requiere que leads/lead.service.js exporte createFromExternalWebhook(projectId, data, opts).
// En el CRM hermano existe; si en CRM-ISEIE aun no esta portado, este import
// fallara en runtime al recibir un payload en modo active. El modo test sigue
// funcionando porque no llama a leadService.
import * as leadService from '../leads/lead.service.js';

// Aplica field_mapping a un payload raw -> objeto con shape esperado por
// leadService.processWebhook (nombre, email, telefono, responsable_email,
// producto_interes, custom_fields, etc.). Soporta paths dot-notation con
// los mismos helpers que connectors (resolvePath).
//
// field_mapping ejemplo: { "nombre": "data.name", "email": "data.email",
//   "responsable_email": "owner.email", "producto_interes": "product.name" }
//
// Claves no estandar van a custom_fields automaticamente.
const KNOWN_LEAD_FIELDS = new Set([
  'nombre', 'email', 'telefono',
  'responsable_email', 'responsable_id', 'responsable_nombre',
  'producto_interes', 'producto_interes_sku', 'producto_interes_id',
  'landing_url', 'canal', 'notas',
  'idempotency_key',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
]);

export function applyMapping(payload, fieldMapping) {
  const out = { custom_fields: {} };
  for (const [crmField, source] of Object.entries(fieldMapping || {})) {
    if (!source || typeof source !== 'string') continue;
    const value = resolvePath(payload, source);
    if (value === undefined || value === null || value === '') continue;
    if (KNOWN_LEAD_FIELDS.has(crmField)) {
      out[crmField] = value;
    } else {
      out.custom_fields[crmField] = value;
    }
  }
  return out;
}

// Llamado por el endpoint publico al recibir un POST de Make.
// Verifica secret, captura sample, y segun mode crea lead o solo guarda.
export async function handleIncoming({ slug, secret, payload, overrides = {}, ip }) {
  const hook = await model.findBySlug(slug);
  if (!hook) throw new AppError('Webhook no encontrado', 404, 'WEBHOOK_NOT_FOUND');
  if (!hook.active) throw new AppError('Webhook deshabilitado', 403, 'WEBHOOK_INACTIVE');
  // Comparacion constante-time (no abrir oraculo de timing)
  if (!secret || secret.length !== hook.secret.length) {
    throw new AppError('Secret invalido', 401, 'INVALID_SECRET');
  }
  let secretOk = true;
  for (let i = 0; i < hook.secret.length; i++) {
    if (hook.secret.charCodeAt(i) !== secret.charCodeAt(i)) secretOk = false;
  }
  if (!secretOk) throw new AppError('Secret invalido', 401, 'INVALID_SECRET');

  // Siempre guardamos el sample (incluso en modo activo) para inspeccion
  await model.saveSample(hook.id, payload);

  // En modo test solo guardamos y avisamos
  if (hook.mode === 'test') {
    await model.logDelivery({
      webhook_id: hook.id, result: 'test_only', payload, mapped: null,
    });
    return {
      mode: 'test',
      received: true,
      payload_size: JSON.stringify(payload).length,
      message: 'Payload guardado. Mapea los campos en el CRM y cambia a modo "active" para crear leads.',
    };
  }

  // Modo activo: aplicar mapping y crear lead via processWebhook (reutiliza
  // toda la logica de duplicados/spam/round-robin/idempotency ya existente)
  if (!hook.field_mapping || Object.keys(hook.field_mapping).length === 0) {
    await model.logDelivery({
      webhook_id: hook.id, result: 'rejected', payload, mapped: null,
      error_message: 'field_mapping vacio en modo active',
    });
    throw new AppError('Mapping no configurado', 400, 'NO_MAPPING');
  }

  const mapped = applyMapping(payload, hook.field_mapping);
  // Aplicar overrides desde headers/query (responsable_email/nombre).
  // Estos ganan sobre lo mapeado del body.
  for (const [k, v] of Object.entries(overrides || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      mapped[k] = v;
    }
  }
  if (!mapped.nombre && !mapped.email) {
    await model.logDelivery({
      webhook_id: hook.id, result: 'rejected', payload, mapped,
      error_message: 'mapping no resolvio ni nombre ni email',
    });
    throw new AppError('Mapping no produjo nombre/email - revisa la configuracion', 400, 'MAPPING_EMPTY');
  }

  // Usamos el webhook_api_key del proyecto para autenticar internamente
  // (reutilizamos processWebhook que requiere apiKey por slug). Para evitar
  // cargar el project completo aqui, pasamos un atajo que salta esa validacion:
  // hacemos la llamada via un service interno (createFromMake) que NO valida apiKey
  // pero si ejecuta toda la logica de negocio.
  try {
    const result = await leadService.createFromExternalWebhook(hook.project_id, mapped, {
      source: `make:${hook.slug}`,
      ip,
    });
    await model.bumpCounter(hook.id, { ok: true });
    await model.logDelivery({
      webhook_id: hook.id, result: 'accepted', lead_id: result.lead_id,
      payload, mapped,
    });
    return { mode: 'active', ...result };
  } catch (err) {
    await model.bumpCounter(hook.id, { ok: false, errorMsg: err.message });
    await model.logDelivery({
      webhook_id: hook.id, result: 'rejected', payload, mapped,
      error_message: err.message,
    });
    logger.warn({ err, webhookId: hook.id }, 'Make webhook: lead no creado');
    throw err;
  }
}

// --- Admin CRUD (delegado al model) ---
export { model };
