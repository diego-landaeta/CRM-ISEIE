import { z } from 'zod';
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';

// FASE DE PRUEBA — endpoints para devoluciones.

const refundSchema = z.object({
  importe: z.coerce.number().positive('Importe debe ser positivo'),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato fecha: YYYY-MM-DD').optional(),
  motivo: z.string().max(500).optional().nullable(),
});

// GET /api/conversions/:id/refunds
export async function list(req, res, next) {
  try {
    const conversionId = parseInt(req.params.id);
    if (isNaN(conversionId)) throw new AppError('ID inválido', 400, 'INVALID_ID');
    const { rows } = await query(
      `SELECT r.id, r.conversion_id, r.importe, r.fecha, r.motivo, r.created_at,
              u.nombre AS created_by_nombre
       FROM conversion_refunds r
       LEFT JOIN users u ON u.id = r.created_by
       WHERE r.conversion_id = $1
       ORDER BY r.fecha DESC, r.id DESC`,
      [conversionId]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

// POST /api/conversions/:id/refunds
export async function create(req, res, next) {
  try {
    const conversionId = parseInt(req.params.id);
    if (isNaN(conversionId)) throw new AppError('ID inválido', 400, 'INVALID_ID');
    const parsed = refundSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');

    // Verificar que existe la conversión y obtener el importe pagado actual
    const { rows: conv } = await query(
      `SELECT id, importe_pagado FROM conversions WHERE id = $1`,
      [conversionId]
    );
    if (!conv[0]) throw new AppError('Conversión no encontrada', 404, 'CONVERSION_NOT_FOUND');

    // Calcular total ya reembolsado para validar que no exceda lo pagado
    const { rows: totals } = await query(
      `SELECT COALESCE(SUM(importe), 0)::numeric AS total FROM conversion_refunds WHERE conversion_id = $1`,
      [conversionId]
    );
    const yaReembolsado = Number(totals[0].total);
    const importePagado = Number(conv[0].importe_pagado);
    const disponible = importePagado - yaReembolsado;

    if (parsed.data.importe > disponible + 0.01) {
      throw new AppError(
        `Importe excede lo disponible (pagado: ${importePagado.toFixed(2)}€, ya reembolsado: ${yaReembolsado.toFixed(2)}€, disponible: ${disponible.toFixed(2)}€)`,
        400,
        'REFUND_EXCEEDS_PAID'
      );
    }

    const { rows } = await query(
      `INSERT INTO conversion_refunds (conversion_id, importe, fecha, motivo, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, conversion_id, importe, fecha, motivo, created_at`,
      [conversionId, parsed.data.importe, parsed.data.fecha || null, parsed.data.motivo || null, req.user.userId]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
}

// DELETE /api/conversion-refunds/:refundId
export async function remove(req, res, next) {
  try {
    const refundId = parseInt(req.params.refundId);
    if (isNaN(refundId)) throw new AppError('ID inválido', 400, 'INVALID_ID');
    const { rowCount } = await query(`DELETE FROM conversion_refunds WHERE id = $1`, [refundId]);
    if (rowCount === 0) throw new AppError('Devolución no encontrada', 404, 'REFUND_NOT_FOUND');
    res.json({ success: true });
  } catch (err) { next(err); }
}
