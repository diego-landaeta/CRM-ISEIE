import { describe, it, expect, vi, beforeEach } from 'vitest';

// Una proforma que pasa a factura CONSERVA SU FECHA (Diego, 29/09).
//
// El numero se le dio el dia de la proforma. Si al cobrarla tomara la fecha del
// cobro, la 2026/0065 de ICTESS (proforma del 7/8, cobrada en septiembre)
// quedaria fechada detras de la 0066 a la 0085: numero menor, fecha posterior.

const consultas = [];
const PROFORMA = { id: 202, codigo: '2026/0065', numero: 65, tipo: 'proforma', estado: 'emitida', conversion_id: 499, fecha_emision: '2026-08-07' };

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    if (sql.includes('FROM conversions c') && sql.includes('LEFT JOIN leads l')) {
      return { rows: [{ id: 499, project_id: 4, importe_total: '395.67', importe_pagado: '395.67', iva_pct: '21', iva_exento: false, producto_catalogo: 'Curso' }] };
    }
    if (sql.includes('FROM conversion_payments cp')) return { rows: [{ fecha: '2026-09-29', metodo: 'transferencia' }] };
    if (sql.includes("tipo = 'proforma'") && sql.includes('ORDER BY id DESC')) return { rows: [PROFORMA] };
    if (sql.startsWith('UPDATE invoices SET') || sql.includes('UPDATE invoices SET\n')) {
      return { rows: [{ ...PROFORMA, tipo: 'normal', estado: params[1], fecha_pago: params[2] }] };
    }
    return { rows: [] };
  }),
}));

const { emitirFacturaDePago } = await import('../src/modules/invoices/invoices.model.js');

beforeEach(() => { consultas.length = 0; });

describe('proforma → factura', () => {
  it('no toca la fecha de emision; el cobro va a fecha_pago', async () => {
    const inv = await emitirFacturaDePago(499, { paymentId: 900, importe: 395.67 }, 11);
    const upd = consultas.find((c) => c.sql.includes("tipo = 'normal', estado = $2::text"));
    expect(upd).toBeTruthy();
    expect(upd.sql).not.toMatch(/fecha_emision\s*=/);
    expect(upd.params[2]).toBe('2026-09-29');
    expect(inv.id).toBe(202);
    expect(inv.estado).toBe('pagada');
  });

  it('solo convierte una proforma con numero, nunca una que espera aprobacion', async () => {
    await emitirFacturaDePago(499, { paymentId: 900, importe: 395.67 }, 11);
    const busca = consultas.find((c) => c.sql.includes("tipo = 'proforma'") && c.sql.includes('ORDER BY id DESC'));
    expect(busca.sql).toMatch(/numero IS NOT NULL/);
    expect(busca.sql).toMatch(/'borrador'/);
  });
});
