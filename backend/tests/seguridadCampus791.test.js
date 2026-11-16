import { describe, it, expect, vi, beforeEach } from 'vitest';

// Los permisos salen del catálogo (#423), con el resolver de verdad y sin base.
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

/**
 * CRM#791 · Dos fugas de la revisión de la #755.
 *
 * 1. Formularios: las rutas `/:id` (ver, estado, eventos, editar, borrar,
 *    escuchar) no miraban el campus. Ahora llevan `formularioDeSuCampus`: en un
 *    campus suyo pasa; en otro es un 404; superadmin y soporte, todo.
 * 2. Proyectos: el listado y la ficha devolvían `webhook_api_key` de todos los
 *    campus a cualquiera con `projects.view` (todo el mundo). Ahora solo a quien
 *    tiene `projects.edit`, y en sus campus.
 */

// ── Doble de la base ────────────────────────────────────────────────────────
// Campus: 1 y 2 de la gestora 9; 3 de otra empresa. Formularios: 50 en el 1, 70 en el 3.
const CAMPUS = { 9: [1, 2], 11: [1] };
const FORMS = { 50: 1, 70: 3 };
vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ');
    if (/FROM user_projects WHERE user_id = \$1 AND active = true/.test(s)) {
      return { rows: (CAMPUS[params[0]] || []).map((project_id) => ({ project_id })) };
    }
    if (/SELECT project_id FROM form_templates WHERE id = \$1/.test(s)) {
      return { rows: FORMS[params[0]] ? [{ project_id: FORMS[params[0]] }] : [] };
    }
    return { rows: [] };
  }),
  getClient: async () => ({ query: async () => ({ rows: [] }), release: () => {} }),
}));

const PROYECTOS = [
  { id: 1, nombre: 'ISEIH', webhook_api_key: 'clave-1' },
  { id: 2, nombre: 'Psiko', webhook_api_key: 'clave-2' },
  { id: 3, nombre: 'ICTESS', webhook_api_key: 'clave-3' },
];
vi.mock('../src/modules/projects/project.model.js', () => ({
  findAll: vi.fn(async () => PROYECTOS.map((p) => ({ ...p }))),
  findById: vi.fn(async (id) => {
    const p = PROYECTOS.find((x) => x.id === Number(id));
    return p ? { ...p } : null;
  }),
}));
vi.mock('../src/modules/projects/project.service.js', () => ({}));

const { formularioDeSuCampus, campusDelCuerpo } = await import('../src/modules/forms/form.acceso.js');
const projectCtrl = await import('../src/modules/projects/project.controller.js');
const { default: formRouter } = await import('../src/modules/forms/form.routes.js');

const GESTORA = registrar({ userId: 9, role: 'gestor' });
const TUTORA = registrar({ userId: 21, role: 'tutor' });
const SUPER = registrar({ userId: 1, role: 'superadmin' });
const ADMIN_CONFIG = registrar({ userId: 11, role: 'admin', excepciones: { 'projects.edit': true } });

async function guardia(fn, user, { params = {}, body = {} } = {}) {
  let error = null; let paso = false;
  await fn({ user, params, body }, {}, (e) => { if (e) error = e; else paso = true; });
  return { error, paso };
}

async function llamar(fn, user, params = {}) {
  let cuerpo = null; let error = null;
  const res = { status() { return this; }, json(b) { cuerpo = b; } };
  await fn({ user, params, query: {} }, res, (e) => { error = e; });
  return { cuerpo, error };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('formularios: cada /:id solo en su campus', () => {
  it('todas las rutas /:id llevan el guardia, y crear lleva el del cuerpo', () => {
    const rutas = formRouter.stack.filter((l) => l.route).map((l) => ({
      ruta: `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`,
      capas: l.route.stack.map((c) => c.handle),
    }));
    const conId = rutas.filter((r) => r.ruta.includes('/:id'));
    expect(conId.map((r) => r.ruta).sort()).toEqual([
      'DELETE /:id', 'GET /:id', 'GET /:id/events', 'GET /:id/status',
      'PATCH /:id', 'POST /:id/listen', 'POST /:id/listen/stop',
    ]);
    for (const r of conId) expect(r.capas, r.ruta).toContain(formularioDeSuCampus);
    expect(rutas.find((r) => r.ruta === 'POST /').capas).toContain(campusDelCuerpo);
  });

  it('en un campus suyo pasa', async () => {
    const r = await guardia(formularioDeSuCampus, GESTORA, { params: { id: '50' } });
    expect(r.paso).toBe(true);
    expect(r.error).toBeNull();
  });

  it('en otro campus es un 404, sin decir que existe', async () => {
    const r = await guardia(formularioDeSuCampus, GESTORA, { params: { id: '70' } });
    expect(r.paso).toBe(false);
    expect(r.error?.statusCode).toBe(404);
  });

  it('un id que no existe también es un 404', async () => {
    const r = await guardia(formularioDeSuCampus, GESTORA, { params: { id: '999' } });
    expect(r.error?.statusCode).toBe(404);
  });

  it('el superadmin, en cualquier campus', async () => {
    const r = await guardia(formularioDeSuCampus, SUPER, { params: { id: '70' } });
    expect(r.paso).toBe(true);
  });

  it('crear en un campus ajeno: 404; en uno suyo, pasa', async () => {
    expect((await guardia(campusDelCuerpo, GESTORA, { body: { project_id: 3 } })).error?.statusCode).toBe(404);
    expect((await guardia(campusDelCuerpo, GESTORA, { body: { project_id: 2 } })).paso).toBe(true);
  });
});

describe('proyectos: la clave del webhook solo a quien puede configurar ese campus', () => {
  it('una tutora o una gestora (solo projects.view) no reciben ninguna clave', async () => {
    for (const quien of [TUTORA, GESTORA]) {
      const { cuerpo } = await llamar(projectCtrl.list, quien);
      expect(cuerpo.data).toHaveLength(3);
      for (const p of cuerpo.data) expect(p).not.toHaveProperty('webhook_api_key');
    }
  });

  it('la ficha tampoco', async () => {
    const { cuerpo } = await llamar(projectCtrl.getById, GESTORA, { id: '1' });
    expect(cuerpo.data.nombre).toBe('ISEIH');
    expect(cuerpo.data).not.toHaveProperty('webhook_api_key');
  });

  it('con projects.edit, la de sus campus y no la de otro', async () => {
    const { cuerpo } = await llamar(projectCtrl.list, ADMIN_CONFIG);
    const clave = Object.fromEntries(cuerpo.data.map((p) => [p.id, p.webhook_api_key]));
    expect(clave).toEqual({ 1: 'clave-1', 2: undefined, 3: undefined });
  });

  it('el superadmin las ve todas', async () => {
    const { cuerpo } = await llamar(projectCtrl.list, SUPER);
    expect(cuerpo.data.map((p) => p.webhook_api_key)).toEqual(['clave-1', 'clave-2', 'clave-3']);
  });
});
