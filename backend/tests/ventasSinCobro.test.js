import { describe, it, expect, vi, beforeEach } from 'vitest';

// #225 — Ventas de septiembre en ISEIE daban tres cifras: tarjetas 54 ·
// 37.050 €, «Cursos vendidos» 55 · 40.525,20 € y Claude 56 · 40.725,20 €.
//
// Diego, 10/10: «las ventas sin ningún cobro se enseñan aparte, como "ventas
// sin cobro (en proformas)"; cuando se cobran pasan a contar como venta».
//   · Las tarjetas siguen contando lo cobrado y llevan al lado las sin cobro:
//     cobradas + sin cobro = lo que dice Claude.
//   · «Cursos vendidos» usa la MISMA regla que las tarjetas y su total incluye
//     las ventas sin programa (la de 200 € que faltaba).

const consultas = [];
let filas = {};

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    if (/con_proforma/.test(sql)) return { rows: [filas.sinCobro] };
    if (/conversion_installments/.test(sql)) return { rows: [filas.cuotas] };
    if (/sin_cobro_ventas/.test(sql)) return { rows: [filas.totales] };
    if (/GROUP BY/.test(sql)) return { rows: filas.productos };
    return { rows: [filas.resumen] };
  }),
}));

const { getResumenVentas, getTopProducts } = await import('../src/modules/sales/sales.service.js');

beforeEach(() => {
  consultas.length = 0;
  filas = {
    resumen: {
      ventas: 54, clientes: 50, asesoras: 6, importe: '37050.00', cobrado: '26825.04',
      cobrado_matricula: '20000.00', cobrado_cuotas: '6825.04', ventas_con_cuotas: 3,
      pendiente: '10224.96', liquidadas: 40, con_saldo: 14, ticket_medio: '686.11',
    },
    cuotas: {
      ventas_con_plan: 3, cuotas: 9, cuotas_cobradas: 3, cuotas_pendientes: 6, cuotas_vencidas: 0,
      importe_pendiente: '900.00', importe_vencido: '0',
    },
    // #676 · 1.975 € y #675 · 1.700 €, las dos del 30/09 sin ningún cobro.
    sinCobro: { ventas: 2, importe: '3675.00', con_proforma: 1 },
    totales: {
      ventas: 54, facturado: '37050.00', cobrado: '26825.04',
      hueco_ventas: 1, hueco_facturado: '200.00', hueco_cobrado: '200.00',
      sin_cobro_ventas: 2, sin_cobro_importe: '3675.00',
    },
    productos: [
      { product_id: 1, producto: 'Máster A', ventas: 30, facturado: '25000.00', cobrado: '18000.00', ultima_venta: '2026-09-29' },
      { product_id: 2, producto: 'Curso B', ventas: 23, facturado: '11850.00', cobrado: '8625.04', ultima_venta: '2026-09-28' },
    ],
  };
});

describe('las tarjetas de Ventas y las ventas sin cobro', () => {
  it('las sin cobro van aparte y, sumadas a las tarjetas, dan lo de Claude', async () => {
    const r = await getResumenVentas({ projectId: 1, from: '2026-09-01', to: '2026-09-30' });
    expect(r.ventas).toBe(54);
    expect(r.importe).toBe(37050);
    expect(r.sin_cobro).toEqual({ ventas: 2, importe: 3675, con_proforma: 1 });
    expect(r.ventas + r.sin_cobro.ventas).toBe(56);
    expect(r.importe + r.sin_cobro.importe).toBe(40725);
  });

  it('las tarjetas: con algún cobro; las aparte: sin ninguno; las dos sin mensualidades', async () => {
    await getResumenVentas({ projectId: 1, from: '2026-09-01', to: '2026-09-30' });
    const tarjetas = consultas.find((c) => /AS clientes/.test(c.sql)).sql;
    const sinCobro = consultas.find((c) => /con_proforma/.test(c.sql));
    expect(tarjetas).toMatch(/AND EXISTS \(SELECT 1 FROM conversion_payments cpx WHERE cpx\.conversion_id = cv\.id\)/);
    expect(tarjetas).not.toMatch(/NOT EXISTS \(SELECT 1 FROM conversion_payments cpx/);
    expect(sinCobro.sql).toMatch(/NOT EXISTS \(SELECT 1 FROM conversion_payments cpx WHERE cpx\.conversion_id = cv\.id\)/);
    expect(sinCobro.sql).toMatch(/NOT cv\.es_mensualidad/);
    expect(tarjetas).toMatch(/NOT cv\.es_mensualidad/);
    // El mismo periodo y el mismo campus que las tarjetas.
    const deTarjetas = consultas.find((c) => /AS clientes/.test(c.sql)).params;
    expect(sinCobro.params.slice(0, deTarjetas.length)).toEqual(deTarjetas);
    // Cuántas tienen ya su proforma emitida (una anulada no cuenta).
    expect(sinCobro.sql).toMatch(/i\.tipo = 'proforma'/);
    expect(sinCobro.sql).toMatch(/i\.estado <> 'cancelada'/);
  });

  it('por gestora, las sin cobro también van con su parte del reparto', async () => {
    await getResumenVentas({ projectId: 1, from: '2026-09-01', to: '2026-09-30', responsableId: 7 });
    const sinCobro = consultas.find((c) => /con_proforma/.test(c.sql));
    // Una o varias (el equipo de una administradora, 09/11/2026): la suma de sus partes.
    expect(sinCobro.sql).toMatch(/r\.vendedora_id = ANY\(\$\d+::int\[\]\)/);
    expect(sinCobro.sql).toMatch(/SUM\(cv\.importe_total \* COALESCE\(\(SELECT SUM\(r\.peso\)/);
  });
});

describe('«Cursos vendidos» con la regla de las tarjetas', () => {
  it('el total lo da el servidor e incluye la venta sin programa', async () => {
    const r = await getTopProducts({ projectId: 1, from: '2026-09-01', to: '2026-09-30', limit: 100 });
    // Las filas suman 53; con la venta sin programa (200 €) son las 54 de las tarjetas.
    const filas = r.productos.reduce((s, p) => s + p.ventas, 0);
    expect(filas).toBe(53);
    expect(r.sinAsignar).toEqual({ ventas: 1, facturado: 200, cobrado: 200 });
    expect(r.totales).toEqual({ ventas: 54, facturado: 37050, cobrado: 26825.04 });
    expect(filas + r.sinAsignar.ventas).toBe(r.totales.ventas);
    expect(r.sinCobro).toEqual({ ventas: 2, importe: 3675 });
  });

  it('sin mensualidades, con algún cobro, y el cobrado de los apuntes', async () => {
    await getTopProducts({ projectId: 1, from: '2026-09-01', to: '2026-09-30', limit: 100 });
    const [totales, ranking] = consultas;
    expect(totales.sql).toMatch(/NOT c\.es_mensualidad/);
    expect(totales.sql).toMatch(/EXISTS \(SELECT 1 FROM conversion_payments cpx WHERE cpx\.conversion_id = c\.id\) AS con_cobro/);
    expect(ranking.sql).toMatch(/NOT c\.es_mensualidad/);
    expect(ranking.sql).toMatch(/AND EXISTS \(SELECT 1 FROM conversion_payments cpx WHERE cpx\.conversion_id = c\.id\)/);
    // No el `importe_pagado` declarado, que en ISEIE declara de más.
    expect(ranking.sql).not.toMatch(/importe_pagado/);
    expect(ranking.sql).toMatch(/FROM conversion_payments cp WHERE cp\.conversion_id = c\.id/);
    // Los totales van SIN el LIMIT; el ranking, con él al final.
    expect(totales.sql).not.toMatch(/LIMIT/);
    expect(ranking.params[ranking.params.length - 1]).toBe(100);
  });

  it('por gestora mira el reparto, igual que las tarjetas', async () => {
    await getTopProducts({ projectId: 1, from: '2026-09-01', to: '2026-09-30', responsableId: 7 });
    expect(consultas[0].sql).toMatch(/FROM conversion_reparto rx\s+WHERE rx\.conversion_id = c\.id AND rx\.vendedora_id = ANY\(\$2::int\[\]\)/);
    expect(consultas[0].sql).not.toMatch(/l\.responsable_id/);
  });
});
