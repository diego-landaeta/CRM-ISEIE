import { posibleDuplicada, preguntarSiEmitirDuplicada, type OtraFactura } from './posibleDuplicada';

/**
 * «Esta factura pasa de lo cobrado» (06/10).
 *
 * El servidor no deja emitir la factura de una venta por más de lo cobrado y
 * aún sin facturar, y dice cuánto queda. La 87 de ICTESS salió por los 333 € de
 * un curso a plazos cuando la cuota era de 111; la 0188 de CEDIA, con el IVA
 * sumado encima de lo que se había cobrado.
 *
 * No es un muro: una empresa que paga a 30 días recibe la factura antes de
 * pagar. Así que se enseña el motivo tal cual lo manda el servidor y, si quien
 * factura lo confirma, se vuelve a mandar con permiso.
 */

/** El motivo, si el error es este; si es otro, null. */
export function pasaDeLoCobrado(x: unknown): string | null {
  const e = (x || {}) as { data?: { code?: string; error?: string }; code?: string; error?: string; message?: string };
  if ((e.data?.code || e.code) !== 'MAS_QUE_LO_COBRADO') return null;
  return e.data?.error || e.error || e.message || 'Esta factura pasa de lo cobrado de la venta.';
}

/**
 * Manda la factura. Si el servidor avisa de que pasa de lo cobrado, lo pregunta
 * y, con un sí, la manda otra vez con `permitir = true`. Con un no, el error
 * sigue su camino y quien llama lo enseña como cualquier otro.
 *
 * Y lo mismo con la posible duplicada (CRM#819): si ya hay una factura del
 * mismo cliente por el mismo importe esa semana, sale el diálogo «¿Emitir otra
 * igualmente?» y, con un sí, se manda con `confirmarDuplicada = true`. Los dos
 * avisos pueden salir seguidos: lo ya confirmado no se vuelve a preguntar.
 */
export async function emitirPreguntandoSiPasa<T>(
  enviar: (permitir: boolean, confirmarDuplicada: boolean) => Promise<T>,
  {
    preguntar = (motivo: string) => window.confirm(`${motivo}\n\n¿Emitirla igualmente?`),
    preguntarDuplicada = preguntarSiEmitirDuplicada,
  }: {
    preguntar?: (motivo: string) => boolean;
    preguntarDuplicada?: (otra: OtraFactura) => Promise<boolean>;
  } = {},
): Promise<T> {
  let permitir = false;
  let confirmarDuplicada = false;
  // Como mucho, un intento por aviso y el último.
  for (let intento = 0; ; intento += 1) {
    let respuesta: T | undefined;
    let error: unknown = null;
    try {
      respuesta = await enviar(permitir, confirmarDuplicada);
    } catch (e) {
      error = e;
    }
    // Por si la respuesta llega como `{ success: false }` en vez de como error.
    const lo = error ?? respuesta;
    if (intento < 2) {
      const motivo = permitir ? null : pasaDeLoCobrado(lo);
      if (motivo) {
        if (preguntar(motivo)) { permitir = true; continue; }
      } else {
        const otra = confirmarDuplicada ? null : posibleDuplicada(lo);
        if (otra && await preguntarDuplicada(otra)) { confirmarDuplicada = true; continue; }
      }
    }
    if (error) throw error;
    return respuesta as T;
  }
}
