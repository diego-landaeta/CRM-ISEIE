import { describe, it, expect, vi, beforeEach } from 'vitest';

// #224 — Con una empresa (CEDIA, siete campus) el Dashboard pedía stats y
// today UNA VEZ POR CAMPUS y sumaba en el navegador: catorce peticiones antes
// de pintar nada. Ahora el servidor acepta la lista y suma en una consulta.

const consultas = [];
vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [{ count: '0', total: 0 }] };
  }),
}));

const { getStats, getTodaySummary } = await import('../src/modules/leads/lead.model.js');

beforeEach(() => { consultas.length = 0; });

describe('stats de varios campus en una consulta', () => {
  it('una lista de campus va como ANY', async () => {
    await getStats([1, 2, 3], {});
    expect(consultas).toHaveLength(1);
    expect(consultas[0].sql).toMatch(/WHERE project_id = ANY\(\$1::int\[\]\) AND deleted_at IS NULL/);
    expect(consultas[0].params[0]).toEqual([1, 2, 3]);
  });

  it('un campus suelto sigue funcionando igual', async () => {
    await getStats(5, { responsableId: 7 });
    // La persona va como lista desde el equipo comercial (09/11/2026).
    expect(consultas[0].params).toEqual([[5], [7]]);
  });
});

describe('today de varios campus en una petición', () => {
  it('todas sus consultas reciben la lista', async () => {
    await getTodaySummary({ userId: 1, role: 'admin', projectIds: [1, 2, 3] });
    expect(consultas.length).toBeGreaterThan(1);
    for (const c of consultas) {
      expect(c.sql).toMatch(/\$2::int\[\] IS NULL OR [lc]\.project_id = ANY\(\$2::int\[\]\)/);
      expect(c.params).toEqual([null, [1, 2, 3]]);
    }
  });

  it('un campus suelto va como lista de uno, y sin campus no se acota', async () => {
    await getTodaySummary({ userId: 1, role: 'gestor', projectId: 4 });
    expect(consultas[0].params).toEqual([[1], [4]]);
    consultas.length = 0;
    await getTodaySummary({ userId: 1, role: 'superadmin' });
    expect(consultas[0].params).toEqual([null, null]);
  });
});
