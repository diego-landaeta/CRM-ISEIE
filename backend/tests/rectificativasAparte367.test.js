import { describe, it, expect, vi, beforeEach } from 'vitest';

// #367 (gemela de diego-landaeta/CRM#534) · «Productos vendidos»: las rectificativas, aparte.
//
// Octubre de 2026 en el 360 (aquí pasaba igual): la tarjeta del Dashboard decía «Cuentoterapia −541,67 €»
// (venta 595: 108,33 € facturados menos la rectificativa R-2026/0002 de −650 €)
// y «Tarot Terapéutico (dolor emocional) 0,00 €» (venta 599: 140 € menos la
// R-2026/0003 de −140 €). Los abonos restaban dentro de su producto.
//
// La consulta devuelve ahora, por producto, lo facturado SIN abonos y los
// abonos en su columna. Aquí se simula lo que contesta Postgres.
//
// ANTES del arreglo `getFacturado` no devolvía `rectificativas` y cada
// producto llevaba su abono dentro: estas pruebas fallan.

let porGestora = [];
let porProducto = [];
const consultas = [];

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    if (/GROUP BY rep\.vendedora_id/.test(sql)) return { rows: porGestora };
    if (/JOIN conversions c ON c\.id = rep\.conversion_id/.test(sql)) return { rows: porProducto };
    return { rows: [] };
  }),
}));

const { getFacturado } = await import('../src/modules/sales/sales.service.js');

beforeEach(() => {
  consultas.length = 0;
  // Las gestoras, netas (con su abono dentro): su ranking no cambia.
  porGestora = [
    { user_id: 6, nombre: 'Ana', facturado: '-541.67', ventas: 2 },
    { user_id: 7, nombre: 'Dayana', facturado: '1500.00', ventas: 1 },
  ];
  // Lo que devuelve la consulta de productos con el arreglo: `facturado` sin
  // abonos, `rectificado` con ellos (negativo).
  porProducto = [
    { product_id: 20, producto: 'Máster en Psicología', sin_asignar: false, facturado: '1500.00', rectificado: '0', ventas_rectificadas: 0, ventas: 1 },
    { product_id: 21, producto: 'Cuentoterapia', sin_asignar: false, facturado: '108.33', rectificado: '-650.00', ventas_rectificadas: 1, ventas: 1 },
    { product_id: 22, producto: 'Tarot Terapéutico (dolor emocional)', sin_asignar: false, facturado: '140.00', rectificado: '-140.00', ventas_rectificadas: 1, ventas: 1 },
  ];
});

describe('las rectificativas, fuera de cada producto', () => {
  it('ningún producto sale en negativo ni a cero por un abono', async () => {
    const r = await getFacturado({ projectIds: [1], from: '2026-10-01', to: '2026-10-31' });
    const de = (n) => r.productos.find((p) => p.producto === n);
    expect(de('Cuentoterapia').facturado).toBe(108.33);
    expect(de('Tarot Terapéutico (dolor emocional)').facturado).toBe(140);
    expect(r.productos.every((p) => p.facturado > 0)).toBe(true);
  });

  it('los abonos van en su fila, con su detalle por producto', async () => {
    const r = await getFacturado({ projectIds: [1], from: '2026-10-01', to: '2026-10-31' });
    expect(r.rectificativas.facturado).toBe(-790);
    expect(r.rectificativas.ventas).toBe(2);
    expect(r.rectificativas.productos).toEqual([
      { product_id: 21, producto: 'Cuentoterapia', facturado: -650 },
      { product_id: 22, producto: 'Tarot Terapéutico (dolor emocional)', facturado: -140 },
    ]);
  });

  it('el total no cambia: productos + sin producto + rectificativas = total = gestoras', async () => {
    const r = await getFacturado({ projectIds: [1], from: '2026-10-01', to: '2026-10-31' });
    const suma = r.productos.reduce((s, p) => s + p.facturado, 0) + r.sin_producto.facturado + r.rectificativas.facturado;
    expect(Math.round(suma * 100) / 100).toBe(r.total.facturado);
    expect(r.total.facturado).toBe(958.33);
  });

  it('un producto que este mes solo tiene el abono no sale en la lista', async () => {
    porProducto = [
      { product_id: 21, producto: 'Cuentoterapia', sin_asignar: false, facturado: '0', rectificado: '-650.00', ventas_rectificadas: 1, ventas: 0 },
    ];
    porGestora = [{ user_id: 6, nombre: 'Ana', facturado: '-650.00', ventas: 0 }];
    const r = await getFacturado({ projectIds: [1], from: '2026-10-22', to: '2026-10-22' });
    expect(r.productos).toEqual([]);
    expect(r.rectificativas.facturado).toBe(-650);
  });

  it('la consulta separa los abonos (tipo «rectificativa») en la misma CTE', async () => {
    await getFacturado({ projectIds: [1], from: '2026-10-01', to: '2026-10-31' });
    const [g, p] = consultas.map((c) => c.sql);
    expect(g).toMatch(/FILTER \(WHERE i\.tipo = 'rectificativa'\), 0\) AS rectificado/);
    expect(p).toMatch(/SUM\(\(rep\.facturado - rep\.rectificado\) \* rep\.peso\)/);
    expect(p).toMatch(/SUM\(rep\.rectificado \* rep\.peso\)/);
  });
});
