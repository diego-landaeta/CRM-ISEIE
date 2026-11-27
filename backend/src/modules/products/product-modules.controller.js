import { z } from 'zod';
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { PRIMER_ORDEN, ordenDeLaPosicion } from './formacion.validation.js';

const moduleSchema = z.object({
  titulo:      z.string().min(1).max(300),
  descripcion: z.string().max(5000).optional().nullable(),
  horas:       z.number().int().nonnegative().optional().nullable(),
  orden:       z.number().int().optional(),
});

const reorderSchema = z.object({
  ids: z.array(z.number().int().positive()),
});

function pid(req) {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id <= 0) throw new AppError('ID de producto inválido', 400, 'INVALID_ID');
  return id;
}

// GET /api/products/:id/modules
export async function listModules(req, res, next) {
  try {
    const productId = pid(req);
    const { rows } = await query(
      `SELECT id, product_id, orden, titulo, descripcion, horas, created_at, updated_at
       FROM product_modules
       WHERE product_id = $1
       ORDER BY orden, id`,
      [productId]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

// POST /api/products/:id/modules
export async function createModule(req, res, next) {
  try {
    const productId = pid(req);
    const parsed = moduleSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');

    // Si no se especifica orden, usar el siguiente disponible
    let orden = parsed.data.orden;
    if (orden === undefined) {
      const { rows } = await query(
        `SELECT COALESCE(MAX(orden) + 1, $2) AS next FROM product_modules WHERE product_id = $1`,
        [productId, PRIMER_ORDEN]
      );
      orden = rows[0].next;
    }

    const { rows } = await query(
      `INSERT INTO product_modules (product_id, titulo, descripcion, horas, orden)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [productId, parsed.data.titulo, parsed.data.descripcion || null, parsed.data.horas || null, orden]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
}

// PATCH /api/products/:id/modules/:moduleId
export async function updateModule(req, res, next) {
  try {
    const productId = pid(req);
    const moduleId = parseInt(req.params.moduleId);
    if (isNaN(moduleId) || moduleId <= 0) throw new AppError('moduleId inválido', 400, 'INVALID_ID');

    const parsed = moduleSchema.partial().safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');

    const fields = [];
    const values = [];
    let i = 1;
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) {
        fields.push(`${k} = $${i++}`);
        values.push(v);
      }
    }
    if (!fields.length) throw new AppError('Sin campos para actualizar', 400, 'NO_FIELDS');
    fields.push(`updated_at = NOW()`);
    values.push(moduleId, productId);

    const { rows } = await query(
      `UPDATE product_modules SET ${fields.join(', ')} WHERE id = $${i++} AND product_id = $${i} RETURNING *`,
      values
    );
    if (!rows[0]) throw new AppError('Módulo no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
}

// DELETE /api/products/:id/modules/:moduleId
export async function deleteModule(req, res, next) {
  try {
    const productId = pid(req);
    const moduleId = parseInt(req.params.moduleId);
    if (isNaN(moduleId) || moduleId <= 0) throw new AppError('moduleId inválido', 400, 'INVALID_ID');

    const { rowCount } = await query(
      `DELETE FROM product_modules WHERE id = $1 AND product_id = $2`,
      [moduleId, productId]
    );
    if (rowCount === 0) throw new AppError('Módulo no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true });
  } catch (err) { next(err); }
}

// POST /api/products/:id/modules/reorder { ids: [3, 1, 2] }
export async function reorderModules(req, res, next) {
  try {
    const productId = pid(req);
    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');

    for (let i = 0; i < parsed.data.ids.length; i++) {
      await query(
        `UPDATE product_modules SET orden = $1, updated_at = NOW() WHERE id = $2 AND product_id = $3`,
        [ordenDeLaPosicion(i), parsed.data.ids[i], productId]
      );
    }
    res.json({ success: true });
  } catch (err) { next(err); }
}
