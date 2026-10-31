// La moneda de las facturas de colaboradores (247, 31/10). Andrea factura a
// CEDIA en dólares y salía «356,03 €». No se convierte: cada moneda se suma
// por su lado.

export const SIMBOLO = { EUR: '€', USD: 'US$' };

/** «1.113,00 €» o «356,03 US$». `useGrouping: 'always'`: el punto de miles también con cuatro cifras. */
export const conMoneda = (n, moneda = 'EUR') =>
  `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} ${SIMBOLO[moneda] || SIMBOLO.EUR}`;

const redondo = (n) => Math.round(n * 100) / 100;

/**
 * Las sumas de unas filas, cada moneda por su lado y los euros primero:
 * `porMoneda(filas, { recibido: (f) => f.importe })` → [{ moneda: 'EUR', recibido: 600 }, { moneda: 'USD', recibido: 356.03 }].
 * Una moneda solo sale si alguna fila la lleva.
 */
export function porMoneda(filas, valores) {
  const sumas = new Map();
  for (const f of filas) {
    const m = f.moneda || 'EUR';
    if (!sumas.has(m)) sumas.set(m, Object.fromEntries(Object.keys(valores).map((k) => [k, 0])));
    const s = sumas.get(m);
    for (const [k, valor] of Object.entries(valores)) {
      const v = valor(f);
      if (v !== null && v !== undefined) s[k] += Number(v);
    }
  }
  return [...sumas.entries()]
    .sort(([a], [b]) => (a === 'EUR' ? -1 : b === 'EUR' ? 1 : a.localeCompare(b)))
    .map(([moneda, s]) => ({ moneda, ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, redondo(v)])) }));
}
