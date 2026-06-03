// Multi-cursos por lead (#18). Servicio CRUD sobre lead_products + hook
// auto desde reincidente.
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * Lista programas (principal + secundarios) de un lead.
 * Devuelve [{ id, product_id, product_nombre, responsable_id, responsable_nombre,
 *            status, notas, added_at, added_via, is_principal }]
 */
export async function listForLead(leadId) {
  // Producto principal (de leads.producto_interes_id)
  const { rows: principalRows } = await query(
    `SELECT l.producto_interes_id AS product_id, p.nombre AS product_nombre,
            l.responsable_id, u.nombre AS responsable_nombre,
            l.status, NULL::text AS notas, l.created_at AS added_at,
            'principal' AS added_via, TRUE AS is_principal,
            NULL::int AS id
     FROM leads l
     LEFT JOIN products p ON p.id = l.producto_interes_id
     LEFT JOIN users u ON u.id = l.responsable_id
     WHERE l.id = $1 AND l.producto_interes_id IS NOT NULL`,
    [leadId]
  );
  // Secundarios
  const { rows: secondaryRows } = await query(
    `SELECT lp.id, lp.product_id, p.nombre AS product_nombre,
            lp.responsable_id, u.nombre AS responsable_nombre,
            lp.status, lp.notas, lp.added_at, lp.added_via,
            FALSE AS is_principal,
            lp.added_by_user_id, au.nombre AS added_by_nombre
     FROM lead_products lp
     LEFT JOIN products p ON p.id = lp.product_id
     LEFT JOIN users u ON u.id = lp.responsable_id
     LEFT JOIN users au ON au.id = lp.added_by_user_id
     WHERE lp.lead_id = $1
     ORDER BY lp.added_at DESC`,
    [leadId]
  );
  return [...principalRows, ...secondaryRows];
}

/**
 * Añade un producto secundario al lead. Si ya existe (lead_id, product_id), no-op.
 * Si el product_id coincide con el principal del lead, error.
 */
export async function addProduct({ leadId, productId, responsableId = null, notas = null, addedByUserId, addedVia = 'manual' }) {
  if (!leadId || !productId) throw new AppError('leadId y productId requeridos', 400, 'MISSING_FIELDS');
  // Verifica que no coincida con el principal
  const { rows: leadRows } = await query(`SELECT producto_interes_id, project_id FROM leads WHERE id = $1`, [leadId]);
  if (!leadRows[0]) throw new AppError('Lead no encontrado', 404, 'LEAD_NOT_FOUND');
  if (leadRows[0].producto_interes_id === productId) {
    throw new AppError('Ese producto ya es el principal del lead', 400, 'IS_PRINCIPAL');
  }
  // Verifica que el producto pertenezca al proyecto del lead
  const { rows: prodRows } = await query(`SELECT project_id FROM products WHERE id = $1`, [productId]);
  if (!prodRows[0]) throw new AppError('Producto no encontrado', 404, 'PRODUCT_NOT_FOUND');
  if (prodRows[0].project_id !== leadRows[0].project_id) {
    throw new AppError('El producto pertenece a otro proyecto', 400, 'WRONG_PROJECT');
  }

  const { rows } = await query(
    `INSERT INTO lead_products (lead_id, product_id, responsable_id, notas, added_by_user_id, added_via)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (lead_id, product_id) DO NOTHING
     RETURNING id, lead_id, product_id, responsable_id, status, notas, added_via, added_at`,
    [leadId, productId, responsableId, notas, addedByUserId, addedVia]
  );
  // Si hubo conflicto (ya existía), devolvemos la existente
  if (!rows[0]) {
    const { rows: existing } = await query(
      `SELECT id, lead_id, product_id, responsable_id, status, notas, added_via, added_at
       FROM lead_products WHERE lead_id = $1 AND product_id = $2`,
      [leadId, productId]
    );
    return { ...existing[0], _conflict: true };
  }
  return rows[0];
}

export async function updateProduct({ leadProductId, leadId, fields, userId }) {
  const allowed = ['responsable_id', 'status', 'notas'];
  const sets = [];
  const params = [];
  let idx = 1;
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, k)) {
      sets.push(`${k} = $${idx++}`);
      params.push(fields[k]);
    }
  }
  if (sets.length === 0) throw new AppError('Sin campos para actualizar', 400, 'NO_FIELDS');
  params.push(leadProductId, leadId);
  const { rows } = await query(
    `UPDATE lead_products SET ${sets.join(', ')}
     WHERE id = $${idx++} AND lead_id = $${idx++}
     RETURNING id, product_id, responsable_id, status, notas`,
    params
  );
  if (!rows[0]) throw new AppError('Programa no encontrado en este lead', 404, 'NOT_FOUND');
  return rows[0];
}

export async function removeProduct({ leadProductId, leadId }) {
  const { rowCount } = await query(
    `DELETE FROM lead_products WHERE id = $1 AND lead_id = $2`,
    [leadProductId, leadId]
  );
  if (rowCount === 0) throw new AppError('Programa no encontrado en este lead', 404, 'NOT_FOUND');
  return { removed: true };
}

/**
 * Hook automático: cuando un lead se marca como reincidente al llegar por
 * webhook, también añade el nuevo producto al lead original como secundario.
 * Best-effort, no rompe el flujo.
 */
export async function autoAddFromReincidente({ originalLeadId, newProductId, newLeadId, addedByUserId = null }) {
  if (!originalLeadId || !newProductId) return null;
  try {
    return await addProduct({
      leadId: originalLeadId,
      productId: newProductId,
      responsableId: null, // sin gestor por defecto; admin lo asigna desde la ficha
      notas: `Añadido automáticamente porque llegó un lead reincidente #${newLeadId || '?'} interesado en este otro programa.`,
      addedByUserId,
      addedVia: 'auto_reincidente',
    });
  } catch (err) {
    logger.warn({ err: err.message, originalLeadId, newProductId }, 'auto-add reincidente falló (no crítico)');
    return null;
  }
}
