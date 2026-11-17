import { query } from '../../shared/config/db.js';

/** Una empresa emisora (`invoice_issuers`), con lo que hace falta para nombrarla. */
export async function empresa(issuerId) {
  const { rows } = await query(
    `SELECT id, razon_social, alias, serie, nif FROM invoice_issuers WHERE id = $1`, [issuerId]);
  return rows[0] || null;
}

/** Los campus de una empresa (`projects.sociedad_emisora_id`). */
export async function campusDeLaEmpresa(issuerId) {
  const { rows } = await query(
    'SELECT id FROM projects WHERE sociedad_emisora_id = $1 ORDER BY id', [issuerId]);
  return rows.map((r) => Number(r.id));
}

/**
 * Las empresas que tienen algo que contar en el mes: alguna factura emitida, o
 * algún campus de verdad (sin los de pruebas) con ventas o cobros.
 */
export async function empresasConMovimiento(desde, hasta) {
  const { rows } = await query(
    `SELECT e.id, e.razon_social, e.alias, e.serie, e.nif
       FROM invoice_issuers e
      WHERE EXISTS (
              SELECT 1 FROM invoices i
                LEFT JOIN projects p ON p.id = i.project_id
               WHERE COALESCE(i.issuer_id, p.sociedad_emisora_id) = e.id
                 AND i.tipo IN ('normal', 'rectificativa') AND i.numero IS NOT NULL
                 AND i.estado <> 'borrador'
                 AND i.fecha_emision BETWEEN $1::date AND $2::date)
         OR EXISTS (
              SELECT 1 FROM conversion_payments cp
                JOIN conversions c ON c.id = cp.conversion_id
                JOIN projects p ON p.id = c.project_id
               WHERE p.sociedad_emisora_id = e.id AND NOT COALESCE(p.es_prueba, false)
                 AND cp.fecha BETWEEN $1::date AND $2::date)
         OR EXISTS (
              SELECT 1 FROM conversions c
                JOIN projects p ON p.id = c.project_id
               WHERE p.sociedad_emisora_id = e.id AND NOT COALESCE(p.es_prueba, false)
                 AND c.fecha_conversion BETWEEN $1::date AND $2::date)
      ORDER BY e.id`,
    [desde, hasta]
  );
  return rows;
}

/**
 * Los equipos comerciales: cada líder con las gestoras a su cargo
 * (`equipo_comercial`, migración 246). Sin la migración, ningún equipo.
 */
export async function equipos() {
  try {
    const { rows } = await query(
      `SELECT ec.lider_id, u.nombre AS lider, ec.gestora_id
         FROM equipo_comercial ec
         JOIN users u ON u.id = ec.lider_id
        ORDER BY u.nombre, ec.lider_id, ec.gestora_id`);
    return rows;
  } catch (err) {
    if (err?.code === '42P01') return [];
    throw err;
  }
}

/**
 * Las facturas EMITIDAS de una empresa en el mes, por su fecha de emisión:
 * normales y rectificativas (los abonos van en negativo), con número. Sin
 * borradores ni proformas. Las anuladas vienen también, para que el listado
 * explique el hueco en la numeración; no llevan PDF ni suman.
 *
 * La empresa es la de la factura (`issuer_id`); las antiguas sin emisor, la de
 * su campus. Nunca las de un campus de pruebas. `projectIds` recorta a los
 * campus de quien pide (null = todos).
 */
export async function facturasDelMes({ issuerId, desde, hasta, projectIds = null }) {
  const { rows } = await query(
    `SELECT i.id, i.codigo, i.serie, i.numero, i.tipo, i.estado, i.fecha_emision,
            i.cliente_nombre, i.cliente_nif, i.base_imponible, i.iva_pct, i.iva_importe,
            i.total, i.moneda, i.total_divisa, i.rectifica_codigo, i.pdf_path,
            p.nombre AS campus
       FROM invoices i
       LEFT JOIN projects p ON p.id = i.project_id
      WHERE COALESCE(i.issuer_id, p.sociedad_emisora_id) = $1
        AND i.tipo IN ('normal', 'rectificativa')
        AND i.numero IS NOT NULL
        AND i.estado <> 'borrador'
        AND i.fecha_emision BETWEEN $2::date AND $3::date
        AND NOT COALESCE(p.es_prueba, false)
        AND ($4::int[] IS NULL OR i.project_id = ANY($4::int[]))
      ORDER BY i.serie, i.ano, i.numero, i.id`,
    [issuerId, desde, hasta, projectIds]
  );
  return rows;
}
