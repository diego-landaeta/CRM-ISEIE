import { query } from '../../shared/config/db.js';

/*
  CÓDIGOS PROMOCIONALES DE LOS LINKS (CRM-ISEIE#661, gemela de CRM#986; migración 327).

  Las filas de `links_pago_codigos` (los códigos de campaña que crea el admin) y
  lo que se apunta cuando un alumno paga un link con un código: en el link (qué
  código y cuánto descontó) y en la venta (el descuento y una nota). Aquí no se
  llama a Stripe: eso es `links-pago.codigos.js`.
*/

const COLUMNAS = `
  c.id, c.project_id, c.codigo, c.campana, c.tipo, c.valor::float8 AS valor, c.moneda,
  c.caduca_el::text AS caduca_el, c.max_usos, c.activo, c.stripe_promotion_code_id,
  c.created_by, u.nombre AS creado_por_nombre, c.created_at, c.desactivado_el,
  CASE WHEN NOT c.activo THEN 'desactivado'
       WHEN c.caduca_el < (NOW() AT TIME ZONE 'Europe/Madrid')::date THEN 'caducado'
       ELSE 'vigente' END AS estado`;

/** Los códigos del campus, los vigentes primero y luego del más nuevo al más viejo. */
export async function listar(projectId, { soloVigentes = false } = {}) {
  const { rows } = await query(
    `SELECT ${COLUMNAS}
       FROM links_pago_codigos c
       LEFT JOIN users u ON u.id = c.created_by
      WHERE c.project_id = $1
        AND (NOT $2::boolean OR (c.activo AND c.caduca_el >= (NOW() AT TIME ZONE 'Europe/Madrid')::date))
      ORDER BY (c.activo AND c.caduca_el >= (NOW() AT TIME ZONE 'Europe/Madrid')::date) DESC, c.created_at DESC, c.id DESC
      LIMIT 200`,
    [projectId, soloVigentes]);
  return rows;
}

export async function porId(id) {
  const { rows } = await query(
    `SELECT ${COLUMNAS}, c.stripe_coupon_id
       FROM links_pago_codigos c LEFT JOIN users u ON u.id = c.created_by
      WHERE c.id = $1`, [id]);
  return rows[0] || null;
}

/** El código apuntado antes de crearlo en Stripe (para tener su id en la marca). */
export async function insertar({ projectId, codigo, campana, tipo, valor, moneda, caducaEl, maxUsos, userId }) {
  const { rows } = await query(
    `INSERT INTO links_pago_codigos (project_id, codigo, campana, tipo, valor, moneda, caduca_el, max_usos, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9)
     RETURNING id, created_at`,
    [projectId, codigo, campana ?? null, tipo, valor, tipo === 'monto' ? moneda : null, caducaEl, maxUsos ?? null, userId]);
  return rows[0];
}

export async function completarConStripe(id, { couponId, promotionCodeId }) {
  await query(
    'UPDATE links_pago_codigos SET stripe_coupon_id = $2, stripe_promotion_code_id = $3 WHERE id = $1',
    [id, couponId, promotionCodeId]);
}

/** Si Stripe no lo crea, el código no existe: no se deja una fila suelta. */
export async function borrar(id) {
  await query('DELETE FROM links_pago_codigos WHERE id = $1', [id]);
}

export async function marcarDesactivado(id, userId) {
  const { rowCount } = await query(
    `UPDATE links_pago_codigos SET activo = FALSE, desactivado_por = $2, desactivado_el = NOW()
      WHERE id = $1 AND activo`, [id, userId]);
  return rowCount > 0;
}

/** El texto de un código de Stripe creado desde el CRM, por su id (`promo_…`). */
export async function codigoPorIdDeStripe(projectId, promotionCodeId) {
  const { rows } = await query(
    'SELECT codigo FROM links_pago_codigos WHERE project_id = $1 AND stripe_promotion_code_id = $2 LIMIT 1',
    [projectId, promotionCodeId]);
  return rows[0]?.codigo || null;
}

// ─── Al pagarse un link con un código ───────────────────────────────────────

/** El código y lo que descontó, en el link (en su moneda). Una vez: true si lo apuntó ahora. */
export async function apuntarEnElLink(linkId, { codigo, descuento }) {
  const { rowCount } = await query(
    `UPDATE payment_links SET promo_codigo = $2, promo_descuento = $3, updated_at = NOW()
      WHERE id = $1 AND promo_descuento IS NULL`,
    [linkId, codigo ? String(codigo).slice(0, 100) : null, descuento]);
  return rowCount > 0;
}

/** El total de la venta, en euros, o null si no existe. */
export async function totalDeLaVenta(conversionId) {
  const { rows } = await query('SELECT importe_total::float8 AS total FROM conversions WHERE id = $1', [conversionId]);
  return rows[0] ? Number(rows[0].total) : null;
}

/*
  El descuento en la venta que creó el link, con las columnas de siempre (095):
  el precio antes del descuento (`subtotal_bruto`) y el descuento en euros. Solo
  si la venta aún no tiene descuento y el total cuadra al céntimo: si no, no se
  toca (la venta sigue bien, su total es lo que se cobró).
*/
export async function ponerDescuentoEnLaVenta(conversionId, { subtotal, tipo, valor, importe }) {
  const { rowCount } = await query(
    `UPDATE conversions
        SET subtotal_bruto = $2, descuento_tipo = $3, descuento_valor = $4, descuento_importe = $5, updated_at = NOW()
      WHERE id = $1 AND descuento_tipo = 'none'
        AND ROUND(importe_total * 100) = ROUND(($2::numeric - $5::numeric) * 100)`,
    [conversionId, subtotal, tipo, valor, importe]);
  return rowCount > 0;
}

/** Una línea más en las notas de la venta (el código que se usó). */
export async function anadirNotaALaVenta(conversionId, texto) {
  await query(
    `UPDATE conversions
        SET notas = CASE WHEN COALESCE(notas, '') = '' THEN $2 ELSE notas || E'\\n' || $2 END, updated_at = NOW()
      WHERE id = $1`,
    [conversionId, texto]);
}
