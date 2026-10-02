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
