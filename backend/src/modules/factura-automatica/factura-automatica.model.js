import { query } from '../../shared/config/db.js';

/*
  Factura automática (#452) · la base.

  Una fila de `factura_datos_fiscales` por venta (migración 281). Las cuotas
  reutilizan la misma: los datos se piden una vez, en el primer pago.
*/

/** La venta con su ficha y su campus: lo que hace falta para pedir y para facturar. */
export async function venta(conversionId) {
  const { rows } = await query(
    `SELECT c.id, c.project_id, c.lead_id, c.producto_contratado,
            l.nombre, l.email, l.cliente_tipo, l.custom_fields,
            l.identificacion_fiscal, l.direccion_fiscal, l.ciudad_fiscal,
            l.codigo_postal_fiscal, l.pais_fiscal, l.responsable_id,
            p.nombre AS campus, p.slug, p.logo_url, p.emoji, p.theme_color,
            p.remitente_no_contestar,
            pr.nombre AS producto_catalogo,
            ie.nif AS emisor_nif
       FROM conversions c
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN products pr ON pr.id = c.producto_contratado_id
       LEFT JOIN invoice_issuers ie ON ie.id = p.sociedad_emisora_id
      WHERE c.id = $1`,
    [conversionId]);
  return rows[0] || null;
}

/** El campus de una venta, solo id y slug: para mirar el interruptor sin más. */
export async function campusDeLaVenta(conversionId) {
  const { rows } = await query(
    `SELECT p.id, p.slug FROM conversions c JOIN projects p ON p.id = c.project_id WHERE c.id = $1`,
    [conversionId]);
  return rows[0] || null;
}

/** La petición viva de una venta (la que no está anulada). */
export async function deLaVenta(conversionId) {
  const { rows } = await query(
    `SELECT * FROM factura_datos_fiscales WHERE conversion_id = $1 AND estado <> 'anulado' LIMIT 1`,
    [conversionId]);
  return rows[0] || null;
}

/**
 * Los datos fiscales con los que se factura la venta, si ya los hay: los que
 * contestó el alumno o los de su ficha validados el día 7. Null si no.
 *
 * Es la fuente de TODAS las facturas de la venta, salgan solas o las emita una
 * persona (la cola, «Emitir hasta», «Cobrada» en una proforma). Antes solo la
 * usaba la emisión automática: si esta se paraba (posible duplicada, pausa…),
 * la factura que se emitía a mano desde la cola salía con la ficha (CRM#764,
 * 18/11: NIF «—» aunque el alumno lo había dado).
 */
export async function datosParaFacturar(conversionId) {
  if (!conversionId) return null;
  const { rows } = await query(
    `SELECT * FROM factura_datos_fiscales
      WHERE conversion_id = $1 AND estado IN ('respondido', 'ficha') AND nif IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
    [conversionId]);
  return rows[0] || null;
}

export async function porId(id) {
  const { rows } = await query('SELECT * FROM factura_datos_fiscales WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * La petición de un enlace. Solo si sigue pendiente y no ha caducado: un
 * enlace usado (token_hash a NULL), caducado o bloqueado por intentos no
 * encuentra nada, y quien lo abre ve «este enlace ya no vale».
 */
export async function porTokenHash(hash) {
  const { rows } = await query(
    `SELECT f.*, p.nombre AS campus, p.slug, p.logo_url, p.theme_color,
            to_jsonb(p) ->> 'color_cabecera' AS color_cabecera,
            l.nombre AS lead_nombre
       FROM factura_datos_fiscales f
       JOIN projects p ON p.id = f.project_id
       LEFT JOIN leads l ON l.id = f.lead_id
      WHERE f.token_hash = $1 AND f.estado = 'pendiente' AND f.caduca_at > NOW()`,
    [hash]);
  return rows[0] || null;
}

/**
 * ¿Tiene ya la venta alguna factura (no anulada)? Si la tiene, se empezó a
 * facturar a mano antes de encender esto: no se le pide nada al alumno a
 * mitad de sus cuotas, se sigue como hasta ahora.
 */
export async function yaTieneFacturas(conversionId) {
  const { rows } = await query(
    `SELECT EXISTS (SELECT 1 FROM invoices WHERE conversion_id = $1
                      AND tipo = 'normal' AND estado NOT IN ('cancelada', 'borrador')) AS hay`,
    [conversionId]);
  return !!rows[0]?.hay;
}

/** ¿Hay una proforma numerada esperando? Esa se convierte a mano, con sus datos. */
export async function tieneProforma(conversionId) {
  const { rows } = await query(
    `SELECT EXISTS (SELECT 1 FROM invoices WHERE conversion_id = $1 AND tipo = 'proforma'
                      AND estado NOT IN ('cancelada', 'borrador') AND numero IS NOT NULL) AS hay`,
    [conversionId]);
  return !!rows[0]?.hay;
}

/** Crea la petición. Si otra llamada se adelantó (índice único), devuelve null. */
export async function crear({ conversionId, projectId, leadId, paymentId, tokenHash, caducaAt }) {
  const { rows } = await query(
    `INSERT INTO factura_datos_fiscales (conversion_id, project_id, lead_id, payment_id, token_hash, caduca_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [conversionId, projectId, leadId || null, paymentId || null, tokenHash, caducaAt]);
  return rows[0] || null;
}

export async function marcarEnvio(id, { para = null, error = null }) {
  await query(
    `UPDATE factura_datos_fiscales
        SET enviado_a = COALESCE($2, enviado_a),
            enviado_at = CASE WHEN $3::text IS NULL THEN NOW() ELSE enviado_at END,
            envio_error = $3, updated_at = NOW()
      WHERE id = $1`,
    [id, para, error]);
}

/**
 * Un envío con errores. Al llegar al tope, el enlace deja de valer y la
 * venta pasa a revisión. Devuelve la fila como queda.
 */
export async function sumarIntento(id, maximo) {
  const { rows } = await query(
    `UPDATE factura_datos_fiscales
        SET intentos = intentos + 1,
            token_hash = CASE WHEN intentos + 1 >= $2 THEN NULL ELSE token_hash END,
            estado = CASE WHEN intentos + 1 >= $2 THEN 'revision' ELSE estado END,
            motivo_revision = CASE WHEN intentos + 1 >= $2
                                   THEN 'El alumno agotó los intentos del formulario' ELSE motivo_revision END,
            updated_at = NOW()
      WHERE id = $1 AND estado = 'pendiente'
      RETURNING *`,
    [id, maximo]);
  return rows[0] || null;
}

/**
 * Guarda los datos y QUEMA el enlace en la misma sentencia: solo entra el
 * primero que llegue (dos envíos a la vez no guardan los dos).
 */
export async function guardarDatos(id, d, { origen, ip = null, estado }) {
  const { rows } = await query(
    `UPDATE factura_datos_fiscales
        SET cliente_tipo = $2, nombre = $3, nif = $4, direccion = $5, codigo_postal = $6,
            ciudad = $7, pais = $8, email = $9,
            origen_datos = $10::text, estado = $11, token_hash = NULL,
            respondido_at = CASE WHEN $10::text = 'formulario' THEN NOW() ELSE respondido_at END,
            respondido_ip = COALESCE($12, respondido_ip),
            motivo_revision = NULL, updated_at = NOW()
      WHERE id = $1 AND estado = 'pendiente'
      RETURNING *`,
    [id, d.tipo, d.nombre, d.nif, d.direccion, d.codigo_postal, d.ciudad, d.pais, d.email,
      origen, estado, ip]);
  return rows[0] || null;
}

/** Día 7 sin datos buenos: a revisión, con el enlace quemado. */
export async function aRevision(id, motivo) {
  const { rows } = await query(
    `UPDATE factura_datos_fiscales
        SET estado = 'revision', token_hash = NULL, motivo_revision = $2, updated_at = NOW()
      WHERE id = $1 AND estado = 'pendiente'
      RETURNING *`,
    [id, motivo]);
  return rows[0] || null;
}

/**
 * Por qué no salió sola la última vez (null = salió, o no lo intentó). Con su
 * código delante, «[POSIBLE_DUPLICADA] Ya existe…»: la cola lo lee para decir
 * el motivo real en vez de «sale sola» (CRM#764, 18/11).
 */
export async function anotarError(id, error, codigo = null) {
  const texto = error ? `${codigo ? `[${codigo}] ` : ''}${String(error)}`.slice(0, 500) : null;
  await query(
    `UPDATE factura_datos_fiscales SET ultimo_error = $2, updated_at = NOW() WHERE id = $1`,
    [id, texto]);
}

/** Enlace nuevo (reenvío): el anterior deja de valer y el plazo vuelve a contar. */
export async function renovarEnlace(id, { tokenHash, caducaAt }) {
  const { rows } = await query(
    `UPDATE factura_datos_fiscales
        SET token_hash = $2, caduca_at = $3, intentos = 0, estado = 'pendiente',
            motivo_revision = NULL, updated_at = NOW()
      WHERE id = $1 AND estado IN ('pendiente', 'revision')
      RETURNING *`,
    [id, tokenHash, caducaAt]);
  return rows[0] || null;
}

/** Las que han pasado su plazo sin respuesta. */
export async function vencidas(limite = 50) {
  const { rows } = await query(
    `SELECT id, conversion_id FROM factura_datos_fiscales
      WHERE estado = 'pendiente' AND caduca_at <= NOW()
      ORDER BY caduca_at LIMIT $1`,
    [limite]);
  return rows;
}

/** Ventas con los datos ya buenos y algún cobro todavía sin factura. */
export async function conCobrosSinFactura(limite = 50) {
  const { rows } = await query(
    `SELECT f.id, f.conversion_id FROM factura_datos_fiscales f
      WHERE f.estado IN ('respondido', 'ficha')
        AND EXISTS (SELECT 1 FROM conversion_payments cp
                     WHERE cp.conversion_id = f.conversion_id AND cp.importe > 0
                       AND NOT EXISTS (SELECT 1 FROM invoices i
                                        WHERE i.payment_id = cp.id AND i.estado <> 'cancelada'))
      ORDER BY f.updated_at LIMIT $1`,
    [limite]);
  return rows;
}

/** Los cobros de la venta que aún no tienen factura, por orden de fecha. */
export async function cobrosSinFactura(conversionId) {
  const { rows } = await query(
    `SELECT cp.id, cp.importe, cp.fecha::text AS fecha
       FROM conversion_payments cp
      WHERE cp.conversion_id = $1 AND cp.importe > 0
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.payment_id = cp.id AND i.estado <> 'cancelada')
      ORDER BY cp.fecha, cp.id`,
    [conversionId]);
  return rows;
}

/**
 * Los datos del formulario, también en la ficha: así la próxima venta de esta
 * persona ya los tiene, y quien abre la ficha ve con qué se le facturó. Solo
 * los fiscales: el nombre y el correo de contacto no se tocan.
 */
export async function copiarAFicha(leadId, d) {
  if (!leadId) return;
  // `$7::text` en los DOS sitios. Sin el cast, Postgres deducía varchar por la
  // columna y text por la comparación, y la consulta entera fallaba con
  // «inconsistent types deduced for parameter $7»: la ficha se quedaba sin el
  // NIF del alumno y lo que facturaba con la ficha salía con «—» (CRM#764, 18/11).
  await query(
    `UPDATE leads
        SET identificacion_fiscal = $2, direccion_fiscal = $3, ciudad_fiscal = $4,
            codigo_postal_fiscal = $5, pais_fiscal = $6, cliente_tipo = $7::text,
            custom_fields = CASE WHEN $7::text = 'empresa'
                                 THEN COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object('razon_social', $8::text)
                                 ELSE custom_fields END,
            updated_at = NOW()
      WHERE id = $1`,
    [leadId, d.nif, d.direccion, d.ciudad, d.codigo_postal, d.pais, d.tipo, d.nombre]);
}

/** Estado de la petición de varias ventas a la vez (para la cola). */
export async function estadosDe(conversionIds = []) {
  if (!conversionIds.length) return new Map();
  const { rows } = await query(
    `SELECT conversion_id, estado, caduca_at, motivo_revision, ultimo_error
       FROM factura_datos_fiscales
      WHERE conversion_id = ANY($1::int[]) AND estado <> 'anulado'`,
    [conversionIds]);
  return new Map(rows.map((r) => [Number(r.conversion_id), r]));
}
