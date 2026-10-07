/*
  Las fechas de los pasos del proceso, en la ficha del prospecto.

  Rescatado de la PR #150 de Fabián (16/09), que no se fusionó entera: la ficha
  cambió mucho desde entonces, pero estas dos cosas siguen haciendo falta.
*/

/**
 * Una fecha del servidor («2026-09-16» o «2026-09-16T00:00:00.000Z») como día
 * del calendario, en hora local.
 *
 * `new Date('2026-09-16')` es medianoche UTC: en España da el 16, pero al oeste
 * de Greenwich —donde trabaja parte del equipo— retrocede al 15. La ficha decía
 * «le toca el 15» de un paso del 16, y la cola del día, que ya lo hacía bien,
 * decía el 16.
 */
export function diaLocal(fecha: string): Date {
  const [anio, mes, dia] = String(fecha).slice(0, 10).split('-').map(Number);
  return new Date(anio, (mes || 1) - 1, dia || 1);
}

/** «16 sept»: para la lista de pasos. */
export function fechaCorta(fecha: string): string {
  return diaLocal(fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

/**
 * A qué fecha se aplaza un paso, en el formato del servidor (AAAA-MM-DD).
 *
 * Se cuenta desde HOY y no desde la fecha que tenía: quien aplaza dice «con esta
 * persona, dentro de tres días», no «tres días después de una fecha que ya
 * pasó». Un paso con cinco días de atraso aplazado «a mañana» cae mañana.
 *
 * Con los campos locales y no con `toISOString()`, que pasa por UTC: a las
 * 23:00 en España devolvería el día anterior.
 */
export function fechaAplazada(dias: number, hoy: Date = new Date()): string {
  const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Las tres opciones de aplazar, como las propuso Fabián. */
export const APLAZAMIENTOS = [
  { dias: 1, texto: 'Mañana' },
  { dias: 3, texto: 'En 3 días' },
  { dias: 7, texto: 'En una semana' },
] as const;
