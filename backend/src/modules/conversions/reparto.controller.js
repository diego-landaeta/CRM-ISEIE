// Repartir una venta entre varias gestoras.
//
// Diego: «hay casos que dos gestoras atienden a una persona y vende, y hay que
// compartirlo, mitad y mitad — únicamente el admin y superadmin pueden hacerlo».
//
// La venta NO se toca: `conversions.vendedora_id` sigue siendo quien la
// registró. El reparto vive en `conversion_vendedoras` y la vista
// `conversion_reparto` lo aplica. Una venta sin reparto se comporta como
// siempre, y por eso esto se puede añadir sin tocar de golpe las 39 consultas
// que preguntan de quién es una venta.
import { z } from 'zod';
import { query, getClient } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';

// Entre dos y cinco personas. Una sola no es un reparto: para eso ya está
// cambiar la vendedora de la venta, y admitirlo aquí crearía dos maneras
// distintas de hacer lo mismo.
const repartoSchema = z.object({
  partes: z.array(z.object({
    user_id: z.coerce.number().int().positive(),
    porcentaje: z.coerce.number().positive().max(100),
  })).min(2, 'Un reparto necesita al menos dos personas')
    .max(5, 'Como mucho cinco personas en una venta'),
  nota: z.string().max(500).optional().nullable(),
});

/** La venta con su titular actual, o 404. */
async function traerVenta(conversionId) {
  const { rows } = await query(
    `SELECT c.id, c.project_id, c.lead_id, c.importe_total, c.producto_contratado,
            COALESCE(c.vendedora_id, l.responsable_id) AS titular_id,
            u.nombre AS titular_nombre
       FROM conversions c
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN users u ON u.id = COALESCE(c.vendedora_id, l.responsable_id)
      WHERE c.id = $1`,
    [conversionId]
  );
  if (!rows[0]) throw new AppError('Venta no encontrada', 404, 'CONVERSION_NOT_FOUND');
  return rows[0];
}

function idValido(req) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('ID inválido', 400, 'INVALID_ID');
  return id;
}

// GET /api/conversions/:id/reparto
//
// Lo ve cualquiera que entre al CRM: la gestora tiene derecho a saber cómo se
// repartió su venta. Cambiarlo es otra cosa (abajo).
export async function get(req, res, next) {
  try {
    const id = idValido(req);
    const venta = await traerVenta(id);

    const { rows: partes } = await query(
      `SELECT cv.user_id, cv.porcentaje, cv.nota,
              u.nombre, u.role,
              r.nombre AS repartida_por, cv.updated_at AS repartida_el
         FROM conversion_vendedoras cv
         JOIN users u ON u.id = cv.user_id
         LEFT JOIN users r ON r.id = cv.repartida_por_user_id
        WHERE cv.conversion_id = $1
        ORDER BY cv.porcentaje DESC, u.nombre`,
      [id]
    );

    // Con quién se puede repartir: quien trabaja en ese proyecto. Sin esto el
    // desplegable enseñaría a las gestoras de las otras siete escuelas.
    const { rows: candidatas } = await query(
      `SELECT u.id, u.nombre, u.role
         FROM users u
        WHERE u.active = TRUE
          AND u.role IN ('gestor', 'admin', 'superadmin')
          AND EXISTS (SELECT 1 FROM user_projects up
                       WHERE up.user_id = u.id AND up.active = TRUE
                         AND up.project_id = $1)
        ORDER BY u.nombre`,
      [venta.project_id]
    );

    const total = Number(venta.importe_total) || 0;
    res.json({
      success: true,
      data: {
        conversion_id: venta.id,
        project_id: venta.project_id,
        importe_total: total,
        producto: venta.producto_contratado,
        titular: venta.titular_id
          ? { user_id: venta.titular_id, nombre: venta.titular_nombre }
          : null,
        compartida: partes.length > 1,
        partes: partes.map((p) => ({
          user_id: p.user_id,
          nombre: p.nombre,
          role: p.role,
          porcentaje: Number(p.porcentaje),
          // Lo que le toca de esta venta, para que no haya que calcularlo a ojo.
          importe: Math.round(total * (Number(p.porcentaje) / 100) * 100) / 100,
        })),
        repartida_por: partes[0]?.repartida_por || null,
        repartida_el: partes[0]?.repartida_el || null,
        nota: partes[0]?.nota || null,
        candidatas,
      },
    });
  } catch (err) { next(err); }
}

// PUT /api/conversions/:id/reparto — solo admin y superadmin (ver rutas)
export async function set(req, res, next) {
  const client = await getClient();
  try {
    const id = idValido(req);
    const parsed = repartoSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const { partes, nota } = parsed.data;

    const venta = await traerVenta(id);

    // Nadie dos veces en la misma venta.
    const ids = partes.map((p) => p.user_id);
    if (new Set(ids).size !== ids.length) {
      throw new AppError('Hay una persona repetida en el reparto', 400, 'DUPLICATE_USER');
    }

    // Los porcentajes suman 100. La vista normaliza igualmente --los totales
    // cuadran pase lo que pase-- pero si alguien escribe 60 y 60 lo que quiere
    // decir es otra cosa, y es mejor avisarle que repartir 50/50 en silencio.
    const suma = partes.reduce((a, p) => a + p.porcentaje, 0);
    if (Math.abs(suma - 100) > 0.01) {
      throw new AppError(`Los porcentajes suman ${suma}% y tienen que sumar 100%`, 400, 'BAD_SPLIT');
    }

    // Todas trabajan en el proyecto de la venta.
    const { rows: validas } = await query(
      `SELECT u.id, u.nombre FROM users u
        WHERE u.id = ANY($1::int[]) AND u.active = TRUE
          AND EXISTS (SELECT 1 FROM user_projects up
                       WHERE up.user_id = u.id AND up.active = TRUE AND up.project_id = $2)`,
      [ids, venta.project_id]
    );
    if (validas.length !== ids.length) {
      const dentro = new Set(validas.map((v) => v.id));
      const fuera = ids.filter((x) => !dentro.has(x));
      throw new AppError(
        `Hay ${fuera.length === 1 ? 'una persona' : `${fuera.length} personas`} que no trabaja en ese proyecto`,
        400, 'USER_NOT_IN_PROJECT'
      );
    }

    await client.query('BEGIN');
    // Se reemplaza entero: así cambiar un reparto de 50/50 a 70/30 no deja
    // filas viejas sueltas que descuadren los porcentajes.
    await client.query('DELETE FROM conversion_vendedoras WHERE conversion_id = $1', [id]);
    for (const p of partes) {
      await client.query(
        `INSERT INTO conversion_vendedoras
           (conversion_id, user_id, porcentaje, repartida_por_user_id, nota)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, p.user_id, p.porcentaje, req.user.userId, nota || null]
      );
    }
    await client.query('COMMIT');

    // Rastro en la ficha del prospecto. Mover el mérito de una persona a otra
    // tiene que poder mirarse después.
    if (venta.lead_id) {
      const quienes = partes
        .map((p) => `${validas.find((v) => v.id === p.user_id)?.nombre || p.user_id} ${p.porcentaje}%`)
        .join(' · ');
      try {
        await query(
          `INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, fecha)
           VALUES ($1, 'nota', $2, $3, NOW())`,
          [venta.lead_id, `Venta repartida — ${quienes}${nota ? `. ${nota}` : ''}`, req.user.userId]
        );
      } catch (err) { /* el rastro no debe tumbar el reparto */ }
    }

    req.params.id = String(id);
    return get(req, res, next);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* la transaccion ya estaba cerrada */ }
    next(err);
  } finally {
    client.release();
  }
}

// DELETE /api/conversions/:id/reparto — solo admin y superadmin (ver rutas)
export async function remove(req, res, next) {
  try {
    const id = idValido(req);
    const venta = await traerVenta(id);
    const { rowCount } = await query('DELETE FROM conversion_vendedoras WHERE conversion_id = $1', [id]);
    if (rowCount === 0) throw new AppError('Esa venta no estaba repartida', 404, 'NOT_SHARED');

    if (venta.lead_id) {
      try {
        await query(
          `INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, fecha)
           VALUES ($1, 'nota', $2, $3, NOW())`,
          [venta.lead_id,
            `Reparto deshecho — la venta vuelve entera a ${venta.titular_nombre || 'su vendedora'}`,
            req.user.userId]
        );
      } catch (err) { /* el rastro no debe tumbar nada */ }
    }
    res.json({ success: true, data: { conversion_id: id, compartida: false } });
  } catch (err) { next(err); }
}
