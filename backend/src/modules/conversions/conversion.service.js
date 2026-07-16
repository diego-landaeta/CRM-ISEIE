import { AppError } from '../../shared/utils/AppError.js';
import * as conversionModel from './conversion.model.js';
import * as commissionModel from '../commissions/commission.model.js';
import * as seqModel from '../email-sequences/sequence.model.js';
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';

async function triggerSequences(triggerEvent, leadId, projectId) {
  try {
    const { rows: seqs } = await query(
      `SELECT id FROM email_sequences WHERE project_id = $1 AND trigger_event = $2 AND active = true`,
      [projectId, triggerEvent]
    );
    for (const seq of seqs) await seqModel.startRun(seq.id, leadId);
    if (seqs.length) logger.info({ triggerEvent, leadId, count: seqs.length }, 'Email sequences disparadas');
  } catch (err) {
    logger.warn({ err: err.message, triggerEvent, leadId }, 'Error disparando email sequences');
  }
}

export async function create(data, userId) {
  // Validar que el lead pertenece al project_id
  const ok = await conversionModel.leadBelongsToProject(data.lead_id, data.project_id);
  if (!ok) throw new AppError('El lead no pertenece a este proyecto', 400, 'LEAD_PROJECT_MISMATCH');

  // Auto-lookup de producto_contratado_id si llega el texto pero no el id.
  // Evita el bug histórico de tener `producto_contratado` (varchar) sin FK al
  // catálogo de products. Matching por nombre normalizado (sin acentos,
  // lowercase). Solo aceptamos si el match es ÚNICO en el proyecto — si hay
  // varios productos con el mismo nombre normalizado, dejamos NULL para no
  // adivinar mal.
  if (!data.producto_contratado_id && data.producto_contratado) {
    try {
      const { rows } = await query(
        `WITH norm AS (
           SELECT id FROM products
           WHERE project_id = $1 AND active = TRUE
             AND LOWER(TRANSLATE(nombre, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'))
                 = LOWER(TRANSLATE($2::text, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'))
         )
         SELECT id FROM norm`,
        [data.project_id, data.producto_contratado]
      );
      if (rows.length === 1) {
        data.producto_contratado_id = rows[0].id;
      } else if (rows.length > 1) {
        logger.warn({ project: data.project_id, texto: data.producto_contratado, candidatos: rows.length },
          'producto_contratado_id: lookup ambiguo, dejamos NULL');
      }
    } catch (err) {
      // No bloqueamos la creación si el lookup falla — solo dejamos NULL y log.
      logger.warn({ err: err.message }, 'auto-lookup producto_contratado_id falló (no bloqueante)');
    }
  }

  const conv = await conversionModel.create({ ...data, changed_by: userId });

  // Hook: crear comision automaticamente si hay regla
  commissionModel.createCommissionForConversion(conv.id).catch(err =>
    logger.warn({ err: err.message, conversionId: conv.id }, 'createCommission failed (non-blocking)')
  );

  // Hook: disparar email sequences con trigger conversion_created
  triggerSequences('conversion_created', data.lead_id, data.project_id);

  // Auto-factura: si la venta entra YA con pago, se emite factura numerada.
  if (Number(data.importe_pagado || 0) > 0) autoInvoice(conv.id, userId);

  return conv;
}

// Auto-emisión de factura al registrar un pago (spec owner 2026-07-15): en
// cuanto entra un pago, la conversión debe quedar con factura EMITIDA y su
// correlativo. No bloqueante: si falla se loguea y el pago sigue su curso.
export function autoInvoice(conversionId, userId = null) {
  import('../invoices/invoices.model.js')
    .then((m) => m.autoEmitirPorPago(conversionId, userId))
    .then((inv) => { if (inv?.codigo) logger.info({ conversionId, invoiceId: inv.id, codigo: inv.codigo }, 'auto-factura por pago'); })
    .catch((err) => logger.warn({ err: err.message, conversionId }, 'auto-factura por pago falló (no bloqueante)'));
}

export async function getById(id) {
  const conversion = await conversionModel.findById(id);
  if (!conversion) throw new AppError('Conversion no encontrada', 404, 'CONVERSION_NOT_FOUND');
  return conversion;
}

export async function listByLead(leadId) {
  return await conversionModel.findByLead(leadId);
}

export async function list(filters) {
  return await conversionModel.findAll(filters);
}

export async function update(id, fields) {
  const existing = await conversionModel.findById(id);
  if (!existing) throw new AppError('Conversion no encontrada', 404, 'CONVERSION_NOT_FOUND');

  // Si cambian importe_total, no puede ser menor a importe_pagado
  if (fields.importe_total !== undefined && fields.importe_total < Number(existing.importe_pagado)) {
    throw new AppError('importe_total no puede ser menor a importe_pagado', 400, 'INVALID_TOTAL');
  }

  const updated = await conversionModel.update(id, fields);
  if (!updated) throw new AppError('No se actualizo', 400, 'NO_FIELDS');
  return updated;
}

export async function addPayment(conversionId, data) {
  const result = await conversionModel.addPayment(conversionId, data);
  if (result.error === 'NOT_FOUND') throw new AppError('Conversion no encontrada', 404, 'CONVERSION_NOT_FOUND');
  if (result.error === 'OVERPAY') throw new AppError('El importe excede el pendiente', 400, 'OVERPAY');
  // Recalcular comision en cada pago (importe_base = importe_pagado actualizado)
  commissionModel.recalculateCommission(conversionId).catch(err =>
    logger.warn({ err: err.message, conversionId }, 'recalculateCommission failed (non-blocking)')
  );
  // Auto-factura al registrar el abono (si aún no existe, se emite numerada).
  autoInvoice(conversionId);
  return result;
}

export async function removePayment(paymentId) {
  const deleted = await conversionModel.deletePayment(paymentId);
  if (!deleted) throw new AppError('Pago no encontrado', 404, 'PAYMENT_NOT_FOUND');
  return { message: 'Pago eliminado' };
}

export async function remove(id, { reason, motivo, userId } = {}) {
  const existing = await conversionModel.findById(id);
  if (!existing) throw new AppError('Conversion no encontrada', 404, 'CONVERSION_NOT_FOUND');

  // Antes de borrar, dejamos rastro en lead_interactions para auditoría.
  if (existing.lead_id && reason) {
    try {
      const { query } = await import('../../shared/config/db.js');
      const REASON_LABELS = {
        duplicada: 'Compra duplicada',
        error_carga: 'Error al cargar',
        anulacion_cliente: 'Anulación del cliente',
        otro: 'Otro',
      };
      const nota = `Compra eliminada — ${REASON_LABELS[reason] || reason}: ${existing.producto_contratado} (${existing.importe_total}€)${motivo ? `. Motivo: ${motivo}` : ''}`;
      await query(
        `INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, fecha)
         VALUES ($1, 'nota', $2, $3, NOW())`,
        [existing.lead_id, nota, userId || null]
      );
    } catch (err) {
      // El log no debe bloquear el borrado
    }
  }

  await conversionModel.deleteConversion(id);
  return { message: 'Conversion eliminada', reason, motivo };
}
