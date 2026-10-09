import { describe, it, expect, vi, beforeEach } from 'vitest';

// Paridad con MultiCRM (Diego, 09/10: «en MultiCRM sí puede gestionar y
// cambiar facturas, en el de ISEIE no»): marcar a mano que una factura ya se
// entregó. Es una MARCA, no un envío: no se manda nada, y una pagada sigue pagada.

const consultas = [];
vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => { consultas.push({ sql, params }); return { rows: [{ id: params[0], codigo: '2026/0860', estado: 'pagada', sent_at: 'x' }] }; }),
}));

const { marcarEntregada } = await import('../src/modules/invoices/invoices.model.js');

beforeEach(() => { consultas.length = 0; });

describe('marcar una factura como entregada', () => {
  it('apunta la fecha y solo pasa de «emitida» a «enviada»: una pagada sigue pagada', async () => {
    await marcarEntregada(860, { entregada: true, userId: 8 });
    const { sql, params } = consultas[0];
    expect(params).toEqual([860, true]);
    expect(sql).toMatch(/WHEN \$2 AND estado = 'emitida' THEN 'enviada'/);
    expect(sql).toMatch(/ELSE estado/);
  });
  it('desmarcarla devuelve «enviada» a «emitida» y borra la fecha', async () => {
    await marcarEntregada(860, { entregada: false });
    expect(consultas[0].params).toEqual([860, false]);
    expect(consultas[0].sql).toMatch(/WHEN NOT \$2 AND estado = 'enviada' THEN 'emitida'/);
  });
  it('la ruta existe', async () => {
    const fs = await import('node:fs');
    const rutas = fs.readFileSync(new URL('../src/modules/invoices/invoices.routes.js', import.meta.url), 'utf8');
    expect(rutas).toMatch(/router\.patch\('\/:id\/entregada',\s+ctrl\.marcarEntregada\)/);
  });
});
