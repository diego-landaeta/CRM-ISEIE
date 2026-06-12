// EPIC B — Service de Egresos
// Centraliza la lógica de negocio. El controller solo hace I/O HTTP.
// Aquí enganchamos hooks futuros (B0 Stripe fee, C payable→expense, F nómina).

import * as model from './expense.model.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { saveLocal, getLocal, deleteLocal } from '../../shared/services/localStorage.service.js';
import crypto from 'crypto';

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

function extFromMime(mime) {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

// ============================================================
// CRUD
// ============================================================

export async function create(data, userId) {
  // Validación contable mínima: importe > 0 (ya validado en Zod) + categoría
  // dentro del enum (ya validado).
  const exp = await model.createExpense(data, userId);
  logger.info({ expenseId: exp.id, categoria: exp.categoria, importe: exp.importe }, 'Egreso registrado');
  return exp;
}

export async function update(id, fields) {
  const updated = await model.updateExpense(id, fields);
  if (!updated) throw new AppError('Sin cambios o egreso no encontrado', 400, 'NO_FIELDS_OR_NOT_FOUND');
  return updated;
}

export async function remove(id) {
  // Antes de borrar el expense, eliminar el archivo de comprobante si tiene.
  const existing = await model.findExpenseById(id);
  if (existing?.comprobante_key) {
    try { await deleteLocal(`expenses/${existing.comprobante_key}`); } catch (err) {
      logger.warn({ err: err.message, key: existing.comprobante_key }, 'No se pudo borrar comprobante (no crítico)');
    }
  }
  await model.deleteExpense(id);
  return { deleted: true };
}

// ============================================================
// Comprobante (upload / download / delete)
// ============================================================

/**
 * Guarda el archivo de comprobante en local storage y devuelve los metadatos
 * para que el frontend los anexe al payload de create/update del expense.
 *
 * No crea el expense — eso lo hace luego POST /api/expenses con los campos
 * comprobante_url, comprobante_key, etc. ya rellenados desde el response de
 * este endpoint.
 *
 * @param {Buffer} buffer
 * @param {string} mime
 * @param {number} originalSize
 * @returns {{ comprobante_url, comprobante_key, comprobante_mime, comprobante_size_bytes }}
 */
export async function uploadComprobante({ buffer, mime, size, baseUrl = '' }) {
  if (!ALLOWED_MIMES.has(mime)) {
    throw new AppError('Formato no permitido. Solo PDF, JPG, PNG, WEBP.', 400, 'INVALID_MIME');
  }
  if (size > MAX_SIZE_BYTES) {
    throw new AppError(`Archivo demasiado grande (máx ${MAX_SIZE_BYTES / 1024 / 1024} MB)`, 400, 'TOO_LARGE');
  }
  const ext = extFromMime(mime);
  const hash = crypto.randomBytes(8).toString('hex');
  // Key SIN slash en el medio para que el endpoint `/comprobante/:key` no
  // confunda routing. El path real en disco es `expenses/<key>` (compuesto en
  // saveLocal/getLocal abajo).
  const key = `${Date.now()}-${hash}.${ext}`;
  await saveLocal(`expenses/${key}`, buffer);

  const url = `${baseUrl}/api/expenses/comprobante/${key}`;
  return {
    comprobante_url: url,
    comprobante_key: key,
    comprobante_mime: mime,
    comprobante_size_bytes: size,
  };
}

/**
 * Lee el archivo de comprobante. El controller responde con buffer.
 * Anti path-traversal: la key no puede contener slashes ni '..'.
 */
export async function downloadComprobante(key) {
  if (typeof key !== 'string' || !key.length) {
    throw new AppError('Key requerida', 400, 'INVALID_KEY');
  }
  if (key.includes('/') || key.includes('..') || key.includes('\\')) {
    throw new AppError('Key inválida', 400, 'INVALID_KEY');
  }
  try {
    const { buffer, size } = await getLocal(`expenses/${key}`);
    return { buffer, size };
  } catch (err) {
    if (err.code === 'ENOENT') throw new AppError('Comprobante no encontrado', 404, 'NOT_FOUND');
    throw err;
  }
}

// ============================================================
// Helpers para hooks futuros (EPIC B0 / C / F)
// ============================================================

/**
 * EPIC B0 (Stripe): registra un expense por el fee de un payout de Stripe.
 * Idempotente: si ya existe un expense para ese payout, devuelve el existente.
 */
export async function createFromStripePayout({ projectId, importe, fecha, descripcion, stripePayoutId }) {
  const existing = await model.findBySourceStripePayoutId(stripePayoutId);
  if (existing) return existing;
  return await model.createExpense({
    project_id: projectId,
    concepto: descripcion || `Fee Stripe payout ${stripePayoutId}`,
    importe,
    fecha: fecha || new Date().toISOString().slice(0, 10),
    categoria: 'comision_pasarela_pago',
    notas: null,
    source_stripe_payout_id: stripePayoutId,
  }, null);
}

/**
 * EPIC C: registra expense cuando una cuenta por pagar se completa al 100%.
 * Idempotente: si ya existe expense con ese source_payable_id, devuelve el existente.
 */
export async function createFromPayable({ projectId, importe, fecha, concepto, categoria, payableId }) {
  const existing = await model.findBySourcePayableId(payableId);
  if (existing) return existing;
  return await model.createExpense({
    project_id: projectId,
    concepto: concepto || `Pago cuenta por pagar #${payableId}`,
    importe,
    fecha: fecha || new Date().toISOString().slice(0, 10),
    categoria: categoria || 'otros',
    notas: null,
    source_payable_id: payableId,
  }, null);
}
