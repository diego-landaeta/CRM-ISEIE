import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// «Solo lo suyo» (Diego, 02/11/2026: «arréglalo tú de una vez»). El alcance de una
// gestora se decidía con `req.user.role === 'gestor'`, el rol PRINCIPAL: un project
// manager y quien tiene la gestora como rol añadido veían todo el campus.

vi.mock('../src/shared/config/db.js', () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return { default: { query }, query, getClient: vi.fn() };
});
vi.mock('../src/modules/leads/lead.service.js', () => ({
  list: vi.fn(async () => ({ leads: [], total: 0, page: 1, limit: 20, totalPages: 0 })),
}));

const { soloLoSuyo } = await import('../src/shared/utils/roles.js');
const leadService = await import('../src/modules/leads/lead.service.js');
const { list } = await import('../src/modules/leads/lead.controller.js');

const u = (role, roles_extra = []) => ({ userId: 66, role, roles_extra });

beforeEach(() => vi.clearAllMocks());

describe('soloLoSuyo: quién ve solo lo suyo', () => {
  it.each([
    ['gestora', u('gestor'), true],
    ['project manager', u('project_manager'), true],
    ['tutor con la gestora añadida', u('tutor', ['gestor']), true],
    ['colaborador con la gestora añadida', u('colaborador', ['gestor']), true],
    ['admin', u('admin'), false],
    ['admin con la gestora añadida', u('admin', ['gestor']), false],
    ['gestora con soporte añadido', u('gestor', ['soporte']), false],
    ['soporte', u('soporte'), false],
    ['superadmin', u('superadmin'), false],
    ['sin usuario', undefined, false],
  ])('%s → %s', (_, user, esperado) => {
    expect(soloLoSuyo(user)).toBe(esperado);
  });

  it('los roles añadidos llegan también como texto de Postgres («{gestor}»)', () => {
    expect(soloLoSuyo({ role: 'tutor', roles_extra: '{gestor}' })).toBe(true);
  });
});

describe('el listado de prospectos aplica el alcance', () => {
  const res = () => ({ json: vi.fn() });
  it.each([
    ['project manager', u('project_manager')],
    ['tutor con la gestora añadida', u('tutor', ['gestor'])],
  ])('%s: solo los suyos, aunque pida los de otra', async (_, user) => {
    const next = vi.fn();
    await list({ query: { projectId: '3', responsableId: '7' }, user }, res(), next);
    expect(next).not.toHaveBeenCalled();
    expect(leadService.list.mock.calls[0][0]).toMatchObject({ responsableId: 66, unassigned: false });
  });
  it('un admin con la gestora añadida sigue viendo los de quien pida', async () => {
    await list({ query: { projectId: '3', responsableId: '7' }, user: u('admin', ['gestor']) }, res(), vi.fn());
    expect(leadService.list.mock.calls[0][0].responsableId).toBe(7);
  });
});

describe('nadie vuelve a decidir el alcance por el rol principal', () => {
  // Lo que NO es alcance (quién crea una venta, el campus obligatorio de una gestora,
  // las casillas del catálogo) se queda; cualquier otro `role === 'gestor'` en el
  // código del servidor tiene que pasar por `soloLoSuyo`.
  const PERMITIDOS = ['casillas.js', 'legado.js', 'user.validation.js', 'roles.js'];
  const lineas = execSync("git grep -n -E \"role\\s*(===|!==)\\s*'gestor'\" -- src", { encoding: 'utf8', cwd: new URL('..', import.meta.url) })
    .split('\n').filter(Boolean)
    .filter((l) => !PERMITIDOS.some((p) => l.split(':')[0].endsWith(p)))
    .filter((l) => !/creatorUser\.role|passCreator|^\S+:\d+:\s*(\*|\/\/)/.test(l))
    .filter((l) => !/\(soloSuyo \?\? role === 'gestor'\)/.test(l));
  it('ningún sitio de alcance queda con `role === \'gestor\'`', () => {
    expect(lineas).toEqual([]);
  });
  it('cada módulo de alcance usa soloLoSuyo', () => {
    for (const f of ['leads/lead.controller.js', 'leads/lead.service.js', 'conversions/conversion.controller.js',
      'invoices/invoices.controller.js', 'invoices/invoices.service.js', 'accounting/accounting.controller.js',
      'sales/sales.controller.js', 'sales/sales.goals.js', 'whatsapp/whatsapp.controller.js']) {
      expect(readFileSync(new URL(`../src/modules/${f}`, import.meta.url), 'utf8'), f).toMatch(/soloLoSuyo\(/);
    }
  });
});
