import { query } from '../../shared/config/db.js';
import { NOMBRE_NORMALIZADO, NIF_NORMALIZADO } from '../invoices/posible-duplicada.js';
import { VENTA_YA_FACTURADA_LO_CUBRE } from '../invoices/invoices.model.js';

/*
  CONCILIACIÓN · FACTURAS Y COBROS (CRM#905).

  Diego, 18/11: en el 360 se enlazaron a mano 89 facturas emitidas que no tenían
  su cobro, casi todas de las cargas de Excel; quedaban unas 56 sin cobro y unos
  400 cobros sin factura. Esto lo hace ahora administración desde el CRM.

  El enlace es `invoices.payment_id` (107): el cobro (conversion_payments) que
  lleva esa factura. Una factura emitida SIN cobro es una normal, con número, no
  cancelada ni anulada y con `payment_id` vacío. Un cobro SIN factura es el que
  no tiene ninguna factura viva con su id, y que no cubre ya una factura de la
  venta entera (la misma regla que la cola: `VENTA_YA_FACTURADA_LO_CUBRE`).

  CANDIDATOS. Una factura y un cobro casan si:
    · son del mismo campus;
    · el importe es el mismo (céntimo a céntimo: los dos son NUMERIC(10,2));
    · la fecha del cobro está a `dias` o menos de la emisión o del pago de la
      factura;
    · y son del mismo cliente: la misma venta, el mismo correo, el mismo nombre
      (sin mayúsculas, tildes ni espacios de más, como en «posible duplicada»)
      o el mismo NIF.

  «SEGURO». La pareja es segura cuando la factura solo casa con ese cobro y el
  cobro solo casa con esa factura. Si uno de los dos tiene otra pareja posible,
  lo decide una persona.
*/

export const DIAS = 7;

/** Factura emitida, normal y viva, sin cobro. Sobre el alias `i`. */
export const FACTURA_SIN_COBRO = `i.payment_id IS NULL
   AND i.tipo = 'normal'
   AND i.numero IS NOT NULL
   AND i.estado NOT IN ('borrador', 'cancelada')
   AND i.anulada_at IS NULL
   AND i.total > 0`;

/** Cobro sin factura propia. Sobre el alias `cp`. */
const COBRO_SIN_FACTURA = `cp.importe > 0
   AND NOT EXISTS (SELECT 1 FROM invoices x
                    WHERE x.payment_id = cp.id AND x.estado <> 'cancelada')`;

/** Mismo cliente, sobre `i` (factura), `cp` (cobro) y `l` (alumno de la venta). */
const MISMO_CLIENTE = `(
      (i.conversion_id IS NOT NULL AND i.conversion_id = cp.conversion_id)
   OR (NULLIF(lower(btrim(i.cliente_email)), '') = NULLIF(lower(btrim(l.email)), ''))
   OR (${NOMBRE_NORMALIZADO('i.cliente_nombre')} <> ''
       AND ${NOMBRE_NORMALIZADO('i.cliente_nombre')} IN (
             ${NOMBRE_NORMALIZADO('l.nombre')},
             ${NOMBRE_NORMALIZADO("l.custom_fields->>'razon_social'")}))
   OR (${NIF_NORMALIZADO('i.cliente_nif')} IS NOT NULL
       AND ${NIF_NORMALIZADO('i.cliente_nif')} = ${NIF_NORMALIZADO('l.identificacion_fiscal')})
  )`;

/** Por qué casan, para enseñarlo. El mismo orden que MISMO_CLIENTE. */
const POR_QUE = `CASE
     WHEN i.conversion_id IS NOT NULL AND i.conversion_id = cp.conversion_id THEN 'venta'
     WHEN NULLIF(lower(btrim(i.cliente_email)), '') = NULLIF(lower(btrim(l.email)), '') THEN 'correo'
     WHEN ${NIF_NORMALIZADO('i.cliente_nif')} IS NOT NULL
      AND ${NIF_NORMALIZADO('i.cliente_nif')} = ${NIF_NORMALIZADO('l.identificacion_fiscal')} THEN 'nif'
     ELSE 'nombre' END`;

/** Días entre el cobro y la factura: lo más cerca de la emisión o del pago. */
const DISTANCIA = `LEAST(ABS(cp.fecha - i.fecha_emision),
                         COALESCE(ABS(cp.fecha - i.fecha_pago), 2147483647))`;

/** «YYYY-MM» → [primer día, último día]. Sin mes, null. */
export function rangoDelMes(mes) {
  if (!mes) return null;
  const [a, m] = String(mes).split('-').map(Number);
  const desde = `${a}-${String(m).padStart(2, '0')}-01`;
  const fin = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { desde, hasta: `${a}-${String(m).padStart(2, '0')}-${String(fin).padStart(2, '0')}` };
}

/** Las facturas emitidas sin cobro de esos campus (null = todos) y ese mes. */
export async function facturasSinCobro({ campus, rango, limite = 500 }) {
  const { rows } = await query(
    `SELECT i.id, i.project_id, p.nombre AS campus, i.codigo, i.fecha_emision::text AS fecha,
            i.fecha_pago::text AS fecha_pago, i.total::float8 AS total, i.estado,
            i.cliente_nombre, i.cliente_email, i.conversion_id, i.lead_id
       FROM invoices i
       JOIN projects p ON p.id = i.project_id
      WHERE ${FACTURA_SIN_COBRO}
        AND ($1::int[] IS NULL OR i.project_id = ANY($1::int[]))
        AND ($2::date IS NULL OR i.fecha_emision >= $2::date)
        AND ($3::date IS NULL OR i.fecha_emision <= $3::date)
      ORDER BY i.fecha_emision, i.id
      LIMIT $4`,
    [campus, rango?.desde || null, rango?.hasta || null, limite]);
  return rows;
}

/**
 * Los cobros sin factura de esos campus y ese mes, con si están en la cola de
 * facturación o por qué no (la misma cuenta que `listPagosSinFactura`: «al día»
 * hasta una fecha, o de un ejercicio anterior).
 */
export async function cobrosSinFactura({ campus, rango, limite = 500 }) {
  const { rows } = await query(
    `SELECT cp.id, c.project_id, p.nombre AS campus, cp.fecha::text AS fecha,
            cp.importe::float8 AS importe, cp.metodo, cp.conversion_id, c.lead_id,
            l.nombre AS cliente, l.email AS cliente_email, c.producto_contratado AS producto,
            EXISTS (SELECT 1 FROM stripe_payments sp WHERE sp.conversion_payment_id = cp.id) AS de_stripe,
            CASE
              WHEN cp.fecha <= COALESCE((SELECT st.al_dia_hasta FROM invoicing_status st
                                          WHERE st.project_id = c.project_id), DATE '1900-01-01')
                THEN 'al_dia'
              WHEN cp.fecha < make_date(
                     (SELECT COALESCE(MAX(sq.ano), EXTRACT(YEAR FROM CURRENT_DATE)::int)
                        FROM invoice_sequences sq WHERE sq.project_id = c.project_id), 1, 1)
                THEN 'ejercicio_anterior'
              ELSE NULL
            END AS fuera_de_cola
       FROM conversion_payments cp
       JOIN conversions c ON c.id = cp.conversion_id
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN leads l ON l.id = c.lead_id
      WHERE ${COBRO_SIN_FACTURA}
        ${VENTA_YA_FACTURADA_LO_CUBRE}
        AND ($1::int[] IS NULL OR c.project_id = ANY($1::int[]))
        AND ($2::date IS NULL OR cp.fecha >= $2::date)
        AND ($3::date IS NULL OR cp.fecha <= $3::date)
      ORDER BY cp.fecha, cp.id
      LIMIT $4`,
    [campus, rango?.desde || null, rango?.hasta || null, limite]);
  return rows;
}

/**
 * Todas las parejas posibles (factura sin cobro, cobro sin factura) en las que
 * está alguna de esas facturas o alguno de esos cobros. Con cada pareja, lo que
 * hace falta para enseñar al otro lado.
 */
export async function parejas({ invoiceIds = [], paymentIds = [], dias = DIAS }) {
  if (!invoiceIds.length && !paymentIds.length) return [];
  const { rows } = await query(
    `SELECT i.id AS invoice_id, cp.id AS payment_id,
            ${DISTANCIA} AS dias, ${POR_QUE} AS por,
            i.codigo, i.fecha_emision::text AS factura_fecha, i.cliente_nombre AS factura_cliente,
            cp.fecha::text AS cobro_fecha, cp.importe::float8 AS importe, cp.conversion_id,
            l.nombre AS cobro_cliente, c.producto_contratado AS producto
       FROM invoices i
       JOIN conversion_payments cp ON cp.importe = i.total
       JOIN conversions c ON c.id = cp.conversion_id AND c.project_id = i.project_id
       LEFT JOIN leads l ON l.id = c.lead_id
      WHERE (i.id = ANY($1::int[]) OR cp.id = ANY($2::int[]))
        AND ${FACTURA_SIN_COBRO}
        AND ${COBRO_SIN_FACTURA}
        AND ${DISTANCIA} <= $3
        AND ${MISMO_CLIENTE}
      ORDER BY i.id, ${DISTANCIA}, cp.id`,
    [invoiceIds, paymentIds, dias]);
  return rows.map((r) => ({ ...r, invoice_id: Number(r.invoice_id), payment_id: Number(r.payment_id), dias: Number(r.dias) }));
}

/** La factura, bloqueada para enlazarla. */
export async function facturaParaEnlazar(exec, id) {
  const { rows } = await exec(
    `SELECT id, project_id, codigo, tipo, estado, numero, total::float8 AS total, payment_id,
            conversion_id, lead_id, anulada_at
       FROM invoices WHERE id = $1 FOR UPDATE`, [id]);
  return rows[0] || null;
}

/** El cobro, bloqueado, con su campus, su alumno y si ya tiene factura. */
export async function cobroParaEnlazar(exec, id) {
  const { rows } = await exec(
    `SELECT cp.id, cp.importe::float8 AS importe, cp.fecha::text AS fecha, cp.conversion_id,
            c.project_id, c.lead_id,
            (SELECT x.codigo FROM invoices x
              WHERE x.payment_id = cp.id AND x.estado <> 'cancelada'
              ORDER BY x.id LIMIT 1) AS factura_codigo,
            EXISTS (SELECT 1 FROM invoices x
                     WHERE x.payment_id = cp.id AND x.estado <> 'cancelada') AS tiene_factura
       FROM conversion_payments cp
       JOIN conversions c ON c.id = cp.conversion_id
      WHERE cp.id = $1
        FOR UPDATE OF cp`, [id]);
  return rows[0] || null;
}

/**
 * Une la factura con su cobro y su venta. NO toca el número, el importe, la
 * emisora ni los datos del cliente: solo `payment_id`, `conversion_id` y
 * `lead_id` (el alumno de la venta; si la venta no tiene, el que ya llevaba).
 */
export async function enlazar(exec, { invoiceId, payment }) {
  const { rows } = await exec(
    `UPDATE invoices
        SET payment_id = $2, conversion_id = $3, lead_id = COALESCE($4, lead_id), updated_at = NOW()
      WHERE id = $1 AND payment_id IS NULL
      RETURNING id, codigo, payment_id, conversion_id, lead_id, total::float8 AS total`,
    [invoiceId, payment.id, payment.conversion_id, payment.lead_id || null]);
  return rows[0] || null;
}

/** Queda quién lo enlazó y qué había antes (user_activity_log). */
export async function apuntar(exec, { userId, ip, detalle }) {
  if (!userId) return;
  await exec(
    `INSERT INTO user_activity_log (user_id, action, details, ip_address)
     VALUES ($1, 'conciliacion.enlazar_factura', $2::jsonb, $3)`,
    [userId, JSON.stringify(detalle), ip || null]);
}
