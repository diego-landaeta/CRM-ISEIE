import { describe, it, expect } from 'vitest';

/**
 * CRM-ISEIE#348 (gemela de CRM#613): el botón «Ver en el CRM» del comprobante tiene que llevar a ESA factura (el
 * Historial filtrado por su colaborador y su mes, como el buscador), no a la lista entera.
 * Con varias facturas juntas, a la lista de las enviadas.
 *
 *   npx vitest run tests/voucherEnlaceFactura348.test.js
 */
process.env.LOG_LEVEL = 'silent';
const { armarLlegadas, urlDeLaFactura } = await import('../src/modules/facturas-colaborador/avisos.emails.js');

const empresa = { id: 1, razon_social: 'Empresa de Prueba SL', email: 'facturacion@example.com' };
const factura = (id, extra = {}) => ({
  id, colaborador_id: 7, colaborador_nombre: 'Colaborador de prueba', periodo: '2026-10-01',
  importe: 100, moneda: 'EUR', numero_factura: `F-${id}`, numero_recepcion: `REC-${id}`,
  subida_at: '2026-11-04T08:42:00Z', ...extra,
});
// El botón va con el & escapado en el HTML.
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

describe('voucher de la factura del colaborador: el botón lleva a la factura (#348)', () => {
  it('con una factura, el botón abre el Historial con su colaborador y su mes', () => {
    const { htmlContent } = armarLlegadas({ empresa, facturas: [factura(1)] });
    expect(hrefs(htmlContent).some((h) => h.includes('vista=historial&colaborador=7&periodo=2026-10'))).toBe(true);
  });

  it('con varias, a la lista de las enviadas', () => {
    const { htmlContent } = armarLlegadas({ empresa, facturas: [factura(1), factura(2, { colaborador_id: 8 })] });
    expect(hrefs(htmlContent).some((h) => h.includes('vista=enviadas'))).toBe(true);
    expect(hrefs(htmlContent).some((h) => h.includes('colaborador='))).toBe(false);
  });

  it('sin colaborador conocido, a la lista (nunca un enlace roto)', () => {
    expect(urlDeLaFactura({ periodo: '2026-10-01' })).toMatch(/vista=enviadas$/);
  });
});
