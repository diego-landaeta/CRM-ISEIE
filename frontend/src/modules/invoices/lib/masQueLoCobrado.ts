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
 */
export async function emitirPreguntandoSiPasa<T>(enviar: (permitir: boolean) => Promise<T>): Promise<T> {
  const preguntar = (motivo: string) => window.confirm(`${motivo}\n\n¿Emitirla igualmente?`);
  let primera: T;
  try {
    primera = await enviar(false);
  } catch (e) {
    const motivo = pasaDeLoCobrado(e);
    if (motivo && preguntar(motivo)) return enviar(true);
    throw e;
  }
  // Por si la respuesta llega como `{ success: false }` en vez de como error.
  const motivo = pasaDeLoCobrado(primera);
  if (motivo && preguntar(motivo)) return enviar(true);
  return primera;
}
