import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Pedir acceso o permiso desde el CRM (CRM#820).
 *
 * Las peticiones de acceso («dale acceso a X», «se me cerró Claude») le
 * llegaban a Diego por chat. Ahora son un ticket de Soporte del tipo `access`,
 * en la misma bandeja, y le llegan a soporte y a los admins.
 *
 * Lo que se fija aquí, sin base (el modelo va fingido; lo de Postgres y las
 * rutas de verdad está en `pedirAccesoConBase820.test.js`):
 *
 *   - El formulario: qué es obligatorio y qué no vale.
 *   - Que la petición NO crea a nadie ni da nada: solo guarda el ticket.
 *   - Quién la ve y quién la mueve: con el catálogo (`accesos.*`), no por rol.
 *   - Que el tutor, el colaborador y el tutor redactor pueden PEDIR (su lista
 *     de rutas cerrada lleva esa ruta) y nada más de Soporte.
 */

const modelo = {
  crear: vi.fn(),
  crearAcceso: vi.fn(async (d) => ({
    id: '50', kind: 'access', title: d.titulo, projectId: d.projectId, autorId: d.abiertoPor, acceso: d.acceso,
  })),
  porId: vi.fn(),
  listar: vi.fn(async () => ({ tickets: [], total: 0, page: 1, limit: 50, totalPages: 0 })),
  mensajesDe: vi.fn(async () => []),
  adjuntosDe: vi.fn(async () => []),
  responder: vi.fn(async () => 1),
  cambiarEstado: vi.fn(async (id, status) => ({ id: String(id), status })),
  destinatariosDelAviso: vi.fn(async () => [1, 2, 9, 4]),
  clavesDeAdjuntos: vi.fn(async () => []),
  borrar: vi.fn(async () => true),
  proyectoExiste: vi.fn(async () => true),
};
vi.mock('../src/modules/soporte/soporte.model.js', () => modelo);

const avisado = vi.fn(async () => {});
vi.mock('../src/modules/notifications/notifications.service.js', () => ({
  notifyUsers: (...a) => avisado(...a),
}));
vi.mock('../src/shared/services/brevo.service.js', () => ({ sendTicketNuevoEmail: vi.fn(async () => ({ sent: false })) }));
const campus = vi.fn(async () => [1]);
vi.mock('../src/shared/utils/ambito.js', () => ({
  campusDeLaPersona: (...a) => campus(...a),
  veTodoElCrm: (u) => ['superadmin', 'soporte'].includes(u?.role),
}));

// El catálogo, fingido por persona: lo que tiene cada una.
const DE_SERIE = {
  superadmin: ['accesos.pedir', 'accesos.view', 'accesos.gestionar'],
  soporte: ['accesos.pedir', 'accesos.view', 'accesos.gestionar'],
  admin: ['accesos.pedir', 'accesos.view', 'accesos.gestionar'],
  gestor: ['accesos.pedir'],
};
const quitados = new Set(); // userIds a los que se les ha quitado `accesos.view` y `gestionar`
const tiene = (u, c) => !quitados.has(u?.userId) && (DE_SERIE[u?.role] || []).includes(c);
vi.mock('../src/shared/middleware/permissions.js', async (original) => ({
  ...(await original()),
  tienePermiso: async (req, ...claves) => claves.some((c) => tiene(req.user, c)),
}));
// Los destinatarios del aviso: 1 superadmin, 2 soporte, 9 admin y 4 la gestora que pide.
const ROL_DE = { 1: 'superadmin', 2: 'soporte', 9: 'admin', 4: 'gestor' };
vi.mock('../src/modules/permissions/permissions.service.js', () => ({
  explicarPermisos: async (id) => ({ mapa: { 'accesos.view': tiene({ userId: id, role: ROL_DE[id] }, 'accesos.view') } }),
}));

const ctrl = await import('../src/modules/soporte/soporte.controller.js');
const { pedirAccesoSchema, crearTicketSchema } = await import('../src/modules/soporte/soporte.validation.js');
// Arriba y no dentro de la prueba: montar el router tarda (multer, límites) y se pasaba del tiempo de una prueba.
const { default: router } = await import('../src/modules/soporte/soporte.routes.js');

async function llamar(handler, req) {
  const res = { codigo: 200, cuerpo: null,
    status(c) { this.codigo = c; return this; }, json(c) { this.cuerpo = c; return this; } };
  let error = null;
  await handler({ query: {}, params: {}, body: {}, ...req }, res, (e) => { error = e; });
  return { res, error };
}
const esperar = () => new Promise((r) => setTimeout(r, 10));

const LAURA = { userId: 4, role: 'gestor', nombre: 'Laura' };
const ADMIN = { userId: 9, role: 'admin', nombre: 'Admin' };
const SOPORTE = { userId: 2, role: 'soporte', nombre: 'Ángel José' };

beforeEach(() => {
  for (const f of Object.values(modelo)) f.mockClear?.();
  avisado.mockClear();
  quitados.clear();
  campus.mockResolvedValue([1]);
});

describe('el formulario (pedirAccesoSchema)', () => {
  const valido = { tipo: 'permiso', permiso: 'leads.view', explicacion: 'Necesito ver los prospectos de mi campus' };

  it('pide qué se necesita y una explicación', () => {
    expect(pedirAccesoSchema.safeParse(valido).success).toBe(true);
    expect(pedirAccesoSchema.safeParse({ ...valido, tipo: undefined }).success).toBe(false);
    expect(pedirAccesoSchema.safeParse({ ...valido, tipo: 'darme_todo' }).success).toBe(false);
    expect(pedirAccesoSchema.safeParse({ ...valido, explicacion: '' }).success).toBe(false);
    expect(pedirAccesoSchema.safeParse({ ...valido, explicacion: 'x' }).success).toBe(false);
  });

  it('un alta lleva nombre y correo de la persona; el correo, bien escrito', () => {
    const alta = { tipo: 'alta', explicacion: 'Entra el lunes en admisiones' };
    expect(pedirAccesoSchema.safeParse(alta).success).toBe(false);
    expect(pedirAccesoSchema.safeParse({ ...alta, nombre: 'Ana' }).success).toBe(false);
    expect(pedirAccesoSchema.safeParse({ ...alta, nombre: 'Ana', correo: 'no-es-correo' }).success).toBe(false);
    const ok = pedirAccesoSchema.safeParse({ ...alta, nombre: 'Ana', correo: ' Ana@Ejemplo.com ' });
    expect(ok.success).toBe(true);
    expect(ok.data.correo).toBe('ana@ejemplo.com');
  });

  it('la clave de permiso, con forma de clave del catálogo (o vacía)', () => {
    expect(pedirAccesoSchema.safeParse({ ...valido, permiso: '' }).data.permiso).toBeNull();
    expect(pedirAccesoSchema.safeParse({ ...valido, permiso: 'webhooks-salientes.todas' }).success).toBe(true);
    expect(pedirAccesoSchema.safeParse({ ...valido, permiso: 'DROP TABLE users' }).success).toBe(false);
    expect(pedirAccesoSchema.safeParse({ ...valido, permiso: 'leads' }).success).toBe(false);
  });

  it('por el formulario de siempre no se abre un ticket «access»: solo por el suyo', () => {
    expect(crearTicketSchema.safeParse({ title: 'Un acceso', kind: 'access' }).success).toBe(false);
    expect(crearTicketSchema.safeParse({ title: 'Un bug', kind: 'bug' }).success).toBe(true);
  });
});

describe('el título del ticket', () => {
  it('dice qué se pide de un vistazo', () => {
    expect(ctrl.tituloDeAcceso({ tipo: 'alta', nombre: 'Ana Pérez', correo: 'ana@x.com' })).toBe('Alta: Ana Pérez (ana@x.com)');
    expect(ctrl.tituloDeAcceso({ tipo: 'permiso', permiso: 'leads.view' })).toBe('Permiso: leads.view');
    expect(ctrl.tituloDeAcceso({ tipo: 'permiso' })).toBe('Permiso');
    expect(ctrl.tituloDeAcceso({ tipo: 'campus', campus: 'CEDIA' })).toBe('Acceso a un campus: CEDIA');
    expect(ctrl.tituloDeAcceso({ tipo: 'claude' })).toBe('Acceso a Claude / MCP');
    expect(ctrl.tituloDeAcceso({ tipo: 'otro' })).toBe('Otra petición de acceso');
  });

  it('lo que se guarda en `acceso` no lleva claves vacías', () => {
    expect(ctrl.datosDeAcceso({ tipo: 'claude' })).toEqual({ tipo: 'claude' });
    expect(ctrl.datosDeAcceso({ tipo: 'alta', nombre: 'Ana', correo: 'a@x.com' }))
      .toEqual({ tipo: 'alta', persona: { nombre: 'Ana', correo: 'a@x.com' } });
  });
});

describe('pedir (POST /api/soporte/accesos)', () => {
  it('guarda un ticket «access» con lo que se pide, y nada más', async () => {
    const { res, error } = await llamar(ctrl.pedirAcceso, {
      user: LAURA,
      body: { tipo: 'permiso', permiso: 'reports.view', explicacion: 'Para ver el informe de mi campus', projectId: 1, url: 'https://x/crm/informes' },
    });
    expect(error).toBeNull();
    expect(res.codigo).toBe(201);
    expect(modelo.crearAcceso).toHaveBeenCalledWith({
      abiertoPor: 4, projectId: 1, titulo: 'Permiso: reports.view',
      explicacion: 'Para ver el informe de mi campus', url: 'https://x/crm/informes',
      acceso: { tipo: 'permiso', permiso: 'reports.view' },
    });
    // No abre un ticket de los de siempre ni toca nada más.
    expect(modelo.crear).not.toHaveBeenCalled();
    expect(modelo.cambiarEstado).not.toHaveBeenCalled();
  });

  it('un campus de la lista que no es suyo es un 403; uno que no tiene va escrito', async () => {
    const ajeno = await llamar(ctrl.pedirAcceso, {
      user: LAURA, body: { tipo: 'campus', explicacion: 'Quiero entrar a CEDIA', projectId: 7 },
    });
    expect(ajeno.error?.statusCode).toBe(403);
    expect(modelo.crearAcceso).not.toHaveBeenCalled();

    const escrito = await llamar(ctrl.pedirAcceso, {
      user: LAURA, body: { tipo: 'campus', explicacion: 'Quiero entrar a CEDIA', campus: 'CEDIA' },
    });
    expect(escrito.error).toBeNull();
    expect(modelo.crearAcceso).toHaveBeenCalledWith(expect.objectContaining({
      projectId: null, titulo: 'Acceso a un campus: CEDIA', acceso: { tipo: 'campus', campus: 'CEDIA' },
    }));
  });

  it('sin explicación no se guarda (400)', async () => {
    const { error } = await llamar(ctrl.pedirAcceso, { user: LAURA, body: { tipo: 'claude' } });
    expect(error?.statusCode).toBe(400);
    expect(modelo.crearAcceso).not.toHaveBeenCalled();
  });

  it('avisa en la campana a quien puede verla, no a quien la pide ni a quien se le quitó el permiso', async () => {
    quitados.add(9); // al admin se le ha quitado «Ver las peticiones de acceso»
    await llamar(ctrl.pedirAcceso, { user: LAURA, body: { tipo: 'claude', explicacion: 'Se me cerró Claude', projectId: 1 } });
    await esperar();
    expect(modelo.destinatariosDelAviso).toHaveBeenCalledWith(1);
    expect(avisado).toHaveBeenCalledTimes(1);
    const aviso = avisado.mock.calls[0][0];
    expect(aviso.type).toBe('acceso_pedido');
    expect(aviso.targetUserIds).toEqual([1, 2]);
  });
});

describe('quién ve las peticiones (catálogo, no rol)', () => {
  it('en la bandeja de siempre, quien administra y tiene `accesos.view` las ve todas', async () => {
    await llamar(ctrl.listar, { user: SOPORTE });
    expect(modelo.listar).toHaveBeenCalledWith(expect.objectContaining({ sinAccesosDe: null }));
  });

  it('a un admin sin `accesos.view` se le quitan las de otros; a una gestora, igual (solo ve las suyas)', async () => {
    quitados.add(9);
    await llamar(ctrl.listar, { user: ADMIN });
    expect(modelo.listar).toHaveBeenLastCalledWith(expect.objectContaining({ sinAccesosDe: 9 }));
    await llamar(ctrl.listar, { user: LAURA });
    expect(modelo.listar).toHaveBeenLastCalledWith(expect.objectContaining({ sinAccesosDe: 4 }));
  });

  it('abrir una petición ajena sin `accesos.view` es el mismo 404 que una que no existe', async () => {
    quitados.add(9);
    modelo.porId.mockResolvedValue({ id: '50', kind: 'access', autorId: 4, projectId: 1 });
    const { error } = await llamar(ctrl.porId, { user: ADMIN, params: { id: '50' } });
    expect(error?.statusCode).toBe(404);
    // La suya sí la abre quien la pidió.
    const propia = await llamar(ctrl.porId, { user: LAURA, params: { id: '50' } });
    expect(propia.error).toBeNull();
  });

  it('la lista de peticiones va con el tipo y el alcance de cualquier ticket', async () => {
    campus.mockResolvedValue([1, 3]);
    await llamar(ctrl.listarAccesos, { user: ADMIN });
    expect(modelo.listar).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'access', alcance: { userId: 9, projectIds: [1, 3] },
    }));
    await llamar(ctrl.listarAccesos, { user: SOPORTE });
    expect(modelo.listar).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'access', alcance: null }));
  });
});

describe('gestionar (PATCH /api/soporte/accesos/:id)', () => {
  beforeEach(() => {
    modelo.porId.mockResolvedValue({ id: '50', kind: 'access', autorId: 4, projectId: 1, title: 'Permiso: reports.view' });
  });

  it('cambia el estado, deja la nota como respuesta visible y avisa a quien la pidió', async () => {
    const { res, error } = await llamar(ctrl.gestionarAcceso, {
      user: SOPORTE, params: { id: '50' }, body: { status: 'resolved', nota: 'Hecho, ya lo tienes' },
    });
    expect(error).toBeNull();
    expect(res.cuerpo.data.status).toBe('resolved');
    expect(modelo.responder).toHaveBeenCalledWith(50, 2, 'Hecho, ya lo tienes', false);
    expect(modelo.cambiarEstado).toHaveBeenCalledWith(50, 'resolved');
    await esperar();
    expect(avisado).toHaveBeenCalledWith(expect.objectContaining({ type: 'acceso_respondido', targetUserIds: [4] }));
  });

  it('un ticket que no es de acceso no se mueve por aquí (404)', async () => {
    modelo.porId.mockResolvedValue({ id: '51', kind: 'bug', autorId: 4, projectId: 1 });
    const { error } = await llamar(ctrl.gestionarAcceso, { user: SOPORTE, params: { id: '51' }, body: { status: 'resolved' } });
    expect(error?.statusCode).toBe(404);
    expect(modelo.cambiarEstado).not.toHaveBeenCalled();
  });

  it('por la ruta de siempre, mover o borrar una petición pide `accesos.gestionar`', async () => {
    quitados.add(9);
    // Sin `accesos.view` ni `gestionar`, el admin ni la alcanza.
    const sinVer = await llamar(ctrl.cambiarEstado, { user: ADMIN, params: { id: '50' }, body: { status: 'resolved' } });
    expect(sinVer.error?.statusCode).toBe(404);
    const borrar = await llamar(ctrl.borrar, { user: ADMIN, params: { id: '50' } });
    expect(borrar.error?.statusCode).toBe(404);
    expect(modelo.cambiarEstado).not.toHaveBeenCalled();
    expect(modelo.borrar).not.toHaveBeenCalled();

    // Con ellos, sí.
    quitados.clear();
    const ok = await llamar(ctrl.cambiarEstado, { user: ADMIN, params: { id: '50' }, body: { status: 'in_review' } });
    expect(ok.error).toBeNull();
  });
});

describe('las rutas y el catálogo', () => {
  it('cada ruta de peticiones lleva su `puede` del catálogo', async () => {
    const guardias = {};
    for (const capa of router.stack.filter((c) => c.route?.path?.startsWith('/accesos'))) {
      const metodo = Object.keys(capa.route.methods)[0].toUpperCase();
      const g = capa.route.stack.map((s) => s.handle.regla).find((r) => r?.tipo === 'puede');
      guardias[`${metodo} ${capa.route.path}`] = g?.claves;
    }
    expect(guardias).toEqual({
      'POST /accesos': ['accesos.pedir'],
      'GET /accesos': ['accesos.view'],
      'PATCH /accesos/:id': ['accesos.gestionar'],
    });
  });

  it('pedir lo trae todo rol; ver y gestionar, solo soporte y admin (y el superadmin, siempre)', async () => {
    const { POR_CLAVE, ROLES_FIJOS } = await import('../src/modules/permissions/catalogo.js');
    const todos = ROLES_FIJOS.map((r) => r.clave).filter((r) => r !== 'superadmin');
    expect([...POR_CLAVE['accesos.pedir'].roles].sort()).toEqual([...todos].sort());
    expect(POR_CLAVE['accesos.view'].roles).toEqual(['admin', 'soporte']);
    expect(POR_CLAVE['accesos.gestionar'].roles).toEqual(['admin', 'soporte']);
  });

  it('el tutor, el colaborador y el tutor redactor pueden pedir, y nada más de Soporte', async () => {
    const { rutaDeRolCerrado } = await import('../src/shared/utils/roles.js');
    for (const role of ['tutor', 'colaborador', 'tutor_redactor']) {
      const u = { role, roles_extra: [] };
      expect(rutaDeRolCerrado(u, '/api/soporte/accesos'), role).toBe(true);
      expect(rutaDeRolCerrado(u, '/api/soporte/accesos?x=1'), role).toBe(true);
      expect(rutaDeRolCerrado(u, '/api/soporte'), role).toBe(false);
      expect(rutaDeRolCerrado(u, '/api/soporte/12'), role).toBe(false);
      expect(rutaDeRolCerrado(u, '/api/soporte/accesos/12'), role).toBe(false);
    }
  });
});
