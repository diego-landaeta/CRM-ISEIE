import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Plantillas de WhatsApp: cada una, en su campus (CRM#129; en ISEIE, #181,
 * gemela de CRM#861).
 *
 * Crear, editar y borrar no pasaban por el recorte de campus. El `projectId`
 * de una nueva venía en el cuerpo tal cual, y editar o borrar por id solo
 * miraba el permiso: un admin de una empresa con «plantillas compartidas»
 * reescribía por su id las del proceso de otra empresa.
 *
 * Sin base: se simulan los campus de cada persona (`user_projects`), el
 * permiso y el modelo. Lo que se defiende es la decisión del controlador.
 *
 *   npx vitest run tests/whatsappPlantillasCampus129.test.js
 */

process.env.LOG_LEVEL = 'silent';

// Los campus de cada persona, como los devolvería `user_projects`.
const CAMPUS = { 10: [1], 20: [2], 30: [1] };
const query = vi.fn(async (sql, params) => {
  if (/FROM user_projects/.test(sql)) return { rows: (CAMPUS[params[0]] || []).map((p) => ({ project_id: p })) };
  return { rows: [] };
});
vi.mock('../src/shared/config/db.js', () => ({ query: (...a) => query(...a), default: { query: (...a) => query(...a) } }));

const permisos = new Set();
vi.mock('../src/shared/middleware/permissions.js', () => ({
  tienePermiso: vi.fn(async (_req, clave) => permisos.has(clave)),
  puede: () => (_req, _res, next) => next(),
}));

vi.mock('../src/modules/whatsapp/chat.controller.js', () => ({
  usuarioObjetivo: vi.fn(async (req) => req.user.userId),
}));

const PLANTILLAS = {
  // Del proceso, compartida, del campus 2.
  7: { id: 7, project_id: 2, ambito: 'compartida', owner_id: null },
  // Personal de la persona 10, en el campus 1.
  8: { id: 8, project_id: 1, ambito: 'personal', owner_id: 10 },
  // Compartida del campus 1.
  9: { id: 9, project_id: 1, ambito: 'compartida', owner_id: null },
};
const model = {
  getTemplate: vi.fn(async (id) => PLANTILLAS[id] || null),
  createTemplate: vi.fn(async (d) => ({ id: 99, ...d })),
  updateTemplate: vi.fn(async (id, d) => ({ id, ...d })),
  deleteTemplate: vi.fn(async () => {}),
  listTemplates: vi.fn(async () => []),
};
vi.mock('../src/modules/whatsapp/whatsapp.model.js', () => model);

const ctrl = await import('../src/modules/whatsapp/whatsapp.controller.js');

/** Llama a un manejador y devuelve lo que contestó o el error que pasó a next. */
async function llamar(fn, { user, body = {}, params = {}, query: q = {} }) {
  const out = { status: 200, body: null, error: null };
  const res = {
    status(s) { out.status = s; return this; },
    json(b) { out.body = b; return this; },
  };
  await fn({ user, body, params, query: q }, res, (err) => { out.error = err || null; });
  return out;
}

const ADMIN_C1 = { userId: 10, role: 'admin' };
const ADMIN_C2 = { userId: 20, role: 'admin' };
const GESTORA_C1 = { userId: 30, role: 'gestor' };
const SUPER = { userId: 1, role: 'superadmin' };

beforeEach(() => {
  permisos.clear();
  for (const f of Object.values(model)) f.mockClear();
});

describe('crear una plantilla', () => {
  it('en un campus que no es suyo: 404 y no se guarda nada', async () => {
    permisos.add('whatsapp.plantillas_compartidas');
    const r = await llamar(ctrl.createTemplate, {
      user: ADMIN_C1, body: { projectId: 2, label: 'Hola', body: 'Hola {nombre}', ambito: 'compartida' },
    });
    expect(r.error?.statusCode).toBe(404);
    expect(model.createTemplate).not.toHaveBeenCalled();
  });

  it('ni siquiera una personal en un campus ajeno', async () => {
    const r = await llamar(ctrl.createTemplate, {
      user: GESTORA_C1, body: { projectId: 2, label: 'Mía', body: 'Soy {comercial}', ambito: 'personal' },
    });
    expect(r.error?.statusCode).toBe(404);
    expect(model.createTemplate).not.toHaveBeenCalled();
  });

  it('una personal en su campus, sin permiso especial: se guarda a su nombre', async () => {
    const r = await llamar(ctrl.createTemplate, {
      user: GESTORA_C1, body: { projectId: 1, label: 'Mía', body: 'Soy {comercial}', ambito: 'personal' },
    });
    expect(r.error).toBeNull();
    expect(r.status).toBe(201);
    expect(model.createTemplate).toHaveBeenCalledWith(expect.objectContaining({ projectId: 1, ownerId: 30, ambito: 'personal' }));
  });

  it('una compartida en su campus sin el permiso: 403', async () => {
    const r = await llamar(ctrl.createTemplate, {
      user: GESTORA_C1, body: { projectId: 1, label: 'De todas', body: 'Hola', ambito: 'compartida' },
    });
    expect(r.error?.statusCode).toBe(403);
  });

  it('superadmin, en cualquiera', async () => {
    permisos.add('whatsapp.plantillas_compartidas');
    const r = await llamar(ctrl.createTemplate, {
      user: SUPER, body: { projectId: 2, label: 'Hola', body: 'Hola', ambito: 'compartida' },
    });
    expect(r.error).toBeNull();
    expect(model.createTemplate).toHaveBeenCalled();
  });
});

describe('editar o borrar una plantilla del proceso', () => {
  it('la de otra empresa, aun con el permiso: 404 (no se confirma que exista)', async () => {
    permisos.add('whatsapp.plantillas_compartidas');
    const editar = await llamar(ctrl.updateTemplate, { user: ADMIN_C1, params: { id: '7' }, body: { body: 'otro texto' } });
    const borrar = await llamar(ctrl.deleteTemplate, { user: ADMIN_C1, params: { id: '7' } });
    expect(editar.error?.statusCode).toBe(404);
    expect(borrar.error?.statusCode).toBe(404);
    expect(model.updateTemplate).not.toHaveBeenCalled();
    expect(model.deleteTemplate).not.toHaveBeenCalled();
  });

  it('la de su campus, con el permiso: sí', async () => {
    permisos.add('whatsapp.plantillas_compartidas');
    const r = await llamar(ctrl.updateTemplate, { user: ADMIN_C2, params: { id: '7' }, body: { body: 'Soy {comercial}' } });
    expect(r.error).toBeNull();
    expect(model.updateTemplate).toHaveBeenCalledWith(7, expect.objectContaining({ body: 'Soy {comercial}' }));
  });

  it('la de su campus, sin el permiso (una gestora): 403', async () => {
    const r = await llamar(ctrl.updateTemplate, { user: GESTORA_C1, params: { id: '9' }, body: { body: 'x' } });
    expect(r.error?.statusCode).toBe(403);
    expect(model.updateTemplate).not.toHaveBeenCalled();
  });

  it('la suya personal, siempre: no hace falta permiso', async () => {
    const r = await llamar(ctrl.deleteTemplate, { user: ADMIN_C1, params: { id: '8' } });
    expect(r.error).toBeNull();
    expect(model.deleteTemplate).toHaveBeenCalledWith(8);
  });

  it('la que no existe: 404', async () => {
    permisos.add('whatsapp.plantillas_compartidas');
    const r = await llamar(ctrl.updateTemplate, { user: SUPER, params: { id: '404' }, body: { body: 'x' } });
    expect(r.error?.statusCode).toBe(404);
  });
});
