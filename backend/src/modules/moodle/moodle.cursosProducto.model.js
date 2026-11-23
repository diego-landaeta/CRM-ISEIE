import { query, getClient } from '../../shared/config/db.js';

/**
 * Qué curso de Moodle es cada producto del catálogo (CRM#957), las consultas.
 *
 * La tabla es `moodle_cursos_producto` (migración 311 en ISEIE, 289 en MultiCRM; #767): la lee la
 * matrícula automática para saber en qué curso matricular a quien compra un
 * producto. Sin fila, esa matrícula falla con «no tiene curso de Moodle
 * asignado». `project_id` es el campus cuyo Moodle tiene el curso: el id de un
 * curso solo significa algo dentro de su Moodle.
 *
 * Aquí se mira y se cambia solo lo del campus elegido, y solo sus productos
 * (`products.project_id`). La tabla admite varios cursos por producto; la
 * pantalla une uno y, al cambiarlo, deja ese solo.
 */

/**
 * Los productos del campus con sus cursos de Moodle y cuántas ventas tienen.
 * Salen los activos y, de los desactivados, los que tienen curso o ventas:
 * a quien ya los compró hay que matricularle igual.
 */
export async function productosDelCampus(projectId) {
  const { rows } = await query(
    `WITH ventas AS (
       SELECT x.product_id, COUNT(DISTINCT x.conversion_id)::int AS n
         FROM (SELECT c.producto_contratado_id AS product_id, c.id AS conversion_id
                 FROM conversions c
                WHERE c.project_id = $1 AND c.producto_contratado_id IS NOT NULL
               UNION
               SELECT ci.product_id, ci.conversion_id
                 FROM conversion_items ci
                 JOIN conversions c ON c.id = ci.conversion_id
                WHERE c.project_id = $1 AND ci.product_id IS NOT NULL) x
        GROUP BY x.product_id
     )
     SELECT pr.id, pr.nombre, pr.active AS activo,
            COALESCE(v.n, 0) AS ventas,
            COALESCE(json_agg(json_build_object(
                       'curso_moodle_id', mc.curso_moodle_id,
                       'curso_nombre', mc.curso_nombre)
                     ORDER BY mc.curso_moodle_id)
                     FILTER (WHERE mc.product_id IS NOT NULL), '[]') AS cursos
       FROM products pr
       LEFT JOIN ventas v ON v.product_id = pr.id
       LEFT JOIN moodle_cursos_producto mc ON mc.product_id = pr.id AND mc.project_id = $1
      WHERE pr.project_id = $1
      GROUP BY pr.id, pr.nombre, pr.active, v.n
     HAVING pr.active OR COUNT(mc.product_id) > 0 OR COALESCE(v.n, 0) > 0
      ORDER BY lower(pr.nombre), pr.id`,
    [projectId]
  );
  return rows.map((r) => ({
    ...r,
    cursos: r.cursos.map((c) => ({ curso_moodle_id: Number(c.curso_moodle_id), curso_nombre: c.curso_nombre })),
  }));
}

/** El producto, si es de ese campus. */
export async function productoDelCampus(productId, projectId) {
  const { rows } = await query(
    'SELECT id, nombre, active AS activo FROM products WHERE id = $1 AND project_id = $2',
    [productId, projectId]
  );
  return rows[0] || null;
}

const apuntar = (exec, { userId, ip, accion, detalle }) => (userId
  ? exec(
    `INSERT INTO user_activity_log (user_id, action, details, ip_address) VALUES ($1, $2, $3::jsonb, $4)`,
    [userId, accion, JSON.stringify(detalle), ip || null]
  )
  : null);

/**
 * Une el producto con ese curso y solo con ese (los que tuviera en el campus se
 * quitan), en una transacción. Queda apuntado quién lo hizo y qué había antes.
 */
export async function unir({ productId, projectId, curso, userId, ip }) {
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const { rows: antes } = await db.query(
      `DELETE FROM moodle_cursos_producto WHERE product_id = $1 AND project_id = $2
       RETURNING curso_moodle_id, curso_nombre`,
      [productId, projectId]
    );
    await db.query(
      `INSERT INTO moodle_cursos_producto (product_id, project_id, curso_moodle_id, curso_nombre, creado_por)
       VALUES ($1, $2, $3, $4, $5)`,
      [productId, projectId, curso.id, curso.nombre, userId || null]
    );
    await apuntar((t, p) => db.query(t, p), {
      userId, ip, accion: 'moodle.unir_curso_producto',
      detalle: { product_id: productId, project_id: projectId, curso_moodle_id: curso.id, curso_nombre: curso.nombre, antes },
    });
    await db.query('COMMIT');
    return { curso_moodle_id: curso.id, curso_nombre: curso.nombre, antes };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/** Quita los cursos del producto en ese campus. Devuelve los que había. */
export async function quitar({ productId, projectId, userId, ip }) {
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const { rows: antes } = await db.query(
      `DELETE FROM moodle_cursos_producto WHERE product_id = $1 AND project_id = $2
       RETURNING curso_moodle_id, curso_nombre`,
      [productId, projectId]
    );
    if (antes.length) {
      await apuntar((t, p) => db.query(t, p), {
        userId, ip, accion: 'moodle.quitar_curso_producto',
        detalle: { product_id: productId, project_id: projectId, antes },
      });
    }
    await db.query('COMMIT');
    return antes;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}
