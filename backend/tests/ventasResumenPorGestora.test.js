import { describe, it, expect, vi, beforeEach } from 'vitest';

// QA de producción, 22/10/2026: un admin filtra Ventas por gestora y
// `GET /api/ventas/resumen?responsableId=…` da 500. Postgres: «bind message
// supplies 5 parameters, but prepared statement requires 4». En ISEIE, 13
// veces ese día.
//
// Causa: `pesoDe()` metía el id de la gestora en la lista de parámetros del
// filtro, y la consulta de las cuotas —que no usa ese `$n`— reutilizaba la
// misma lista. Postgres no ignora un parámetro de más: rechaza la consulta.
//
// Esta prueba no necesita base: el doble de `query` hace la MISMA comprobación
// que Postgres —que cada parámetro enviado se use y que no se use ninguno que
// no se envía— y falla igual que fallaba en producción.

const consultas = [];

function comoPostgres(sql, params = []) {
  const usados = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  const requiere = usados.size ? Math.max(...usados) : 0;
  if (params.length !== requiere) {
    throw new Error(`bind message supplies ${params.length} parameters, but prepared statement requires ${requiere}`);
  }
  for (let i = 1; i <= requiere; i++) {
    if (!usados.has(i)) throw new Error(`could not determine data type of parameter $${i}`);
  }
}

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => {
    comoPostgres(sql, params);
    consultas.push({ sql, params: [...(params || [])] });
    if (/COUNT\(DISTINCT v\.lead_id\)::int AS total/.test(sql)) return { rows: [{ total: 0 }] };
    return { rows: [{}] };
  }),
}));

const {
  getResumenVentas, getVentasPorCliente, getVentasPorAsesora, getTopProducts,
} = await import('../src/modules/sales/sales.service.js');

beforeEach(() => { consultas.length = 0; });

const TODOS = { projectId: 1, from: '2026-10-01', to: '2026-10-31', search: '  Bárbara ' };

describe('Ventas filtradas por gestora (500 del 22/10/2026)', () => {
  it('el resumen con gestora ya no da 500', async () => {
    await expect(getResumenVentas({ responsableId: '14' })).resolves.toBeDefined();
  });

  it('el resumen con gestora y todos los demás filtros a la vez', async () => {
    await expect(getResumenVentas({ ...TODOS, responsableId: '14' })).resolves.toBeDefined();
  });

  it('el resumen sin gestora sigue igual', async () => {
    await expect(getResumenVentas(TODOS)).resolves.toBeDefined();
    await expect(getResumenVentas({})).resolves.toBeDefined();
  });

  it('las cuotas llevan los parámetros del filtro, y las tarjetas además la gestora', async () => {
    await getResumenVentas({ ...TODOS, responsableId: '14' });
    const tarjetas = consultas.find((c) => /AS clientes/.test(c.sql));
    const cuotas = consultas.find((c) => /conversion_installments/.test(c.sql));
    const sinCobro = consultas.find((c) => /con_proforma/.test(c.sql));
    // Filtro: campus, desde, hasta, gestora (reparto) y búsqueda.
    expect(cuotas.params.slice(1)).toEqual(['2026-10-01', '2026-10-31', '14', '%Bárbara%']);
    // Las tarjetas, lo mismo y al final la gestora otra vez, para su parte (PESO).
    expect(tarjetas.params).toEqual([...cuotas.params, 14]);
    expect(sinCobro.params).toEqual(tarjetas.params);
  });

  it('dos resúmenes seguidos no se arrastran parámetros entre sí', async () => {
    await getResumenVentas({ responsableId: '14' });
    await getResumenVentas({ responsableId: '7' });
    const cuotas = consultas.filter((c) => /conversion_installments/.test(c.sql));
    expect(cuotas.map((c) => c.params)).toEqual([['14'], ['7']]);
  });

  it('las otras vistas de Ventas por gestora tampoco fallan', async () => {
    await expect(getVentasPorCliente({ ...TODOS, responsableId: '14', page: 2, limit: 20 })).resolves.toBeDefined();
    await expect(getVentasPorCliente({ responsableId: '14' })).resolves.toBeDefined();
    await expect(getVentasPorAsesora({ ...TODOS, responsableId: '14' })).resolves.toBeDefined();
    await expect(getTopProducts({ projectId: 1, from: '2026-10-01', to: '2026-10-31', responsableId: '14' })).resolves.toBeDefined();
  });
});
