/**
 * Registrar en su venta un cobro que viene de fuera (#766): PayPal o el banco.
 *
 * Las mismas reglas que Stripe (`stripe-payments.service.js`), escritas una vez
 * para los dos orígenes nuevos:
 *
 *   1. Si ese cobro YA está en el CRM con su id de origen (`origen`+`origen_ref`),
 *      es ese. Búsqueda por el id EXACTO, nunca por un trozo.
 *   2. Si una persona ya lo apuntó a mano en la venta —mismo importe con un euro
 *      de margen y fecha cercana, sin otro cobro externo enganchado—, se engancha
 *      a ese y se le estampa el origen. No se suma otra vez.
 *   3. Si no, se registra con `addPayment` (la misma lógica que un cobro manual:
 *      salda cuotas FIFO y deja lo cobrado igual a la suma de los pagos, #692),
 *      con `origen` y `origen_ref`. El índice único (origen, origen_ref) es la
 *      última barrera: si dos procesos llegan a la vez, el segundo choca y se
 *      queda con el del primero.
 *
 * El cobro NO emite factura: espera en la cola de facturación, como los de Stripe.
 */
import { query } from '../../shared/config/db.js';
import * as convModel from '../conversions/conversion.model.js';

/** El cobro ya registrado con ese id de origen, o null. Id exacto. */
export async function cobroPorOrigen(origen, ref) {
  if (!origen || !ref) return null;
  const { rows } = await query(
    `SELECT id, conversion_id, importe, fecha FROM conversion_payments
      WHERE origen = $1 AND origen_ref = $2 LIMIT 1`,
    [origen, String(ref)]
  );
  return rows[0] || null;
}

/**
 * Un cobro apuntado A MANO en la venta que es este mismo dinero: mismo importe
 * (un euro de margen, como Stripe) y fecha a menos de `dias`. Sin origen propio
 * y sin un cargo de Stripe, un cobro de PayPal o un movimiento del banco ya
 * enganchados: un cobro de fuera solo se engancha a uno que nadie reclama.
 */
export async function cobroManualEquivalente(conversionId, importe, fecha, dias = 3) {
  const { rows } = await query(
    `SELECT cp.id
       FROM conversion_payments cp
      WHERE cp.conversion_id = $1
        AND cp.origen IS NULL
        AND ABS(cp.importe::numeric - $2::numeric) <= 1.00
        AND ABS(cp.fecha - $3::date) <= $4
        AND NOT EXISTS (SELECT 1 FROM stripe_payments sp WHERE sp.conversion_payment_id = cp.id)
        AND NOT EXISTS (SELECT 1 FROM paypal_payments pp WHERE pp.conversion_payment_id = cp.id)
        AND NOT EXISTS (SELECT 1 FROM movimientos_banco mb WHERE mb.conversion_payment_id = cp.id)
      ORDER BY ABS(cp.importe::numeric - $2::numeric), ABS(cp.fecha - $3::date), cp.id
      LIMIT 1`,
    [conversionId, importe, fecha, dias]
  );
  return rows[0] || null;
}

/** Estampa el origen en un cobro manual que resultó ser este cobro de fuera. */
async function estamparOrigen(paymentId, origen, ref) {
  // Solo si sigue sin origen; si otro proceso se adelantó con el mismo id,
  // el índice único lo impide y nos quedamos con el suyo.
  try {
    await query(
      `UPDATE conversion_payments SET origen = $2, origen_ref = $3
        WHERE id = $1 AND origen IS NULL`,
      [paymentId, origen, String(ref)]
    );
  } catch (e) {
    if (e.code !== '23505') throw e;
  }
}

/**
 * Deja el cobro registrado en la venta, una sola vez.
 *
 * Devuelve `{ paymentId, metodo }`: `metodo` es 'nuevo' (se creó el cobro),
 * 'dedup' (ya estaba apuntado a mano) o 'ya_estaba' (ya entró antes con su id).
 * `null` si la venta no existe.
 */
export async function registrarCobroExterno({
  conversionId, origen, ref, importe, fecha, notas, metodo, referencia = null, diasMargen = 3,
}) {
  const ya = await cobroPorOrigen(origen, ref);
  if (ya) return { paymentId: ya.id, metodo: 'ya_estaba', conversionId: ya.conversion_id };

  const manual = await cobroManualEquivalente(conversionId, importe, fecha, diasMargen);
  if (manual) {
    await estamparOrigen(manual.id, origen, ref);
    const tras = await cobroPorOrigen(origen, ref);
    return { paymentId: tras?.id ?? manual.id, metodo: 'dedup', conversionId };
  }

  try {
    const res = await convModel.addPayment(conversionId, {
      importe, fecha, notas, metodo, referencia, origen, origen_ref: String(ref),
    }, { allowOverpay: true, allowDuplicate: true });
    if (res?.error === 'NOT_FOUND') return null;
    if (res?.error || !res?.payment) throw new Error(`no se pudo registrar el cobro (${res?.error || 'sin cobro'})`);
    return { paymentId: res.payment.id, metodo: 'nuevo', conversionId };
  } catch (e) {
    // Otro proceso lo registró entre la búsqueda y el INSERT: el índice único
    // lo ha parado. Es ese.
    if (e.code === '23505') {
      const otro = await cobroPorOrigen(origen, ref);
      if (otro) return { paymentId: otro.id, metodo: 'ya_estaba', conversionId: otro.conversion_id };
    }
    throw e;
  }
}

/** El campus de una venta, o null. */
export async function campusDeLaVenta(conversionId) {
  const { rows } = await query('SELECT project_id, lead_id FROM conversions WHERE id = $1', [conversionId]);
  return rows[0] ? { projectId: Number(rows[0].project_id), leadId: rows[0].lead_id } : null;
}

/** Quita tildes, pasa a minúsculas y deja solo letras, números y espacios. */
export function normalizarTexto(t) {
  return String(t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}
