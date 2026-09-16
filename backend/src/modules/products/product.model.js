import { query } from '../../shared/config/db.js';

// La tabla `product_categories` no existe en 001/002. Los JOINs al árbol de
// categorías y el filtro por categoryId quedan inhabilitados hasta portar el
// módulo product-categories.
// Listado: NO trae campos _texto pesados (HTML grande). Solo lo necesario para
// el catálogo / cards. Para ver el detalle completo, usar findById(id).
// #86 · Las plazas ocupadas NO se guardan en ninguna columna: se cuentan aquí,
// cada vez. Es lo que exige el proceso comercial —«se comprueba antes de cada
// envío, nunca se arrastra el dato del mensaje anterior»— y lo único que evita
// que la plantilla salga al cliente con la cifra de la semana pasada.
//
// Se cuentan LEADS distintos, no filas de venta: la misma persona puede tener
// dos ventas del mismo producto (un plan que se partió, una cuota suelta) y
// sigue ocupando una plaza. Por eso mismo `es_mensualidad` queda fuera: una
// mensualidad no es una matrícula nueva.
//
// `plazas_ocupadas_previas` se suma porque hay matrículas anteriores al CRM que
// ocupan plaza y de las que aquí no hay venta.
const PLAZAS_JOIN = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(p.plazas_ocupadas_previas, 0) + COUNT(DISTINCT cv.lead_id) AS ocupadas
      FROM conversions cv
     WHERE cv.producto_contratado_id = p.id
       AND cv.es_mensualidad IS NOT TRUE
  ) pl ON TRUE`;

// `plazas_libres` puede salir NEGATIVA, y se deja así a propósito: significa que
// la convocatoria está sobrevendida y el administrador tiene que verlo. Quien
// pinte una plantilla de cara al cliente es el que corta en cero, no esto.
const PLAZAS_COLS = `
  pl.ocupadas AS plazas_ocupadas,
  CASE WHEN p.plazas_totales IS NULL THEN NULL
       ELSE p.plazas_totales - pl.ocupadas END AS plazas_libres,
  CASE WHEN p.fecha_cierre_convocatoria IS NULL THEN NULL
       ELSE (p.fecha_cierre_convocatoria - CURRENT_DATE) END AS dias_para_cierre`;

const LIST_COLS = [
  'id', 'project_id', 'nombre', 'sku', 'precio', 'moneda',
  'duracion', 'horas', 'modalidad', 'fecha_inicio_texto', 'num_modulos',
  'image_url', 'url_info', 'stripe_link', 'brochure_url',
  'source_type', 'wc_product_id',
  'categoria_id', 'subcategoria_id', 'regimen_fiscal_id',
  'plazas_totales', 'plazas_ocupadas_previas', 'fecha_cierre_convocatoria',
  'active', 'created_at', 'updated_at',
  // descripcion va recortada (los textos largos rompen perf)
  "LEFT(descripcion, 280) AS descripcion",
].join(', ');

export async function findByProject(projectId, { includeInactive = false, categoryId: _ignored = null } = {}) {
  const params = [projectId];
  const base = `SELECT ${LIST_COLS}, ${PLAZAS_COLS},
                       NULL::text as categoria_nombre, NULL::text as subcategoria_nombre
                FROM products p
                ${PLAZAS_JOIN}
                WHERE p.project_id = $1`;
  const sql = includeInactive
    ? base + ' ORDER BY p.created_at DESC'
    : base + ' AND p.active = true ORDER BY p.created_at DESC';
  const { rows } = await query(sql, params);
  return rows;
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT p.*, ${PLAZAS_COLS} FROM products p ${PLAZAS_JOIN} WHERE p.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function create({ projectId, nombre, descripcion, categoria_id, subcategoria_id, precio, moneda, stripe_link, sku, duracion, url_info, regimen_fiscal_id }) {
  const { rows } = await query(
    `INSERT INTO products (project_id, nombre, descripcion, categoria_id, subcategoria_id, precio, moneda, stripe_link, sku, duracion, url_info, regimen_fiscal_id)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'EUR'), $8, $9, $10, $11, $12)
     RETURNING *`,
    [projectId, nombre, descripcion, categoria_id || null, subcategoria_id || null,
     precio ?? null, moneda || null, stripe_link || null, sku || null, duracion || null, url_info || null, regimen_fiscal_id || null]
  );
  return rows[0];
}

export async function update(id, data) {
  const allowed = ['nombre', 'descripcion', 'categoria_id', 'subcategoria_id',
                   'precio', 'moneda', 'stripe_link', 'brochure_url', 'sku', 'duracion', 'url_info',
                   'image_url', 'image_key', 'regimen_fiscal_id',
                   'horas', 'num_modulos', 'modalidad', 'fecha_inicio_texto',
                   'plazas_totales', 'plazas_ocupadas_previas', 'fecha_cierre_convocatoria',
                   'presentacion_texto', 'objetivos_texto', 'beneficios_texto',
                   'dirigido_a_texto', 'para_que_te_prepara_texto', 'por_que_estudiar_texto',
                   'modulos_texto', 'metodologia_texto', 'faqs_texto', 'profesores_texto'];
  const fields = [];
  const values = [];
  let idx = 1;

  for (const k of allowed) {
    if (data[k] !== undefined) { fields.push(`${k} = $${idx++}`); values.push(data[k]); }
  }

  if (fields.length === 0) return findById(id);

  fields.push(`updated_at = NOW()`);
  values.push(id);

  const { rows } = await query(
    `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0];
}

export async function deactivate(id) {
  const { rows } = await query(
    `UPDATE products SET active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0];
}

export async function findByProjectAndName(projectId, nombre) {
  const { rows } = await query(
    `SELECT * FROM products WHERE project_id = $1 AND nombre = $2 AND active = true`,
    [projectId, nombre]
  );
  return rows[0] || null;
}
