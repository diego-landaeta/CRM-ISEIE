import { describe, it, expect, vi, beforeEach } from 'vitest';

// #233 (Manuel, 03/10: «poner una fecha y que no agarre»). En Facturación, con
// septiembre puesto, la lista se filtraba pero las tarjetas de arriba y «Ventas sin
// factura» seguían con el acumulado de siempre: el servidor no recibía las fechas
// y, aunque las recibiera, no las aplicaba.

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async () => ({ rows: [{}], rowCount: 1 })),
}));

const { query } = await import('../src/shared/config/db.js');
const model = await import('../src/modules/invoices/invoices.model.js');

beforeEach(() => vi.clearAllMocks());

describe('tarjetas de Facturación con periodo', () => {
  it('getStats aplica desde, hasta y estado', async () => {
    await model.getStats({ projectId: 4, from: '2026-09-01', to: '2026-09-30', estado: 'pagada' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/fecha_emision >= \$2/);
    expect(sql).toMatch(/fecha_emision <= \$3/);
    expect(sql).toMatch(/estado = \$4/);
    expect(params).toEqual([4, '2026-09-01', '2026-09-30', 'pagada']);
  });

  it('sin periodo, el acumulado de siempre', async () => {
    await model.getStats({ projectId: 4 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toMatch(/fecha_emision/);
    expect(params).toEqual([4]);
  });

  it('«Ventas sin factura» se recorta por la fecha de la venta', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await model.listVentasSinFactura({ projectId: 4, from: '2026-09-01', to: '2026-09-30' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/c\.fecha_conversion::date >= \$2::date/);
    expect(params).toEqual([[4], '2026-09-01', '2026-09-30']);
  });
});
