import client from '@/shared/api/client';

/*
  «LINK DE PAGO USADO» (CRM-ISEIE#762, gemela de CRM#1107). La inicial ya se pagó con otro link o con
  Stripe: la gestora pega el link (https://buy.stripe.com/…) o el id del cobro
  (plink_, cs_, pi_, ch_). Al registrar la venta, el servidor lo busca en Stripe y
  une el cobro a su pago inicial; esto solo mira lo que encontraría, sin unir nada.
*/

export type EstadoDelCobro =
  | 'unido' | 'encontrado' | 'ya_unido' | 'en_otra_venta' | 'importe_distinto'
  | 'varios' | 'sin_pagar' | 'no_encontrado' | 'no_es_de_stripe' | 'error';

export interface CobroDeLaReferencia {
  estado: EstadoDelCobro;
  mensaje: string;
  cargo?: {
    id: number; stripe_id: string; importe: number; fecha: string; email: string | null;
    conversion_id: number | null; venta_cliente?: string | null;
  };
}

/** ¿Lo que pegó parece de Stripe? (un link de buy.stripe.com o un id plink_/cs_/pi_/ch_/py_) */
export function pareceDeStripe(texto: string): boolean {
  const t = texto.trim();
  return /(^|[^A-Za-z0-9])(plink|cs_(live|test)|pi|ch|py)_[A-Za-z0-9]{4,}/.test(t)
    || /^https?:\/\/([a-z0-9-]+\.)*stripe\.com\//i.test(t);
}

/**
 * Lo que se guarda cabe en 120 caracteres (`conversion_payments.referencia`). Un
 * link largo se queda en su id de Stripe o, si no lo lleva, sin lo de después de
 * «?» o «#» (el correo precargado, el fragmento de Checkout…).
 */
export function acortarReferencia(texto: string): string {
  if (texto.length <= 120) return texto;
  const id = texto.match(/(plink|cs_(live|test)|pi|ch|py)_[A-Za-z0-9]{4,}/);
  if (id) return id[0];
  return texto.replace(/[?#].*$/, '').slice(0, 120);
}

export function buscarCobro(projectId: number, referencia: string, importe?: number) {
  return client.get<CobroDeLaReferencia>('/links-pago/buscar-cobro', {
    params: { projectId, referencia: referencia.trim(), ...(importe && importe > 0 ? { importe } : {}) },
  });
}

/** Los que dejan el cobro unido (o a punto de unirse): el resto avisa. */
export const ES_BUENO: EstadoDelCobro[] = ['unido', 'encontrado', 'ya_unido'];
