import { describe, it, expect, vi, beforeEach } from 'vitest';

// #224 — El Dashboard cuenta lo FACTURADO (Diego, 10/10): «también en el
// bloque del equipo, porque hay ventas sin gestora que tienen que facturarse».
//
// Con CEDIA, 1–3 oct, el bloque del equipo decía 1.145 € · 4 ventas y
// «Productos vendidos · Mes» 3.195 € · 5 ventas. Ahora las dos cifras salen de
// `getFacturado`, de la MISMA consulta, y el bloque lleva la fila «Sin
// gestora»: gestoras + sin gestora = total = productos + sin producto.

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
const { IMPORTE_FACTURADO, FACTURA_QUE_CUENTA } = await import('../src/modules/reports/report.model.js');

beforeEach(() => {
  consultas.length = 0;
  // Lo que devuelve pg: NUMERIC como cadena.
  porGestora = [
    { user_id: 7, nombre: 'Dayana', facturado: '745.00', ventas: 2 },
    { user_id: 6, nombre: 'Ana', facturado: '400.00', ventas: 1.5 },
    // La venta compartida: media para cada una. Y la que no es de nadie.
    { user_id: null, nombre: null, facturado: '2050.00', ventas: 1.5 },
  ];
  porProducto = [
    { product_id: 10, producto: 'Máster en BMS', sin_asignar: false, facturado: '2250.00', ventas: 1 },
    { product_id: 11, producto: 'Curso de Redes', sin_asignar: false, facturado: '745.00', ventas: 3 },
    { product_id: null, producto: '— sin producto —', sin_asignar: true, facturado: '200.00', ventas: 1 },
  ];
});

describe('lo facturado del Dashboard', () => {
  it('el bloque del equipo suma el total: gestoras + «Sin gestora»', async () => {
    const r = await getFacturado({ projectIds: [1, 2, 3], from: '2026-10-01', to: '2026-10-03' });
    expect(r.total).toEqual({ facturado: 3195, ventas: 5 });
    expect(r.sin_gestora).toEqual({ facturado: 2050, ventas: 1.5 });
    expect(r.gestoras.map((g) => g.nombre)).toEqual(['Dayana', 'Ana']);
    const equipo = r.gestoras.reduce((s, g) => s + g.facturado, 0) + r.sin_gestora.facturado;
    const ventas = r.gestoras.reduce((s, g) => s + g.ventas, 0) + r.sin_gestora.ventas;
    expect(equipo).toBe(r.total.facturado);
    expect(ventas).toBe(r.total.ventas);
  });

  it('«Productos vendidos» da la misma cifra que el bloque del equipo', async () => {
    const r = await getFacturado({ projectIds: [1, 2, 3], from: '2026-10-01', to: '2026-10-03' });
    const productos = r.productos.reduce((s, p) => s + p.facturado, 0) + r.sin_producto.facturado;
    const ventas = r.productos.reduce((s, p) => s + p.ventas, 0) + r.sin_producto.ventas;
    expect(productos).toBe(r.total.facturado);
    expect(ventas).toBe(r.total.ventas);
    // Lo que no dice qué programa va aparte, pero DENTRO del total.
    expect(r.sin_producto).toEqual({ facturado: 200, ventas: 1 });
    expect(r.productos.map((p) => p.producto)).toEqual(['Máster en BMS', 'Curso de Redes']);
  });

  it('las dos agrupaciones salen de la misma CTE y con los mismos parámetros', async () => {
    await getFacturado({ projectIds: [1, 2, 3], from: '2026-10-01', to: '2026-10-03' });
    expect(consultas).toHaveLength(2);
    const cte = (sql) => sql.slice(0, sql.indexOf(')\n', sql.indexOf('rep AS')));
    expect(cte(consultas[0].sql)).toBe(cte(consultas[1].sql));
    expect(consultas[0].params).toEqual([[1, 2, 3], '2026-10-01', '2026-10-03']);
    expect(consultas[1].params).toEqual(consultas[0].params);
  });

  it('usa la definición de facturado de los informes, no una nueva', async () => {
    await getFacturado({ projectId: 4, from: '2026-10-01', to: '2026-10-31' });
    const { sql } = consultas[0];
    expect(IMPORTE_FACTURADO).toBe('i.total');
    expect(sql).toContain(`SUM(${IMPORTE_FACTURADO})`);
    expect(sql).toContain(FACTURA_QUE_CUENTA);
    // Por fecha de emisión, solo facturas que cuelgan de una venta, y
    // repartidas como la venta.
    expect(sql).toMatch(/i\.fecha_emision >= \$2::date/);
    expect(sql).toMatch(/JOIN conversions c ON c\.id = i\.conversion_id/);
    expect(sql).toMatch(/JOIN conversion_reparto r ON r\.conversion_id = f\.conversion_id/);
    // Un JOIN a user_projects multiplicaría las sumas.
    expect(sql).not.toMatch(/user_projects/);
  });

  it('sin campus elegido deja fuera los proyectos de pruebas', async () => {
    await getFacturado({});
    expect(consultas[0].sql).toMatch(/c\.project_id NOT IN \(SELECT id FROM projects WHERE es_prueba\)/);
    expect(consultas[0].params).toEqual([]);
  });

  it('una gestora: solo su parte del reparto', async () => {
    porGestora = [{ user_id: 7, nombre: 'Dayana', facturado: '372.50', ventas: 0.5 }];
    porProducto = [{ product_id: 11, producto: 'Curso de Redes', sin_asignar: false, facturado: '372.50', ventas: 0.5 }];
    const r = await getFacturado({ projectIds: [1], from: '2026-10-01', to: '2026-10-31', responsableId: 7 });
    // Una persona o una lista (el equipo de una administradora, 09/11/2026).
    expect(consultas[0].sql).toMatch(/WHERE r\.vendedora_id = ANY\(\$4::int\[\]\)/);
    expect(consultas[0].params[3]).toEqual([7]);
    expect(r.sin_gestora).toEqual({ facturado: 0, ventas: 0 });
    expect(r.total).toEqual({ facturado: 372.5, ventas: 0.5 });
  });
});
