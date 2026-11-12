import { describe, it, expect, vi, beforeEach } from 'vitest';

// La tabla «Equipo de ventas» y «Mi meta», por lo COBRADO (Diego, 12/11/2026:
// «los montos de los rankings de todas las vistas son del monto cobrado»).
//
// Una gestora (cifras inventadas): la tabla le ponía 1.000 € en «Facturado»
// (lo vendido: sus tres ventas del mes) y 800 € en «Cobrado» (lo pagado de esas
// tres). Había cobrado 2.000 €: faltaban las cuotas de ventas de otros meses.

let stats = [];
let metas = [];
const consultas = [];

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: /FROM sales_goals/.test(sql) ? metas : stats };
  }),
}));

const { getGestoresStats, getMyStats } = await import('../src/modules/sales/sales.goals.js');

const fila = (user_id, nombre, { ventas = 0, vendido = 0, cobrado = 0, recibe = true } = {}) => ({
  user_id, nombre, email: `${user_id}@x`, role: 'gestor', is_available: true, recibe_leads: recibe,
  ventas, compartidas: 0, vendido, cobrado,
});

beforeEach(() => { stats = []; metas = []; consultas.length = 0; });

describe('la consulta', () => {
  it('lo cobrado sale de los cobros, por la fecha del cobro y con el reparto', async () => {
    await getGestoresStats({ projectIds: [1], periodo: '2026-11' });
    const { sql, params } = consultas[0];
    expect(sql).toMatch(/FROM conversion_payments cp/);
    expect(sql).toMatch(/SUM\(cp\.importe \* rc\.peso\)/);
    expect(sql).toMatch(/TO_CHAR\(cp\.fecha, 'YYYY-MM'\) = \$\d+/);
    expect(sql).toMatch(/rc\.project_id = ANY\(\$1::int\[\]\)/);
    // Ya no es lo pagado de las ventas del mes.
    expect(sql).not.toMatch(/importe_pagado/);
    expect(params).toEqual([[1], '2026-11', '2026-11']);
  });

  it('con fechas, los cobros entre esas fechas', async () => {
    await getGestoresStats({ projectIds: [1], from: '2026-11-01', to: '2026-11-12' });
    const { sql, params } = consultas[0];
    expect(sql).toMatch(/cp\.fecha >= \$\d+ AND cp\.fecha <= \$\d+/);
    expect(params).toEqual([[1], '2026-11-01', '2026-11-12', '2026-11-01', '2026-11-12']);
  });

  it('ordena por lo cobrado', async () => {
    await getGestoresStats({ projectIds: [1], periodo: '2026-11' });
    expect(consultas[0].sql).toMatch(/ORDER BY cobrado DESC, ventas DESC/);
  });

  it('lo que antes se llamaba «facturado» sale como lo que es: vendido', async () => {
    await getGestoresStats({ projectIds: [1], periodo: '2026-11' });
    expect(consultas[0].sql).toMatch(/SUM\(c\.importe_total \* c\.peso\), 0\)::numeric AS vendido/);
  });
});

describe('lo que devuelve', () => {
  it('cobrado 2.000 y vendido 1.000, y la meta se mide contra lo cobrado', async () => {
    stats = [fila(2, 'Gestora A', { ventas: 3, vendido: 1000, cobrado: 2000 })];
    metas = [{ user_id: 2, meta_ventas: 6, meta_facturacion: 4000 }];
    const r = await getGestoresStats({ projectIds: [1], periodo: '2026-11' });
    const f = r.gestores[0];
    expect(f.cobrado).toBe(2000);
    expect(f.vendido).toBe(1000);
    expect(f).not.toHaveProperty('facturado');
    expect(f.progreso_facturacion_pct).toBe(50);
  });

  it('quien ya no recibe leads pero cobró una cuota en el periodo, sigue saliendo', async () => {
    stats = [fila(7, 'Gestora B', { cobrado: 300, recibe: false }), fila(8, 'Nadie', { recibe: false })];
    const r = await getGestoresStats({ projectIds: [1], periodo: '2026-11' });
    expect(r.gestores.map((g) => g.nombre)).toEqual(['Gestora B']);
  });

  it('«Mi meta» sin datos sale a cero con lo vendido y lo cobrado', async () => {
    const r = await getMyStats(99, { projectId: 1, periodo: '2026-11' });
    expect(r).toMatchObject({ ventas: 0, vendido: 0, cobrado: 0 });
  });
});
