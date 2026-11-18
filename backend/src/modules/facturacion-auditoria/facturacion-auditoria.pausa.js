import { AsyncLocalStorage } from 'node:async_hooks';
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { leerConfig } from './facturacion-auditoria.config.js';

/*
  LA PAUSA DE LA FACTURACIÓN (#765).

  Cuando la auditoría encuentra un error, la emisión de facturas NUEVAS se para:
  la automática al entrar un cobro, la de la cola, la manual, emitir un
  borrador, numerar una proforma y pasar una proforma a factura. Todo lo que
  gasta un número de la serie, que es lo que no puede seguir mientras la serie
  esté mal.

  Lo que NO para (espera la decisión de Manuel en CRM#793): corregir, cambiar
  fechas, completar datos, borrar o abonar (rectificativa) una factura ya
  emitida. Las reglas de las facturas emitidas no se tocan aquí.

  Dos excepciones, y las dos son para poder SALIR de la pausa:

    · Los cobros que ya estaban atrasados cuando se pausó (más de X días sin
      factura). Si la auditoría pausó por ellos, la única forma de arreglarlo
      es facturarlos; y son los más antiguos, así que el orden se mantiene.
    · La cola de la pausa al reanudar (`emitiendoLaColaDeLaPausa`): ya se ha
      auditado limpia y la pausa sigue abierta hasta que termina de emitir,
      para que ningún cobro nuevo se cuele por delante.

  Con el interruptor apagado esto no hace ni una consulta.
*/

const colaDeLaPausa = new AsyncLocalStorage();

/** Ejecuta `fn` emitiendo la cola de la pausa: la pausa no la para. */
export function emitiendoLaColaDeLaPausa(fn) {
  return colaDeLaPausa.run(true, fn);
}

/** La pausa abierta, o null. Con el interruptor apagado, siempre null. */
export async function pausaAbierta({ cfg = leerConfig() } = {}) {
  if (!cfg.activa) return null;
  try {
    const { rows } = await query(
      `SELECT id, pausada_at, auditoria_id, motivo, incidencias
         FROM facturacion_pausas
        WHERE reanudada_at IS NULL
        ORDER BY id DESC LIMIT 1`);
    return rows[0] || null;
  } catch (err) {
    // Sin la migración 283 no se puede saber: se factura como siempre y se dice.
    // Una comprobación que no puede hacerse no puede parar la facturación.
    logger.error({ err: err.message }, 'auditoría de facturación: no se pudo leer la pausa (¿falta la migración 283?)');
    return null;
  }
}

/** ¿Este cobro ya estaba atrasado cuando se pausó? Ver arriba: se deja facturar. */
async function atrasadoAlPausar(paymentId, pausa, dias) {
  const { rows } = await query(
    `SELECT 1 FROM conversion_payments
      WHERE id = $1 AND fecha <= ($2::timestamptz)::date - $3::int`,
    [paymentId, pausa.pausada_at, dias]);
  return rows.length > 0;
}

export const MENSAJE_PAUSADA = 'La facturación está pausada: la auditoría ha encontrado un error en las facturas. '
  + 'Un administrador lo revisa y la reanuda con «Marcar como solucionado»; '
  + 'los cobros que entren mientras tanto se facturan en orden al reanudar.';

/**
 * Para la emisión si la facturación está pausada (423 FACTURACION_PAUSADA).
 * `paymentId`: el cobro que se va a facturar, si lo hay.
 */
export async function exigirFacturacionActiva({ paymentId = null, cfg = leerConfig() } = {}) {
  if (!cfg.activa) return;
  if (colaDeLaPausa.getStore()) return;
  const pausa = await pausaAbierta({ cfg });
  if (!pausa) return;
  if (paymentId && await atrasadoAlPausar(paymentId, pausa, cfg.dias)) return;
  throw new AppError(MENSAJE_PAUSADA, 423, 'FACTURACION_PAUSADA');
}
