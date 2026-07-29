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

  // Si al cliente ya se le habia emitido una PROFORMA antes de registrar la venta,
  // se engancha ahora. Sin esto la proforma quedaba suelta y no aparecia en su ficha
  // (el panel busca los documentos DE la venta), aunque estuviera en el cliente correcto.
  // Solo se hace si hay UNA sola proforma suelta: con varias no se adivina cual es.
  try {
    const { query } = await import('../../shared/config/db.js');
    const { rows } = await query(
      `SELECT id FROM invoices
        WHERE lead_id = $1 AND tipo = 'proforma' AND conversion_id IS NULL AND estado <> 'cancelada'`,
      [data.lead_id]
    );
    if (rows.length === 1) {
      await query(`UPDATE invoices SET conversion_id = $2, updated_at = NOW() WHERE id = $1`, [rows[0].id, conv.id]);
      logger.info({ conversionId: conv.id, invoiceId: rows[0].id }, 'proforma suelta enganchada a la venta nueva');
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'enganche de proforma suelta fallo (no bloqueante)');
  }

  // Hook: crear comision automaticamente si hay regla
  commissionModel.createCommissionForConversion(conv.id).catch(err =>
    logger.warn({ err: err.message, conversionId: conv.id }, 'createCommission failed (non-blocking)')
  );

  // Hook: disparar email sequences con trigger conversion_created
  triggerSequences('conversion_created', data.lead_id, data.project_id);

  // Auto-factura del abono inicial: factura SOLO el monto pagado (no el total).
  if (conv._initial_payment_id) {
    autoInvoice(conv.id, userId, { paymentId: conv._initial_payment_id, importe: conv._initial_payment_importe });
  }

  return conv;
}

// Auto-emisión de factura POR PAGO (spec owner 2026-07-16): cada abono genera
// su propia factura por el monto pagado; el resto queda pendiente. No bloqueante:
// si falla se loguea y el pago sigue su curso.
// - Con paymentInfo {paymentId, importe} → factura por ese abono.
// - Sin paymentInfo (legacy) → factura por el total de la conversión.
export function autoInvoice(conversionId, userId = null, paymentInfo = null) {
  import('../invoices/invoices.model.js')
    .then((m) => (paymentInfo?.paymentId
      ? m.emitirFacturaDePago(conversionId, paymentInfo, userId)
      : m.autoEmitirPorPago(conversionId, userId)))
    .then((inv) => { if (inv?.codigo) logger.info({ conversionId, paymentId: paymentInfo?.paymentId, invoiceId: inv.id, codigo: inv.codigo }, 'auto-factura por pago'); })
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

export async function listProductos(filters) {
  return await conversionModel.listProductos(filters);
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
  const { permitir_duplicado, ...pago } = data || {};
  const result = await conversionModel.addPayment(conversionId, pago,
    { allowDuplicate: !!permitir_duplicado });
  if (result.error === 'NOT_FOUND') throw new AppError('Conversion no encontrada', 404, 'CONVERSION_NOT_FOUND');
  if (result.error === 'OVERPAY') throw new AppError('El importe excede el pendiente', 400, 'OVERPAY');
  if (result.error === 'DUPLICATE') {
    const d = result.existing;
    throw new AppError(
      `Ya hay un pago de ${Number(d.importe).toFixed(2)} EUR el ${String(d.fecha).slice(0, 10)} en esta venta. `
      + 'Si de verdad son dos cobros distintos, marca la casilla de duplicado permitido.',
      409, 'DUPLICATE_PAYMENT');
  }
  // Recalcular comision en cada pago (importe_base = importe_pagado actualizado)
  commissionModel.recalculateCommission(conversionId).catch(err =>
    logger.warn({ err: err.message, conversionId }, 'recalculateCommission failed (non-blocking)')
  );
  // Auto-factura al registrar el abono: una factura por ESTE pago (su monto).
  if (result.payment?.id) {
    autoInvoice(conversionId, null, { paymentId: result.payment.id, importe: Number(result.payment.importe) });
  }
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
