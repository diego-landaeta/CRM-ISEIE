import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { resolvePath } from '../connectors/connectors.adapters.js';
import * as model from './make.model.js';
import * as leadService from '../leads/lead.service.js';
import { query } from '../../shared/config/db.js';
import { notifyAdmins } from '../notifications/notifications.service.js';
import { deducirMapeo, alcanzaParaCrear } from './make.campos-habituales.js';

export const AVISO_SIN_MAPEO = 'Sin mapeo: campos reconocidos por su nombre';

/** `email ← email · nombre ← full_name`, para el historial y el aviso. */
export function describirMapeo(mapeo) {
  return Object.entries(mapeo || {}).map(([d, r]) => `${d} ← ${r}`).join(' · ');
}

/**
 * Avisa a los admins de que un webhook activo no tiene mapeo (#627).
 *
 * Uno al día por webhook como mucho: el ICTESS mandó 15 en una semana y quince
 * avisos iguales no dicen más que uno. Nunca falla ni hace esperar a Make.
 */
export function avisarFaltaMapeo(hook, { mapeo = null, rechazado = false } = {}) {
  (async () => {
    const { rows } = await query(
      `SELECT 1 FROM admin_notifications
        WHERE type = 'make_sin_mapeo'
          AND metadata->>'webhook_id' = $1
          AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1`,
      [String(hook.id)]
    );
    if (rows.length) return;
    await notifyAdmins({
      type: 'make_sin_mapeo',
      title: `Webhook de Make sin mapeo: ${hook.label || hook.slug}`,
      message: rechazado
        ? 'Está en activo sin mapeo y el envío no trae ni correo ni nombre reconocibles: se ha rechazado. Guarda el mapeo.'
        : `Está en activo sin mapeo. Los prospectos entran con los campos reconocidos por su nombre (${describirMapeo(mapeo)}). Guarda el mapeo para no depender de eso.`,
      link_path: `/make-webhooks/${hook.id}`,
      metadata: { webhook_id: String(hook.id), project_id: hook.project_id },
    });
  })().catch((err) => logger.warn({ err: err.message, webhookId: hook.id }, 'Make: no se pudo avisar de la falta de mapeo'));
}

// Aplica field_mapping a un payload raw → objeto con shape esperado por
// leadService.processWebhook (nombre, email, telefono, responsable_email,
// producto_interes, custom_fields, etc.). Soporta paths dot-notation con
// los mismos helpers que connectors (resolvePath).
//
// field_mapping ejemplo: { "nombre": "data.name", "email": "data.email",
//   "responsable_email": "owner.email", "producto_interes": "product.name" }
//
// Claves no estándar van a custom_fields automáticamente.
const KNOWN_LEAD_FIELDS = new Set([
  'nombre', 'email', 'telefono',
  'responsable_email', 'responsable_id', 'responsable_nombre',
  'producto_interes', 'producto_interes_sku', 'producto_interes_id',
  'landing_url', 'canal', 'notas',
  'idempotency_key',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer',
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

// Llamado por el endpoint público al recibir un POST de Make.
// Verifica secret, captura sample, y según mode crea lead o solo guarda.
export async function handleIncoming({ slug, secret, payload, overrides = {}, ip }) {
  const hook = await model.findBySlug(slug);
  if (!hook) throw new AppError('Webhook no encontrado', 404, 'WEBHOOK_NOT_FOUND');
  if (!hook.active) throw new AppError('Webhook deshabilitado', 403, 'WEBHOOK_INACTIVE');
  // Comparación constante-time (no abrir oráculo de timing)
  if (!secret || secret.length !== hook.secret.length) {
    throw new AppError('Secret inválido', 401, 'INVALID_SECRET');
  }
  let secretOk = true;
  for (let i = 0; i < hook.secret.length; i++) {
    if (hook.secret.charCodeAt(i) !== secret.charCodeAt(i)) secretOk = false;
  }
  if (!secretOk) throw new AppError('Secret inválido', 401, 'INVALID_SECRET');

  // Siempre guardamos el sample (incluso en modo activo) para inspección.
  // Enriquecemos con los headers/overrides recibidos (asesora, canal) para
  // que el panel "Ultimo payload" deje ver si Make los está enviando.
  const sampleWithMeta = (Object.keys(overrides || {}).length > 0)
    ? { ...payload, _received_overrides: overrides }
    : payload;
  await model.saveSample(hook.id, sampleWithMeta);

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
  // toda la lógica de duplicados/spam/round-robin/idempotency ya existente)
  //
  // Sin mapeo (#627): antes se rechazaba el envío entero y, si no entraba por
  // otro lado, el prospecto se perdía —Make no reintenta—. Ahora se buscan los campos por su nombre
  // habitual (`email`, `full_name`, `phone_complete`, `course`…), se crea el
  // prospecto y se avisa al admin. Solo se rechaza si no aparece ni el correo
  // ni el nombre.
  const sinMapeo = !hook.field_mapping || Object.keys(hook.field_mapping).length === 0;
  const mapeo = sinMapeo ? deducirMapeo(payload) : hook.field_mapping;
  if (sinMapeo && !alcanzaParaCrear(mapeo)) {
    await model.logDelivery({
      webhook_id: hook.id, result: 'rejected', payload, mapped: null,
      error_message: 'field_mapping vacío en modo active y no se reconoce ni el correo ni el nombre',
    });
    avisarFaltaMapeo(hook, { rechazado: true });
    throw new AppError('Mapping no configurado', 400, 'NO_MAPPING');
  }

  const mapped = applyMapping(payload, mapeo);
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
      error_message: 'mapping no resolvió ni nombre ni email',
    });
    throw new AppError('Mapping no produjo nombre/email — revisa la configuración', 400, 'MAPPING_EMPTY');
  }

  // Usamos el webhook_api_key del proyecto para autenticar internamente
  // (reutilizamos processWebhook que requiere apiKey por slug). Para evitar
  // cargar el project completo aquí, pasamos un atajo que salta esa validación:
  // hacemos la llamada vía un service interno (createFromMake) que NO valida apiKey
  // pero sí ejecuta toda la lógica de negocio.
  try {
    const result = await leadService.createFromExternalWebhook(hook.project_id, mapped, {
      source: `make:${hook.slug}`,
      ip,
    });
    await model.bumpCounter(hook.id, { ok: true });
    await model.logDelivery({
      webhook_id: hook.id, result: 'accepted', lead_id: result.lead_id,
      payload, mapped,
      // Queda en el historial del webhook: entró, pero sin mapeo guardado.
      error_message: sinMapeo ? `${AVISO_SIN_MAPEO}: ${describirMapeo(mapeo)}` : null,
    });
    if (sinMapeo) avisarFaltaMapeo(hook, { mapeo });
    return { mode: 'active', ...result, ...(sinMapeo ? { sin_mapeo: true, mapeo_deducido: mapeo } : {}) };
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
