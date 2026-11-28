import { AppError } from '../../shared/utils/AppError.js';

/**
 * Cuándo se puede borrar un cobro con factura. UNA sola regla para «Eliminar
 * pago» (`deletePayment`) y «Deshacer el pago» de una cuota (`unpay`), con el
 * mismo texto (CRM-ISEIE#856 + CRM-ISEIE#858, gemelas CRM#1228 + #1230; se
 * unificaron por chocar).
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

/** Anulada y a cero: ya no respalda el cobro. Un abono nunca cuenta como tal. */
export function anuladaACero(f) {
  return !!f && !!f.anulada && f.tipo !== 'rectificativa' && Math.abs(Number(f.saldo) || 0) < 0.005;
}

/**
 * Por qué no se puede borrar un cobro con estas facturas, o null si se puede.
 * El texto es el que sale en el 409.
 */
export function motivoParaNoBorrar(facturas) {
  const f = (facturas || []).find((x) => !anuladaACero(x));
  if (!f) return null;
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

/** La regla, dentro de la transacción del borrado: 409 si el cobro no se puede borrar. */
export async function negarSiTieneFactura(client, paymentId) {
  if (!paymentId) return [];
  const { rows } = await client.query(`${FACTURAS_DEL_COBRO('$1')} ORDER BY i.id FOR UPDATE OF i`, [paymentId]);
  const motivo = motivoParaNoBorrar(rows);
  if (motivo) throw new AppError(motivo, 409, 'PAYMENT_HAS_INVOICE');
  return rows;
}
