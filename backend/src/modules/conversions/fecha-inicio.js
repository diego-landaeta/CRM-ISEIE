import { query } from '../../shared/config/db.js';
import { COBRADO_DE } from './cobrado.js';
import { AppError } from '../../shared/utils/AppError.js';
import { FALTA_FECHA_INICIO } from './conversion.validation.js';

/*
  LA FECHA DE INICIO DEL CURSO, SOLO DONDE SIRVE (#767, CRM#1036).

  Con ella se programa la matrícula en Moodle (el día anterior). Pero solo hay
  matrícula si el producto de la venta está unido a un curso de Moodle de su
  campus (`moodle_cursos_producto`, Productos › Cursos de Moodle). En un
  producto sin curso la fecha no sirve para nada y pedirla solo frena a la
  comercial: ahí es opcional.

  Se mira el producto principal y el de cada línea: con que uno tenga curso,
  la venta matricula y la fecha hace falta.

  Si la tabla no existe (un entorno sin la migración de la matrícula), nada
  tiene curso: no se exige a nadie.
*/

const SIN_TABLA = '42P01';

async function tolerante(fn) {
  try { return await fn(); } catch (err) {
    if (err?.code === SIN_TABLA) return null;
    throw err;
  }
}

/** Los productos del campus que tienen curso de Moodle (ids). */
export async function productosConCurso(projectId) {
  if (!projectId) return [];
  const rows = await tolerante(async () => (await query(
    `SELECT DISTINCT mc.product_id FROM moodle_cursos_producto mc
      WHERE mc.project_id = $1 ORDER BY 1`, [projectId])).rows);
  return (rows || []).map((r) => Number(r.product_id));
}

/**
 * Los productos de una venta que aún no existe: el elegido, los de sus líneas
 * y, si solo viene el nombre escrito, el del catálogo con ese nombre (si es
 * único, la misma regla con la que el servicio le pone el id).
 */
async function productosDelAlta(data) {
  const ids = new Set();
  if (data.producto_contratado_id) ids.add(Number(data.producto_contratado_id));
  for (const it of data.items || []) if (it?.product_id) ids.add(Number(it.product_id));
  if (!ids.size && data.producto_contratado && data.project_id) {
    const { rows } = await query(
      `SELECT id FROM products
        WHERE project_id = $1 AND active = TRUE
          AND LOWER(TRANSLATE(nombre, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'))
              = LOWER(TRANSLATE($2::text, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'))`,
      [data.project_id, data.producto_contratado]);
    if (rows.length === 1) ids.add(Number(rows[0].id));
  }
  return [...ids];
}

/** ¿Alguno de esos productos tiene curso de Moodle en el campus? */
async function algunoConCurso(projectId, productIds) {
  if (!projectId || !productIds.length) return false;
  const rows = await tolerante(async () => (await query(
    `SELECT 1 FROM moodle_cursos_producto
      WHERE project_id = $1 AND product_id = ANY($2::int[]) LIMIT 1`,
    [projectId, productIds])).rows);
  return Boolean(rows?.length);
}

/** El alta de una venta desde un formulario: sin fecha y con curso, 400. */
export async function exigirFechaSiTieneCurso(data) {
  if (data.fecha_inicio) return;
  const ids = await productosDelAlta(data);
  if (await algunoConCurso(data.project_id, ids)) {
    throw new AppError(FALTA_FECHA_INICIO, 400, 'VALIDATION_ERROR');
  }
}

/** Editar una venta: si su producto tiene curso, la fecha no se puede quitar. */
export async function exigirAlQuitarla(conversionId) {
  const { rows } = await query(
    `SELECT c.project_id,
            array_remove(array_agg(DISTINCT x.product_id), NULL) AS productos
       FROM conversions c
       LEFT JOIN LATERAL (
         SELECT c.producto_contratado_id AS product_id
         UNION SELECT ci.product_id FROM conversion_items ci WHERE ci.conversion_id = c.id
       ) x ON TRUE
      WHERE c.id = $1
      GROUP BY c.project_id`, [conversionId]);
  if (!rows[0]) return;
  if (await algunoConCurso(rows[0].project_id, (rows[0].productos || []).map(Number))) {
    throw new AppError('Esta venta es de un producto con curso de Moodle: la fecha de inicio se puede cambiar, pero no quitar.', 400, 'VALIDATION_ERROR');
  }
}

/**
 * Las ventas ya hechas SIN fecha de inicio cuyo producto tiene curso de Moodle
 * de su campus: las que hay que completar (CRM#1036). `projectIds`: null = todos
 * los campus; `personas`: null = sin recortar, si no solo las suyas (gestora).
 */
export async function ventasSinFecha({ projectIds = null, personas = null, limite = 500 } = {}) {
  const rows = await tolerante(async () => (await query(
    `SELECT c.id, c.project_id, pr.nombre AS campus, c.lead_id, l.nombre AS alumno,
            c.producto_contratado AS programa, c.fecha_conversion::text AS fecha,
            c.importe_total::float8 AS total, ${COBRADO_DE('c')}::float8 AS cobrado,
            u.nombre AS gestora
       FROM conversions c
       JOIN leads l ON l.id = c.lead_id
       JOIN projects pr ON pr.id = c.project_id
       LEFT JOIN users u ON u.id = COALESCE(c.vendedora_id, l.responsable_id)
      WHERE c.fecha_inicio IS NULL
        AND ($1::int[] IS NULL OR c.project_id = ANY($1::int[]))
        AND ($2::int[] IS NULL OR COALESCE(c.vendedora_id, l.responsable_id) = ANY($2::int[]))
        AND EXISTS (
          SELECT 1 FROM moodle_cursos_producto mc
           WHERE mc.project_id = c.project_id
             AND (mc.product_id = c.producto_contratado_id
                  OR mc.product_id IN (SELECT ci.product_id FROM conversion_items ci WHERE ci.conversion_id = c.id)))
      ORDER BY c.fecha_conversion DESC, c.id DESC
      LIMIT $3`,
    [projectIds, personas, limite])).rows);
  return rows || [];
}
