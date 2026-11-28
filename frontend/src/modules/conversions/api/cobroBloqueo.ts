/*
  ¿Se puede borrar este cobro? (CRM-ISEIE#856 + CRM-ISEIE#858, gemelas CRM#1228 + #1230)

  La regla vive en el servidor (backend/src/modules/conversions/cobro-facturado.js)
  y es la misma para «Eliminar pago» y «Deshacer el pago». Cada pago y cada
  cuota cobrada llegan con `cobro_bloqueo`: el MISMO texto que daría el 409, o
  null si se puede. La pantalla no decide por su cuenta: lo enseña antes de
  pulsar, y si la situación cambió con la pantalla abierta, el 409 dice lo mismo.
*/

/** Los campos del bloqueo que traen un pago o una cuota cobrada. */
export interface CamposBloqueoCobro {
  factura_codigo?: string | null;
  /** La factura está anulada (CRM#793). */
  factura_anulada?: boolean;
  /** Todas sus facturas están anuladas y a cero: el cobro ya se puede borrar. */
  factura_anulada_a_cero?: boolean;
  /** Por qué no se puede borrar, con el texto del 409; null si se puede. */
  cobro_bloqueo?: string | null;
}

/**
 * El aviso de «no se puede» sale una vez aunque se pulse varias seguidas: un
 * doble clic en «Deshacer» apilaba tres avisos iguales. Mientras el aviso de
 * esa misma clave sigue en pantalla (lo que dura un toast), no se repite.
 * Devuelve true si hay que enseñarlo.
 */
export const DURACION_AVISO_MS = 4000;
export function avisoNuevo(vistos: Map<string, number>, clave: string, ahora = Date.now()): boolean {
  const hasta = vistos.get(clave);
  if (hasta && hasta > ahora) return false;
  vistos.set(clave, ahora + DURACION_AVISO_MS);
  return true;
}

/** Los códigos con que el servidor dice que ese cobro no se borra. */
export const COBRO_NO_SE_BORRA = ['PAYMENT_HAS_INVOICE', 'PAYMENT_HAS_PAID_COMMISSION'];

/**
 * El motivo para no borrar, o null. Si la respuesta no trae el campo (un
 * servidor sin actualizar), se cae al criterio de antes: con factura y sin
 * estar anulada a cero, no.
 */
export function motivoParaNoBorrar(src: CamposBloqueoCobro): string | null {
  if (src.cobro_bloqueo !== undefined) return src.cobro_bloqueo || null;
  if (src.factura_codigo && !src.factura_anulada_a_cero) {
    return `Ese cobro tiene la factura ${src.factura_codigo}. Anúlala antes de borrar el cobro.`;
  }
  return null;
}
