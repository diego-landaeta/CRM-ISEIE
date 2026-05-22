// Formatters compartidos. Antes había ~16 copias de formatCurrency,
// ~5 de formatNumber y ~18 de formatDate desperdigadas por el código.
// Centralizar aquí evita drift de formato entre páginas.

const LOCALE = 'es-ES';

const eurFormatter = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' });
const eurNoDecFormatter = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const numberFormatter = new Intl.NumberFormat(LOCALE);

/**
 * Importe en EUR con dos decimales: "1.234,56 €"
 * @param {number|string|null|undefined} n
 */
export function formatCurrency(n) {
  return eurFormatter.format(Number(n || 0));
}

/**
 * Importe en EUR sin decimales: "1.234 €" (KPIs grandes, dashboards).
 * @param {number|string|null|undefined} n
 */
export function formatCurrencyShort(n) {
  return eurNoDecFormatter.format(Number(n || 0));
}

/**
 * Número entero con separadores: "1.234".
 * @param {number|string|null|undefined} n
 */
export function formatNumber(n) {
  return numberFormatter.format(Number(n || 0));
}

/**
 * Fecha corta es-ES: "15 mar." (sin año).
 * @param {string|Date|null|undefined} d
 */
// Parsea strings 'YYYY-MM-DD' como fecha LOCAL (no UTC) para evitar el bug
// clasico de "21 nov" -> "20 nov" en zonas con offset negativo.
// Para timestamps con hora ('YYYY-MM-DDTHH...'), usa new Date normal.
function toLocalDate(d) {
  if (!d) return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d;
  if (typeof d === 'string') {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateShort(d) {
  const date = toLocalDate(d);
  if (!date) return '--';
  return date.toLocaleDateString(LOCALE, { day: '2-digit', month: 'short' });
}

/**
 * Fecha media es-ES: "15 mar. 2024" — la variante más usada en el CRM.
 * @param {string|Date|null|undefined} d
 */
export function formatDate(d) {
  const date = toLocalDate(d);
  if (!date) return '--';
  return date.toLocaleDateString(LOCALE, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Fecha numérica completa: "15/03/2024".
 * @param {string|Date|null|undefined} d
 */
export function formatDateNumeric(d) {
  const date = toLocalDate(d);
  if (!date) return '--';
  return date.toLocaleDateString(LOCALE);
}

/**
 * Fecha + hora: "15 mar. 2024, 14:30".
 * @param {string|Date|null|undefined} d
 */
export function formatDateTime(d) {
  // Para timestamps con hora, usamos new Date normal (la hora SI tiene info de TZ).
  if (!d) return '--';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString(LOCALE, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
