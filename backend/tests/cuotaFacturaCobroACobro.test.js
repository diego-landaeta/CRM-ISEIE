import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
  Diego, 20/11/2026: una cuota cobrada por Stripe no salía en la cola de
  facturación. La venta de Laura (Psiko): la 0136 por los 950 € al entrar la
  inicial, la 0224 de la cuota 1, y la cuota 2 se daba por cubierta por la 0136.
  Si la venta ya se factura cobro a cobro, cada cobro lleva la suya.
*/
const consultas = [];
let respuestas = [];
vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => { consultas.push({ sql, params }); return respuestas.length ? respuestas.shift() : { rows: [] }; }),
  getClient: vi.fn(),
}));
const model = await import('../src/modules/invoices/invoices.model.js');

beforeEach(() => { consultas.length = 0; respuestas = []; });

describe('la cola: una factura por el total no tapa los cobros de una venta que se factura cobro a cobro', () => {
  it('la regla de «venta entera» solo cubre si ninguna cuota tiene su factura propia', async () => {
    await model.listPagosSinFactura(2);
    const sql = consultas[0].sql;
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM invoices pc\s+WHERE pc\.conversion_id = cp\.conversion_id[\s\S]*pc\.payment_id IS NOT NULL[\s\S]*pc\.total < \(SELECT v2\.importe_total/);
  });
});
