import { z } from 'zod';
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';

const toggleSchema = z.object({
  is_available: z.boolean(),
  motivo: z.string().max(500).optional().nullable(),
});

const blockSchema = z.object({
  fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato fecha: YYYY-MM-DD'),
  fecha_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato fecha: YYYY-MM-DD'),
  motivo: z.string().max(500).optional().nullable(),
}).refine((d) => d.fecha_fin >= d.fecha_inicio, { message: 'fecha_fin debe ser igual o posterior a fecha_inicio' });

// GET /users/availability
export async function listAvailability(_req, res, next) {
  try {
    const { rows } = await query(
      `SELECT u.id, u.nombre, u.email, u.role, u.active, u.is_available,
              u.unavailable_reason, u.unavailable_since,
              (
                SELECT row_to_json(b) FROM (
                  SELECT id, fecha_inicio, fecha_fin, motivo
                  FROM user_availability_blocks
                  WHERE user_id = u.id AND CURRENT_DATE BETWEEN fecha_inicio AND fecha_fin
                  ORDER BY fecha_inicio ASC LIMIT 1
                ) b
              ) AS bloque_activo,
              (
                SELECT COUNT(*) FROM user_availability_blocks
                WHERE user_id = u.id AND fecha_fin >= CURRENT_DATE
              )::int AS bloques_futuros
         FROM users u
        WHERE u.role IN ('admin', 'gestor', 'superadmin', 'soporte')
        ORDER BY u.active DESC, u.nombre ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

// PATCH /users/:id/availability
export async function setAvailability(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = toggleSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');

    const { is_available, motivo } = parsed.data;
    const { rows } = await query(
      `UPDATE users
          SET is_available = $1,
              unavailable_reason = CASE WHEN $1 = false THEN $2 ELSE NULL END,
              unavailable_since  = CASE WHEN $1 = false THEN NOW() ELSE NULL END,
              updated_at = NOW()
        WHERE id = $3
        RETURNING id, nombre, is_available, unavailable_reason, unavailable_since`,
      [is_available, motivo || null, id]
    );
    if (rows.length === 0) throw new AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND');
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
}

// GET /users/:id/availability-blocks
export async function listBlocks(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const { rows } = await query(
      `SELECT id, user_id, fecha_inicio, fecha_fin, motivo, created_at,
              (CURRENT_DATE BETWEEN fecha_inicio AND fecha_fin) AS activo
         FROM user_availability_blocks
        WHERE user_id = $1 AND fecha_fin >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY fecha_inicio DESC`,
      [id]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

// POST /users/:id/availability-blocks
export async function createBlock(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = blockSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const { fecha_inicio, fecha_fin, motivo } = parsed.data;

    const { rows } = await query(
      `INSERT INTO user_availability_blocks (user_id, fecha_inicio, fecha_fin, motivo, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, fecha_inicio, fecha_fin, motivo, created_at`,
      [id, fecha_inicio, fecha_fin, motivo || null, req.user.userId]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
}

// DELETE /users/availability-blocks/:blockId
export async function deleteBlock(req, res, next) {
  try {
    const blockId = parseInt(req.params.blockId);
    if (isNaN(blockId)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const { rowCount } = await query(`DELETE FROM user_availability_blocks WHERE id = $1`, [blockId]);
    if (rowCount === 0) throw new AppError('Bloque no encontrado', 404, 'BLOCK_NOT_FOUND');
    res.json({ success: true });
  } catch (err) { next(err); }
}
