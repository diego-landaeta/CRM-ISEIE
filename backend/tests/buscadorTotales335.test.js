import { describe, it, expect, vi, beforeEach } from 'vitest';

// Gemela de CRM#591 en ISEIE (#335): los totales de la cabecera de
// Prospectos (`getStats`) buscaban con un ILIKE a secas mientras la lista
// (`findAll`) ya iba sin acentos y con el teléfono por cifras. Con «gonzalez»
// la lista salía más larga que su total. Las dos usan ahora la misma condición.

vi.mock('../src/shared/config/db.js', () => {
  const queryMock = vi.fn();
  return { query: queryMock, getClient: vi.fn(), default: { query: queryMock } };
});

import { query } from '../src/shared/config/db.js';
import { condicionDeBusqueda, findAll, getStats } from '../src/modules/leads/lead.model.js';

beforeEach(() => vi.clearAllMocks());

describe('la condición de búsqueda compartida', () => {
  it('sin término no hay condición', () => {
    expect(condicionDeBusqueda('   ', { idx: 1 })).toBeNull();
    expect(condicionDeBusqueda(undefined, { idx: 1 })).toBeNull();
  });

  it('nombre sin acentos, recortado, y el siguiente parámetro libre', () => {
    const c = condicionDeBusqueda('  gonzalez ', { col: 'l.', idx: 4 });
    expect(c.sql).toContain("unaccent(COALESCE(l.nombre, '')) ILIKE unaccent($4)");
    expect(c.params).toEqual(['%gonzalez%']);
    expect(c.siguiente).toBe(5);
  });

  it('un teléfono con espacios también se busca por sus cifras', () => {
    const c = condicionDeBusqueda('626 27 64 14', { idx: 2 });
    expect(c.sql).toContain("regexp_replace(COALESCE(telefono, ''), '\\D', '', 'g') LIKE $3");
    expect(c.params).toEqual(['%626 27 64 14%', '%626276414%']);
    expect(c.siguiente).toBe(4);
  });

  it('«F-2026/123» no busca por las cifras sueltas', () => {
    expect(condicionDeBusqueda('F-2026/123', { idx: 1 }).params).toHaveLength(1);
  });
});

describe('la lista y sus totales buscan igual', () => {
  it('getStats lleva la misma condición que findAll', async () => {
    query.mockResolvedValue({ rows: [{ total: '0' }] });
    await findAll({ projectId: 1, search: 'gonzalez', page: 1, limit: 5 });
    const sqlLista = query.mock.calls.map(([sql]) => sql).join('\n');
    query.mockClear();
    await getStats(1, { search: 'gonzalez' });
    const sqlTotales = query.mock.calls.map(([sql]) => sql).join('\n');
    for (const sql of [sqlLista, sqlTotales]) {
      expect(sql).toMatch(/unaccent\(COALESCE\((l\.)?nombre, ''\)\) ILIKE unaccent\(\$\d+\)/);
      expect(sql).toMatch(/unaccent\(COALESCE\((l\.)?whatsapp_usuario, ''\)\)/);
    }
    expect(query.mock.calls.some(([, params]) => (params || []).includes('%gonzalez%'))).toBe(true);
  });
});
