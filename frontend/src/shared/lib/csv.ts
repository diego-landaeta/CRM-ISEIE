/**
 * Una celda de CSV, entre comillas y a salvo de fórmulas.
 *
 * Lo que va en un CSV a veces lo escribió alguien de fuera: la encuesta de
 * feedback es pública. Un comentario como `=HYPERLINK("http://…")` se abría en
 * Excel como fórmula (#593). Si un TEXTO empieza por `=`, `+`, `-`, `@`, un
 * tabulador o un retorno, se le antepone un apóstrofo: Excel lo enseña como
 * texto y no lo ejecuta. Los números —también los negativos, «-12.50» o
 * «-3 %»— se dejan como están.
 */
const PELIGRO = /^[=+\-@\t\r]/;
const NUMERO = /^-?\d+([.,]\d+)?\s*%?$/;

export function celdaCsv(v: unknown): string {
  let s = String(v ?? '');
  if (typeof v === 'string' && PELIGRO.test(s) && !NUMERO.test(s.trim())) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Una fila: las celdas separadas por comas. */
export const filaCsv = (fila: unknown[]) => fila.map(celdaCsv).join(',');

/** «2026-11-02», en hora de Madrid: una respuesta a las 00:30 es de ese día, no del anterior. */
export function diaDeMadrid(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(d);
}

/** Para el nombre del fichero: el rango, o «desde-siempre» si no hay fechas. */
export function rangoEnNombre(desde?: string | null, hasta?: string | null): string {
  if (!desde && !hasta) return 'desde-siempre';
  return `${desde || 'inicio'}_${hasta || 'hoy'}`;
}
