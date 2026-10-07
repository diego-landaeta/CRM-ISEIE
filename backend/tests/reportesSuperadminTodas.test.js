import { describe, it, expect, vi, beforeEach } from 'vitest';

// Los reportes de dirección a un SUPERADMIN llevan todas las empresas, aunque
// tenga campus asignados (Diego, 07/10: «faltan los reportes de academia y
// ictess que lleguen a manuelcasas»). Manuel tiene los campus de CEDIA y solo
// le llegaba CEDIA.

const TODOS = [
  { id: 1, nombre: 'ISEIH', sociedad_id: 8 },
  { id: 4, nombre: 'ICTESS', sociedad_id: 9 },
  { id: 5, nombre: 'ACADEMIA IA', sociedad_id: 10 },
];
let asignados = [];

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql) => {
    if (sql.includes('FROM user_projects up')) return { rows: asignados };
    if (sql.includes('FROM projects p') && sql.includes('WHERE p.active')) return { rows: TODOS };
    if (sql.includes('FROM invoice_issuers')) {
      return { rows: [{ id: 8, razon_social: 'CEDIA' }, { id: 9, razon_social: 'Ictess' }, { id: 10, razon_social: 'Lateral Thinking' }] };
    }
    return { rows: [] };
  }),
}));

const C = await import('../src/jobs/correosDelEquipo.js');
const nombres = (es) => es.map((e) => e.nombre).sort();

beforeEach(() => { asignados = [TODOS[0]]; });

describe('a quién le llega cada empresa en los reportes de dirección', () => {
  it('un superadmin con solo campus de CEDIA recibe también ICTESS y Academia', async () => {
    expect(nombres(await C.empresasDe({ id: 2, role: 'superadmin' }))).toEqual(['CEDIA', 'Ictess', 'Lateral Thinking']);
  });
  it('un superadmin sin campus, también todas', async () => {
    asignados = [];
    expect(nombres(await C.empresasDe({ id: 2, role: 'superadmin' }))).toEqual(['CEDIA', 'Ictess', 'Lateral Thinking']);
  });
  it('un admin, solo las de sus campus', async () => {
    expect(nombres(await C.empresasDe({ id: 34, role: 'admin' }))).toEqual(['CEDIA']);
  });
});
