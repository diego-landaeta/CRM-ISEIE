import { describe, it, expect, vi, beforeEach } from 'vitest';

// Los permisos salen del catálogo (#423): sin base, el resolver de verdad con
// las personas de cada `req` (tests/helpers/permisosSinBase.js).
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

// #246, decisiones de Diego (09/10):
//   1. la contraseña de un tutor la ponen el superadmin y el admin (el admin, a los de sus campus);
//   2. un superadmin puede cambiar el correo de otro superadmin;
//   3. el tutor cambia su propio correo desde «Mi perfil», y se avisa a administración.

const usuarios = new Map();
let campusDelAdmin = [];
let tutorTieneCampus = true;
const consultas = [];
vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    if (/SELECT nombre, email FROM users WHERE id/.test(sql)) return { rows: [usuarios.get(params[0])].filter(Boolean) };
    // #197: quién confirma su correo, y si tiene ficha de tutor.
    if (/AS es_tutor/.test(sql)) {
      const u = usuarios.get(params[0]);
      return { rows: u ? [{ ...u, es_tutor: u.role === 'tutor' }] : [] };
    }
    if (/FROM users u\s+WHERE u.active AND u.email IS NOT NULL/.test(sql)) return { rows: [{ id: 1, email: 'sa@x.com', nombre: 'Super' }, { id: 7, email: 'ad@x.com', nombre: 'Admin' }] };
    if (/FROM user_projects up JOIN projects p/.test(sql)) return { rows: [{ id: 3, nombre: 'ISEIE', slug: 'iseie', logo_url: null, emoji: null }] };
    // La marca del tutor, por `marca.service` (11/11): sus campus y, con uno, el suyo.
    if (/JOIN user_projects up ON up.user_id = u.id/.test(sql)) return { rows: [{ project_id: 3 }] };
    if (/p\.id = ANY\(\$1::int\[\]\)/.test(sql)) return { rows: [{ id: 3, nombre: 'ISEIE', slug: 'iseie', logo_url: null, emoji: null, sociedad_id: 6 }] };
    return { rows: [] };
  }),
}));
vi.mock('../src/modules/users/user.model.js', () => ({
  findById: vi.fn(async (id) => usuarios.get(id) || null),
  findByEmail: vi.fn(async () => null),
}));
vi.mock('../src/modules/auth/auth.model.js', () => ({ revokeAllUserTokens: vi.fn(async () => {}), logActivity: vi.fn(async () => {}) }));
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendWelcomeUserEmail: vi.fn(async () => ({ sent: true })), sendCorreoCambiadoEmail: vi.fn(async () => ({ sent: true })),
  sendEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('../src/modules/notifications/notifications.service.js', () => ({ notifyUsers: vi.fn(async () => {}) }));
vi.mock('../src/modules/mcp/mcp.model.js', () => ({}));
vi.mock('../src/shared/utils/ambito.js', () => ({ campusDeLaPersona: vi.fn(async () => campusDelAdmin) }));
vi.mock('../src/modules/tutores/tutor.model.js', () => ({ tieneAlgunCampus: vi.fn(async () => tutorTieneCampus) }));
// #197 (gemela de CRM#211): el correo propio va con un código a la dirección
// nueva. El mecanismo tiene su prueba contra la base (cambioDeCorreo197); aquí,
// con el código bueno («123456») el cambio de verdad pasa por `cambiarCorreo`,
// como en producción.
vi.mock('../src/modules/users/cambio-de-correo.js', () => ({
  MINUTOS: 15,
  MENSAJE_FRENADO: 'frenado',
  codigoFrenadoPara: () => false,
  pedirCodigo: vi.fn(async () => ({ enviado: true })),
  confirmarCodigo: vi.fn(async ({ userId, codigo, porUserId, ip }) => {
    if (codigo !== '123456') throw Object.assign(new Error('Código incorrecto'), { statusCode: 400, code: 'CODIGO_INCORRECTO' });
    const { cambiarCorreo } = await import('../src/modules/users/user.service.js');
    return cambiarCorreo(userId, 'juan@nuevo.com', { porUserId, ip });
  }),
}));

const userService = await import('../src/modules/users/user.service.js');
const userController = await import('../src/modules/users/user.controller.js');
const authController = await import('../src/modules/auth/auth.controller.js');
const { notifyUsers } = await import('../src/modules/notifications/notifications.service.js');
const { sendEmail } = await import('../src/shared/services/brevo.service.js');

// Desde #423 «quién puede» lo dice el guardia de la ruta (`puede('clave')`):
// para probarlo, la petición pasa por él antes que por el controlador.
const { puede } = await import('../src/shared/middleware/permissions.js');
const conGuardia = (clave, fn) => (req, res, next) => puede(clave)(req, res, (e) => (e ? next(e) : fn(req, res, next)));

const llamar = async (fn, req) => {
  let error = null; let cuerpo = null;
  await fn({ ip: '1.1.1.1', headers: {}, socket: {}, ...req }, { json: (b) => { cuerpo = b; }, status() { return this; } }, (e) => { error = e; });
  return { error, cuerpo };
};

beforeEach(() => {
  usuarios.clear(); consultas.length = 0; campusDelAdmin = [5]; tutorTieneCampus = true;
  usuarios.set(1, { id: 1, nombre: 'Super', email: 'sa@x.com', role: 'superadmin' });
  usuarios.set(2, { id: 2, nombre: 'Manuel', email: 'manuel@x.com', role: 'superadmin' });
  usuarios.set(7, { id: 7, nombre: 'Admin', email: 'ad@x.com', role: 'admin' });
  usuarios.set(9, { id: 9, nombre: 'Gestora', email: 'ge@x.com', role: 'gestor' });
  usuarios.set(21, { id: 21, nombre: 'Tutor Juan', email: 'juan@viejo.com', role: 'tutor' });
  vi.clearAllMocks();
});

describe('2 · el correo de un superadmin', () => {
  it('lo cambia otro superadmin', async () => {
    const r = await userService.cambiarCorreo(2, 'manuel@nuevo.com', { porUserId: 1 });
    expect(r.cambiado).toBe(true);
  });
  it('un admin, no', async () => {
    await expect(userService.cambiarCorreo(2, 'manuel@nuevo.com', { porUserId: 7 })).rejects.toThrow(/Solo otro superadmin/);
  });
});

describe('1 · la contraseña de un tutor', () => {
  const pass = { password: 'Nueva1234!', confirmPassword: 'Nueva1234!' };
  it('el admin, a un tutor de sus campus', async () => {
    const espia = vi.spyOn(userService, 'setPassword').mockResolvedValue(undefined);
    const { error } = await llamar(userController.setPassword, { params: { id: '21' }, body: pass, user: registrar({ userId: 7, role: 'admin' }) });
    expect(error?.message).toBeUndefined();
    espia.mockRestore();
  });
  it('el admin no a una gestora', async () => {
    const { error } = await llamar(userController.setPassword, { params: { id: '9' }, body: pass, user: registrar({ userId: 7, role: 'admin' }) });
    expect(error?.statusCode).toBe(403);
  });
  it('el admin no a un tutor de otro campus', async () => {
    tutorTieneCampus = false;
    const { error } = await llamar(userController.setPassword, { params: { id: '21' }, body: pass, user: registrar({ userId: 7, role: 'admin' }) });
    expect(error?.statusCode).toBe(404);
  });
  it('una gestora, nunca', async () => {
    const { error } = await llamar(conGuardia('users.contrasena', userController.setPassword), { params: { id: '21' }, body: pass, user: registrar({ userId: 9, role: 'gestor' }) });
    expect(error?.statusCode).toBe(403);
  });
});

describe('3 · el tutor cambia su correo y se avisa a administración', () => {
  it('lo cambia y avisa en la campanita y por correo a superadmin y admin', async () => {
    const { error, cuerpo } = await llamar(authController.updateMyEmail, { body: { codigo: '123456' }, user: registrar({ userId: 21, role: 'tutor' }) });
    expect(error?.message).toBeUndefined();
    expect(cuerpo.data).toMatchObject({ email: 'juan@nuevo.com', cambiado: true, hayQueVolverAEntrar: true });
    expect(notifyUsers).toHaveBeenCalledWith(expect.objectContaining({ type: 'tutor_correo_cambiado', targetUserIds: [1, 7] }));
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail.mock.calls[0][0].htmlContent).toMatch(/juan@viejo\.com/);
  });
  it('el correo va con la plantilla común y la marca del campus del tutor (Diego, 10/10)', async () => {
    await llamar(authController.updateMyEmail, { body: { codigo: '123456' }, user: registrar({ userId: 21, role: 'tutor' }) });
    const { htmlContent, textContent, projectId } = sendEmail.mock.calls[0][0];
    expect(htmlContent).toMatch(/<!DOCTYPE html>/);
    expect(htmlContent).toMatch(/Te lo manda el <strong[^>]*>CRM de ISEIE<\/strong>/);
    expect(htmlContent).toMatch(/\/iseie-icon-192\.png/); // el logo del campus
    expect(htmlContent).toMatch(/Abrir Tutores/);
    expect(textContent).toMatch(/juan@nuevo\.com/);
    expect(projectId).toBe(3); // sale por la cuenta y el remitente de esa marca
  });
  it('a administración solo le llegan los admin de algún campus del tutor (y los superadmin)', async () => {
    await llamar(authController.updateMyEmail, { body: { codigo: '123456' }, user: registrar({ userId: 21, role: 'tutor' }) });
    const sql = consultas.find((c) => /u.role = 'superadmin'/.test(c.sql))?.sql || '';
    expect(sql).toMatch(/u.role = 'admin' AND EXISTS/);
    expect(sql).toMatch(/suyo.user_id = \$1/);
  });
  it('sin el código bueno no cambia nada', async () => {
    const { error } = await llamar(authController.updateMyEmail, { body: { codigo: '000000' }, user: registrar({ userId: 21, role: 'tutor' }) });
    expect(error?.code).toBe('CODIGO_INCORRECTO');
    expect(notifyUsers).not.toHaveBeenCalled();
  });
  it('quien no es tutor también puede, con su código (#197), pero no se avisa a administración', async () => {
    usuarios.set(9, { id: 9, nombre: 'Gestora', email: 'ges@viejo.com', role: 'gestor' });
    const { error, cuerpo } = await llamar(authController.updateMyEmail, { body: { codigo: '123456' }, user: registrar({ userId: 9, role: 'gestor' }) });
    expect(error?.message).toBeUndefined();
    expect(cuerpo.data.cambiado).toBe(true);
    expect(notifyUsers).not.toHaveBeenCalled();
  });
  it('todos los roles pasan el guardia (Diego, 06/11, en CRM#688: todos los roles)', async () => {
    for (const role of ['gestor', 'admin', 'soporte', 'project_manager', 'colaborador', 'lider_equipo', 'tutor_redactor']) {
      usuarios.set(9, { id: 9, nombre: 'Otra', email: 'ges@viejo.com', role });
      // `conGuardia` no espera al permiso (es asíncrono): se espera a la respuesta.
      let error = null; let cuerpo = null;
      conGuardia('cuenta.cambiar_correo', authController.updateMyEmail)(
        { ip: '1.1.1.1', headers: {}, socket: {}, body: { codigo: '123456' }, user: registrar({ userId: 9, role }) },
        { json: (b) => { cuerpo = b; }, status() { return this; } }, (e) => { error = e; });
      await vi.waitFor(() => expect(cuerpo || error, role).toBeTruthy());
      expect(error?.message, role).toBeUndefined();
      expect(cuerpo.data.cambiado, role).toBe(true);
    }
  });
});
