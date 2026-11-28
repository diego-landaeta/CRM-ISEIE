import { AppError } from '../../shared/utils/AppError.js';

/**
 * Cuándo se puede borrar un cobro. UNA sola regla para «Eliminar pago»
 * (`deletePayment`) y «Deshacer el pago» de una cuota (`unpay`), y la misma que
 * enseña la pantalla antes de pulsar (CRM-ISEIE#856 + CRM-ISEIE#858, gemelas
 * CRM#1228 + #1230; se unificaron por chocar).
 *
 * Las claves ajenas de la factura y de la cuota hacia el cobro son ON DELETE
 * SET NULL: al borrar el cobro la factura se quedaba huérfana, y el CRM la
 * volvía a enganchar sola al cobro del mismo importe más cercano. Por eso:
 *
 *   · Sin factura, con proforma o con la factura cancelada → se puede.
 *   · Con la factura ANULADA y sus abonos vivos dejándola a cero → se puede.
 *     «Anular» (CRM#793) no la pasa a cancelada: le pone `anulada_at` y emite un
 *     abono por lo que quede. Ese cobro ya no tiene factura que lo respalde. La
 *     factura y el abono no se tocan (son documentos emitidos): solo se suelta
 *     su enlace al cobro.
 *   · Con una factura vigente → 409: se anula antes.
 *   · Anulada sin llegar a cero → 409 con lo que falta.
 *   · En borrador → 409: un borrador no se anula, se edita o se cancela.
 *   · Con una comisión de tutor ya pagada → 409: la clave ajena es ON DELETE
 *     CASCADE (migración 124) y se llevaría por delante una liquidación hecha.
 */

/** SQL de las facturas del cobro que cuentan, con lo que les queda tras sus abonos. */
export const FACTURAS_DEL_COBRO = (pago) => `
  SELECT i.id, i.codigo, i.tipo, i.estado, i.numero,
         i.anulada_at IS NOT NULL AS anulada,
         ROUND(i.total + COALESCE((SELECT SUM(r.total) FROM invoices r
                                    WHERE r.rectifica_id = i.id AND r.tipo = 'rectificativa'
                                      AND r.estado <> 'cancelada'), 0), 2)::float8 AS saldo
    FROM invoices i
   WHERE i.payment_id = ${pago} AND i.tipo <> 'proforma' AND i.estado <> 'cancelada'`;

/** ¿Tiene el cobro una comisión de tutor ya liquidada? */
export const COMISION_TUTOR_PAGADA = (pago) =>
  `EXISTS (SELECT 1 FROM tutor_commissions tc WHERE tc.payment_id = ${pago} AND tc.estado = 'pagada')`;

/**
 * Las dos columnas que necesita la pantalla para decir lo mismo que el
 * servidor (`conBloqueoDelCobro` las convierte). `pago` es la columna del cobro.
 */
export const COLUMNAS_DEL_BLOQUEO = (pago) => `
  (SELECT json_agg(fc) FROM (${FACTURAS_DEL_COBRO(pago)}) fc) AS cobro_facturas,
  ${COMISION_TUTOR_PAGADA(pago)} AS cobro_tutor_pagada`;

/** Anulada y a cero: ya no respalda el cobro. Un abono nunca cuenta como tal. */
export function anuladaACero(f) {
  return !!f && !!f.anulada && f.tipo !== 'rectificativa' && Math.abs(Number(f.saldo) || 0) < 0.005;
}

export const MOTIVO_COMISION_TUTOR =
  'Ese cobro tiene una comisión de tutor ya pagada. Revierte la comisión antes de borrar el cobro.';

/**
 * Por qué no se puede borrar un cobro con estas facturas, o null si se puede.
 * El texto es el que sale en el 409 y en la pantalla.
 */
export function motivoParaNoBorrar(facturas, { comisionTutorPagada = false } = {}) {
  const f = (facturas || []).find((x) => !anuladaACero(x));
  if (f) {
    if (f.estado === 'borrador' || f.numero == null) {
      return `Ese cobro tiene una factura en borrador${f.codigo ? ` (${f.codigo})` : ''}. Edítala o cancélala antes de borrar el cobro.`;
    }
    if (f.tipo === 'rectificativa') {
      return `Ese cobro está enlazado al abono ${f.codigo || ''}, y un abono no se anula: no se puede borrar el cobro.`;
    }
    if (f.anulada) {
      return `La factura ${f.codigo || ''} de ese cobro está anulada, pero sus abonos no la dejan a cero `
        + `(quedan ${Number(f.saldo).toFixed(2)}). Emite el abono que falta antes de borrar el cobro.`;
    }
    return `Ese cobro tiene la factura ${f.codigo || ''}. Anúlala antes de borrar el cobro.`;
  }
  if (comisionTutorPagada) return MOTIVO_COMISION_TUTOR;
  return null;
}

/**
 * Convierte las columnas de COLUMNAS_DEL_BLOQUEO en lo que lee la pantalla:
 * `cobro_bloqueo` (el mismo texto del 409, o null si se puede borrar) y
 * `factura_anulada_a_cero` (todas sus facturas están anuladas y a cero).
 */
export function conBloqueoDelCobro(row) {
  const { cobro_facturas: facturas, cobro_tutor_pagada: tutor, ...resto } = row;
  const lista = Array.isArray(facturas) ? facturas : [];
  return {
    ...resto,
    factura_anulada_a_cero: lista.length > 0 && lista.every(anuladaACero),
    cobro_bloqueo: motivoParaNoBorrar(lista, { comisionTutorPagada: !!tutor }),
  };
}

/**
 * La regla, dentro de la transacción del borrado. Bloquea antes la fila del
 * cobro (FOR UPDATE): una factura que se emite a la vez para este cobro tiene
 * que comprobar su clave ajena contra esa fila, así que o espera a que se borre
 * (y falla) o ya está y se ve aquí. Devuelve las facturas (anuladas a cero)
 * que se quedan sin cobro, para el rastro.
 */
export async function negarSiTieneFactura(client, paymentId) {
  if (!paymentId) return [];
  await client.query('SELECT 1 FROM conversion_payments WHERE id = $1 FOR UPDATE', [paymentId]);
  const { rows } = await client.query(`${FACTURAS_DEL_COBRO('$1')} ORDER BY i.id FOR UPDATE OF i`, [paymentId]);
  const { rows: [t] } = await client.query(`SELECT ${COMISION_TUTOR_PAGADA('$1')} AS pagada`, [paymentId]);
  const motivo = motivoParaNoBorrar(rows, { comisionTutorPagada: !!t?.pagada });
  if (motivo) {
    const porFactura = rows.some((f) => !anuladaACero(f));
    throw new AppError(motivo, 409, porFactura ? 'PAYMENT_HAS_INVOICE' : 'PAYMENT_HAS_PAID_COMMISSION');
  }
  return rows;
}

/**
 * La comisión de la gestora ya pagada NO se rebaja al borrar un cobro: ese
 * dinero ya salió. Se deja como está y se avisa para que se regularice a mano.
 * Devuelve la comisión pagada (o null), con la fila bloqueada.
 */
export async function comisionGestoraPagada(client, conversionId) {
  const { rows: [c] } = await client.query(
    `SELECT id, importe_comision::float8 AS importe, fecha_pago::text AS fecha_pago
       FROM commissions WHERE conversion_id = $1 AND estado = 'pagado' FOR UPDATE`,
    [conversionId]);
  return c || null;
}

export function avisoComisionPagada(c) {
  if (!c) return null;
  return `La comisión de la gestora de esta venta ya está pagada (${Number(c.importe).toFixed(2)} €`
    + `${c.fecha_pago ? `, el ${c.fecha_pago}` : ''}): no se ha rebajado. Regularízala a mano si hace falta.`;
}

/**
 * Rastro del borrado, en la misma transacción: qué cobro era, de cuánto, de
 * qué día, por qué medio, su cargo de Stripe si lo tenía, las facturas que
 * se quedan sin él y quién lo hizo. Sin usuario (un proceso) no se apunta:
 * `user_activity_log.user_id` es obligatorio.
 *
 * Lleva el campus de la venta en `details.project_id`: el Registro recorta
 * por él (registro.model.js, `deUsuarios`). Sin campus, la fila contaba como
 * «de la persona» y la veía un admin de otro campus en el que estuviera quien
 * borró, con el importe, las notas, la referencia y el cargo de Stripe.
 */
export async function apuntarCobroBorrado(client, { paymentId, accion, userId, ip = null, facturas = [], comisionPagada = null }) {
  if (!userId || !paymentId) return;
  const { rows: [p] } = await client.query(
    `SELECT cp.id, cp.conversion_id, cv.project_id, cp.importe::float8 AS importe, cp.fecha::text AS fecha,
            cp.metodo, cp.referencia, cp.notas, cp.origen, cp.origen_ref,
            (SELECT string_agg(ci.numero::text, ', ' ORDER BY ci.numero)
               FROM conversion_installments ci WHERE ci.payment_id = cp.id) AS cuotas,
            COALESCE((SELECT json_agg(json_build_object('stripe_id', sp.stripe_id, 'tipo', sp.type, 'estado', sp.status) ORDER BY sp.id)
                        FROM stripe_payments sp WHERE sp.conversion_payment_id = cp.id), '[]'::json) AS stripe
       FROM conversion_payments cp
       JOIN conversions cv ON cv.id = cp.conversion_id
      WHERE cp.id = $1`,
    [paymentId]);
  if (!p) return;
  const details = {
    accion,
    payment_id: p.id,
    conversion_id: p.conversion_id,
    project_id: p.project_id,
    importe: p.importe,
    fecha: p.fecha,
    metodo: p.metodo,
    referencia: p.referencia,
    notas: p.notas,
    origen: p.origen,
    origen_ref: p.origen_ref,
    stripe: p.stripe,
    facturas: facturas.map((f) => f.codigo).filter(Boolean),
    cuotas: p.cuotas,
    comision_gestora_pagada: comisionPagada ? { id: comisionPagada.id, importe: comisionPagada.importe } : null,
  };
  await client.query(
    `INSERT INTO user_activity_log (user_id, action, details, ip_address) VALUES ($1, 'cobro_borrado', $2::jsonb, $3)`,
    [userId, JSON.stringify(details), ip]);
}

/**
 * Todo lo que va antes de borrar un cobro, en su transacción: la regla, la
 * comisión de la gestora pagada y el rastro. Lo llaman los dos caminos.
 */
export async function antesDeBorrarCobro(client, { paymentId, conversionId, accion, userId = null, ip = null }) {
  const facturas = await negarSiTieneFactura(client, paymentId);
  // Sin cobro que borrar, lo cobrado no cambia y la comisión tampoco.
  const comisionPagada = paymentId ? await comisionGestoraPagada(client, conversionId) : null;
  await apuntarCobroBorrado(client, { paymentId, accion, userId, ip, facturas, comisionPagada });
  return { facturas, comisionPagada };
}
