import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    if (/FROM users u\s+WHERE u.active AND u.email IS NOT NULL/.test(sql)) return { rows: [{ id: 1, email: 'sa@x.com', nombre: 'Super' }, { id: 7, email: 'ad@x.com', nombre: 'Admin' }] };
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

const userService = await import('../src/modules/users/user.service.js');
const userController = await import('../src/modules/users/user.controller.js');
const authController = await import('../src/modules/auth/auth.controller.js');
const { notifyUsers } = await import('../src/modules/notifications/notifications.service.js');
const { sendEmail } = await import('../src/shared/services/brevo.service.js');

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
    const { error } = await llamar(userController.setPassword, { params: { id: '21' }, body: pass, user: { userId: 7, role: 'admin' } });
    expect(error?.message).toBeUndefined();
    espia.mockRestore();
  });
  it('el admin no a una gestora', async () => {
    const { error } = await llamar(userController.setPassword, { params: { id: '9' }, body: pass, user: { userId: 7, role: 'admin' } });
    expect(error?.statusCode).toBe(403);
  });
  it('el admin no a un tutor de otro campus', async () => {
    tutorTieneCampus = false;
    const { error } = await llamar(userController.setPassword, { params: { id: '21' }, body: pass, user: { userId: 7, role: 'admin' } });
    expect(error?.statusCode).toBe(404);
  });
  it('una gestora, nunca', async () => {
    const { error } = await llamar(userController.setPassword, { params: { id: '21' }, body: pass, user: { userId: 9, role: 'gestor' } });
    expect(error?.statusCode).toBe(403);
  });
});

describe('3 · el tutor cambia su correo y se avisa a administración', () => {
  it('lo cambia y avisa en la campanita y por correo a superadmin y admin', async () => {
    const { error, cuerpo } = await llamar(authController.updateMyEmail, { body: { email: 'Juan@Nuevo.com' }, user: { userId: 21, role: 'tutor' } });
    expect(error?.message).toBeUndefined();
    expect(cuerpo.data).toMatchObject({ email: 'juan@nuevo.com', cambiado: true, hayQueVolverAEntrar: true });
    expect(notifyUsers).toHaveBeenCalledWith(expect.objectContaining({ type: 'tutor_correo_cambiado', targetUserIds: [1, 7] }));
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail.mock.calls[0][0].htmlContent).toMatch(/juan@viejo\.com/);
  });
  it('a administración solo le llegan los admin de algún campus del tutor (y los superadmin)', async () => {
    await llamar(authController.updateMyEmail, { body: { email: 'juan@nuevo.com' }, user: { userId: 21, role: 'tutor' } });
    const sql = consultas.find((c) => /u.role = 'superadmin'/.test(c.sql))?.sql || '';
    expect(sql).toMatch(/u.role = 'admin' AND EXISTS/);
    expect(sql).toMatch(/suyo.user_id = \$1/);
  });
  it('quien no es tutor no puede usar esta ruta (lo pide a administración)', async () => {
    for (const role of ['gestor', 'admin', 'superadmin']) {
      const { error } = await llamar(authController.updateMyEmail, { body: { email: 'x@nuevo.com' }, user: { userId: 9, role } });
      expect(error?.statusCode, role).toBe(403);
    }
  });
});
