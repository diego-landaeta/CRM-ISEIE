import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Gemela de CRM#979. Diego, 21/11/2026: «el gestor solo debe ver el proyecto donde está, sus campus
 * y su configuración». El QA de /testeo vio a una gestora con los 9 campus de
 * todas las empresas en Configuración › Proyectos.
 *
 * Sin base: el modelo y el ámbito de mentira. Lo que se fija:
 *   · superadmin y soporte, todos los campus;
 *   · admin y gestora, solo los suyos (`user_projects`);
 *   · sin campus, ninguno;
 *   · la ficha de un campus ajeno es un 404, como si no existiera.
 */
const estado = vi.hoisted(() => ({ campus: {} }));

vi.mock('../src/modules/projects/project.model.js', () => ({
  findAll: vi.fn(async () => [1, 2, 3, 4].map((id) => ({ id, nombre: `Campus ${id}`, webhook_api_key: `whk_${id}` }))),
  findById: vi.fn(async (id) => ({ id, nombre: `Campus ${id}`, webhook_api_key: `whk_${id}` })),
}));
vi.mock('../src/shared/utils/ambito.js', async (orig) => {
  const real = await orig();
  const campusDeLaPersona = async (userId) => estado.campus[userId] || [];
  return {
    ...real,
    campusDeLaPersona,
    campusParaRecortar: async (req) => {
      if (real.veTodoElCrm(req.user)) return null;
      const mios = await campusDeLaPersona(req.user?.userId);
      return mios.length ? mios : [-1];
    },
    exigirCampusSuyo: async (req, projectId, mensaje = 'No encontrado', code = 'NOT_FOUND') => {
      if (real.veTodoElCrm(req.user)) return;
      const mios = await campusDeLaPersona(req.user?.userId);
      if (!mios.includes(Number(projectId))) {
        const { AppError } = await import('../src/shared/utils/AppError.js');
        throw new AppError(mensaje, 404, code);
      }
    },
  };
});
vi.mock('../src/shared/middleware/permissions.js', () => ({ tienePermiso: vi.fn(async () => false) }));

const ctrl = await import('../src/modules/projects/project.controller.js');

function llamar(fn, req) {
  return new Promise((resolve) => {
    const res = { status(c) { this.c = c; return this; }, json(b) { resolve({ status: this.c || 200, body: b }); } };
    fn(req, res, (err) => resolve({ status: err.statusCode || 500, body: { code: err.code } }));
  });
}
const ids = (r) => r.body.data.map((p) => p.id);

beforeEach(() => { estado.campus = { 10: [2], 11: [1, 3], 12: [] }; });

describe('GET /api/projects: cada uno ve sus campus', () => {
  it('superadmin y soporte, todos', async () => {
    for (const role of ['superadmin', 'soporte']) {
      expect(ids(await llamar(ctrl.list, { user: { userId: 1, role }, query: {} }))).toEqual([1, 2, 3, 4]);
    }
  });
  it('una gestora, solo el suyo', async () => {
    expect(ids(await llamar(ctrl.list, { user: { userId: 10, role: 'gestor' }, query: {} }))).toEqual([2]);
  });
  it('un admin, solo los suyos', async () => {
    expect(ids(await llamar(ctrl.list, { user: { userId: 11, role: 'admin' }, query: {} }))).toEqual([1, 3]);
  });
  it('sin campus, ninguno', async () => {
    expect(ids(await llamar(ctrl.list, { user: { userId: 12, role: 'gestor' }, query: {} }))).toEqual([]);
  });
});

describe('GET /api/projects/:id', () => {
  it('el suyo, sí', async () => {
    const r = await llamar(ctrl.getById, { user: { userId: 10, role: 'gestor' }, params: { id: '2' } });
    expect(r.status).toBe(200);
    expect(r.body.data.id).toBe(2);
  });
  it('uno ajeno, 404', async () => {
    const r = await llamar(ctrl.getById, { user: { userId: 10, role: 'gestor' }, params: { id: '3' } });
    expect(r.status).toBe(404);
  });
});
