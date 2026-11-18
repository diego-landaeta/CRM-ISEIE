/*
  Fechas: cuántos días faltan para algo y si corre prisa.

  Traído de MultiCRM (`shared/lib/fechas.ts`) para «Siguientes acciones» del
  resumen de Prospectos. Allí este fichero junta además `formatFecha` y
  `formatRelative`; en ISEIE esos dos ya viven en `modules/leads/lib/
  leadFormat.ts`, así que aquí no se repiten: dos copias de lo mismo acaban
  diciendo cosas distintas. Solo viene lo que no había.

  EL PORQUÉ DEL TROCEADO DE TEXTO
  --------------------------------
  El servidor devuelve las columnas DATE en crudo, sin hora: a la pantalla llega
  la cadena «2026-08-25».

  `new Date('2026-08-25')` la interpreta en UTC. En España eso son las 02:00 del
  25 en verano, que está bien, pero cualquier resta contra «ahora» se hace desde
  un instante que no es la medianoche local, y al oeste de Greenwich el día ya
  es el anterior.

  Partiendo la cadena y construyendo `new Date(año, mes, día)` no hay zona
  horaria de por medio. Una marca de tiempo completa (con «T» y hora) sí lleva
  su instante, y esa se lee tal cual.
*/

/** Una fecha sin hora, leída en el día local que dice el texto. */
export function soloFecha(iso?: string | null): Date | null {
  if (!iso) return null;
  const m = typeof iso === 'string' ? iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Medianoche de hoy, para comparar días completos sin que estorbe la hora. */
function hoyALas0(): number {
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth(), h.getDate()).getTime();
}

/** Cuántos días enteros hay de hoy a esa fecha. Negativo si ya pasó. */
export function diasHasta(iso?: string | null): number | null {
  const f = soloFecha(iso);
  if (!f) return null;
  const suyo = new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime();
  return Math.round((suyo - hoyALas0()) / 86400000);
}

/**
 * Cuándo vence, diciendo además si corre prisa. Lo usan las listas de cosas
 * que vencen —los seguimientos de prospectos—, donde el color depende de si ya
 * se pasó la fecha.
 */
export function cuandoVence(iso?: string | null): { texto: string; urgente: boolean } {
  const dias = diasHasta(iso);
  if (dias === null) return { texto: 'sin fecha', urgente: false };
  if (dias < 0) return { texto: `vencido hace ${Math.abs(dias)}d`, urgente: true };
  if (dias === 0) return { texto: 'hoy', urgente: true };
  if (dias === 1) return { texto: 'mañana', urgente: false };
  return { texto: `en ${dias}d`, urgente: false };
}

/**
 * «vie, 16 oct»: el día de un recordatorio, que es un DATE —sin hora ni zona—.
 *
 * Diego, 15/10 (gestoras de ISEIE): «los pongo con fecha de mañana y todos me
 * los pone con fecha de hoy». En la base estaban bien; la ficha los pintaba con
 * `new Date('2026-10-16')`, que es medianoche UTC: en Caracas o Bogotá, el 15 a
 * las 20:00.
 */
export function formatDia(iso?: string | null): string {
  const d = soloFecha(iso);
  return d ? d.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' }) : '--';
}

/**
 * Si un día (DATE) ya pasó: antes de hoy. Hoy todavía no está vencido, como en
 * el servidor (`fecha_recordatorio < CURRENT_DATE`). Antes se comparaba con
 * `new Date()`, y un recordatorio de mañana salía en rojo desde las 20:00 de hoy
 * en Latinoamérica.
 */
export function yaPaso(iso?: string | null): boolean {
  if (!iso) return false;
  // Solo el día («2026-10-16», lo que manda el servidor): por días enteros.
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) {
    const n = diasHasta(iso);
    return n !== null && n < 0;
  }
  // Con hora: el momento exacto, como antes.
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

/*
  EL DÍA DE UNA VENTA ES EL DE MADRID (#693).

  `fecha_conversion` es un DATE. Para saber qué día poner por defecto en una
  venta nueva se usaba `new Date().toISOString().slice(0, 10)`, que es el día en
  UTC: de 00:00 a 02:00 de Madrid (01:00 en invierno) aún decía «ayer», estuviera
  donde estuviera quien la registraba. El criterio del CRM es la hora de Madrid,
  la misma que usa el servidor (`APP_TIMEZONE`, por defecto Europe/Madrid): una
  gestora de Bogotá que registra a las 19:30 de allí ve ya el día siguiente,
  porque en Madrid ya lo es.
*/
export const ZONA_DEL_CRM = 'Europe/Madrid';

/** «2026-10-12»: el día que es en Madrid en ese instante (por defecto, ahora). */
export function hoyEnMadrid(ahora: Date = new Date()): string {
  // 'sv-SE' escribe la fecha como AAAA-MM-DD, que es lo que espera un DATE.
  return ahora.toLocaleDateString('sv-SE', { timeZone: ZONA_DEL_CRM });
}

/**
 * Suma meses a un día «AAAA-MM-DD» sin pasar por la zona del navegador.
 * `new Date('2026-03-01')` es medianoche UTC; con `setMonth` (hora local) y
 * vuelta a `toISOString`, en Latinoamérica la cuota del 1 de abril salía el 29
 * de marzo. Todo en UTC, el día no se mueve.
 */
export function sumarMeses(iso: string, meses: number): string {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
}
