import { AppError } from '../../shared/utils/AppError.js';

/**
 * Un cobro con factura emitida no se borra por detrás (CRM-ISEIE#856, gemela
 * CRM#1228).
 *
 * Las claves ajenas de la factura y de la cuota hacia el cobro son ON DELETE
 * SET NULL: al borrar el cobro la factura se quedaba huérfana, y el CRM la
 * volvía a enganchar sola al cobro del mismo importe más cercano. Eso no se
 * deshace borrando: se anula la factura o se emite una rectificativa.
 *
 * Lo usan «Eliminar pago» (`deletePayment`) y «Deshacer el pago» de una cuota
 * (`unpay`), para que los dos digan que no con el mismo criterio y el mismo
 * mensaje. La proforma no cuenta (no es una factura); la cancelada tampoco.
 */
export async function negarSiTieneFactura(client, paymentId) {
  if (!paymentId) return;
  const { rows } = await client.query(
    `SELECT codigo FROM invoices
      WHERE payment_id = $1 AND tipo <> 'proforma' AND estado <> 'cancelada'
      LIMIT 1`,
    [paymentId]
  );
  if (rows[0]) {
    throw new AppError(
      `Ese cobro tiene la factura ${rows[0].codigo}. Anulala o emite una rectificativa antes de borrarlo.`,
      409, 'PAYMENT_HAS_INVOICE'
    );
  }
}
