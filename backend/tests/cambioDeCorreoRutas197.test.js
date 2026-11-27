import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';

/**
 * #197 (gemela de CRM#211) · Las rutas del correo con código, contra la base real.
 *
 *  - «Mi perfil»: POST /auth/me/email/codigo (con la contraseña actual) y
 *    PATCH /auth/me/email (con el código). Sin el código bueno no cambia nada.
 *  - Administración (Diego, 06/11, #688): el superadmin cambia el correo de
 *    otra persona al momento y sin código, como antes; y eso anula el código
 *    que la persona tuviera pendiente.
 *  - Un tutor, con el freno puesto: no se le manda el código, y se le dice.
 *
 * El correo no sale: Brevo está simulado y guarda el código, para meterlo como
 * lo haría la persona.
 */

const enviados = vi.hoisted(() => []);
vi.mock('../src/shared/services/brevo.service.js', async (original) => ({
  ...(await original()),
  sendCodigoCambioCorreoEmail: vi.fn(async (m) => { enviados.push(m); return { sent: true }; }),
  sendCorreoCambiadoEmail: vi.fn(async () => ({ sent: true })),
  sendWelcomeUserEmail: vi.fn(async () => ({ sent: true })),
  sendEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');
const { default: pool } = await import('../src/shared/config/db.js');
const authController = await import('../src/modules/auth/auth.controller.js');
const userController = await import('../src/modules/users/user.controller.js');

const MARCA = `R197${Date.now().toString(36)}`.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = [];
let ANA; let SUPER; let TUTOR;
const CLAVE = 'Clave-de-prueba-197';
const correoDe = async (id) => (await one('SELECT email FROM users WHERE id = $1', [id])).email;
const ultimo = () => enviados[enviados.length - 1];

const llamar = async (fn, req) => {
  let error = null; let cuerpo = null;
  await fn({ ip: '1.1.1.1', headers: {}, socket: {}, params: {}, ...req }, { json: (b) => { cuerpo = b; }, status() { return this; } }, (e) => { error = e; });
  // El código sale sin esperar (revisión de Diego, #688): se deja correr la cola.
  await new Promise((ok) => setImmediate(ok));
  return { error, cuerpo };
};

beforeAll(async () => {
  const hash = await bcrypt.hash(CLAVE, 4);
  const persona = async (n, role) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${MARCA} ${n}`, `${n}@${MARCA}.test`, hash, role]);
    ids.push(u.id);
    return u.id;
  };
  ANA = await persona('ana', 'gestor');
  // En la base NO es superadmin: los permisos de la prueba salen de `registrar`
  // (elSuper), y un superadmin de verdad que aparece y desaparece a mitad rompe
  // a otras pruebas que corren a la vez y cuentan los de la base
  // (certifexDiplomas, CI de la #731).
  SUPER = await persona('super', 'gestor');
  TUTOR = await persona('tutor', 'tutor');
}, 60000);

beforeEach(async () => {
  enviados.length = 0;
  await q('UPDATE users SET email = $2 WHERE id = $1', [ANA, `ana@${MARCA}.test`]);
  await q('DELETE FROM cambios_de_correo WHERE user_id = $1', [ANA]);
});

afterAll(async () => {
  await q('DELETE FROM cambios_de_correo WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM refresh_tokens WHERE user_id = ANY($1::int[])', [ids]).catch(() => {});
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  await pool.end();
});

const NUEVO = `ana.nueva@${MARCA}.test`;
const yo = () => registrar({ userId: ANA, role: 'gestor' });
const elSuper = () => registrar({ userId: SUPER, role: 'superadmin' });

describe('#197 (CRM#211) · «Mi perfil»: el correo propio con código', () => {
  it('con la contraseña mal, ni código ni cambio', async () => {
    const { error } = await llamar(authController.pedirCodigoMiCorreo, { body: { email: NUEVO, password: 'otra' }, user: yo() });
    expect(error?.code).toBe('INVALID_CURRENT_PASSWORD');
    expect(enviados).toHaveLength(0);
  });

  it('con la contraseña bien, el código va a la dirección NUEVA y todavía no cambia', async () => {
    const { error, cuerpo } = await llamar(authController.pedirCodigoMiCorreo, { body: { email: NUEVO, password: CLAVE }, user: yo() });
    expect(error?.message).toBeUndefined();
    expect(cuerpo.data).toMatchObject({ email: NUEVO, enviado: true, minutos: 15 });
    expect(ultimo().a).toBe(NUEVO);
    expect(await correoDe(ANA)).toBe(`ana@${MARCA}.test`);
  });

  it('con el código bueno cambia; con uno malo, no', async () => {
    await llamar(authController.pedirCodigoMiCorreo, { body: { email: NUEVO, password: CLAVE }, user: yo() });
    const malo = ultimo().codigo === '000000' ? '111111' : '000000';
    const mal = await llamar(authController.updateMyEmail, { body: { codigo: malo }, user: yo() });
    expect(mal.error?.code).toBe('CODIGO_INCORRECTO');
    expect(await correoDe(ANA)).toBe(`ana@${MARCA}.test`);

    const bien = await llamar(authController.updateMyEmail, { body: { codigo: ultimo().codigo }, user: yo() });
    expect(bien.error?.message).toBeUndefined();
    expect(bien.cuerpo.data).toMatchObject({ email: NUEVO, cambiado: true, hayQueVolverAEntrar: true });
    expect(await correoDe(ANA)).toBe(NUEVO);
  });

  it('el correo ya no se cambia sin código: un `email` suelto no vale', async () => {
    const { error } = await llamar(authController.updateMyEmail, { body: { email: NUEVO }, user: yo() });
    expect(error?.code).toBe('VALIDATION_ERROR');
    expect(await correoDe(ANA)).toBe(`ana@${MARCA}.test`);
  });
});

describe('#197 (CRM#211) · administración: el superadmin, sin código y al momento (Diego, 06/11, #688)', () => {
  it('cambia el correo de otra persona al guardar, sin mandar ningún código', async () => {
    const { error } = await llamar(userController.update, { params: { id: String(ANA) }, body: { email: NUEVO }, user: elSuper() });
    expect(error?.message).toBeUndefined();
    expect(await correoDe(ANA)).toBe(NUEVO);
    expect(enviados).toHaveLength(0);
  });

  it('y anula el código que la persona tuviera pendiente: meterlo después no deshace el cambio', async () => {
    await llamar(authController.pedirCodigoMiCorreo, { body: { email: `otra.mia@${MARCA}.test`, password: CLAVE }, user: yo() });
    await new Promise((ok) => setImmediate(ok));
    const suyo = ultimo().codigo;
    await llamar(userController.update, { params: { id: String(ANA) }, body: { email: NUEVO }, user: elSuper() });
    const { error } = await llamar(authController.updateMyEmail, { body: { codigo: suyo }, user: yo() });
    expect(error?.code).toBe('SIN_CODIGO');
    expect(await correoDe(ANA)).toBe(NUEVO);
  });
});

describe('#197 (CRM#211) · «Mi perfil» de un tutor, con el freno puesto (Diego, 06/11, #688)', () => {
  it('pedir el código no da error: dice por qué no se manda, y no se manda', async () => {
    const { error, cuerpo } = await llamar(authController.pedirCodigoMiCorreo, { body: { email: `tutor.nuevo@${MARCA}.test`, password: CLAVE }, user: registrar({ userId: TUTOR, role: 'tutor' }) });
    expect(error?.message).toBeUndefined();
    expect(cuerpo.data).toMatchObject({ frenado: true, enviado: false });
    expect(cuerpo.data.motivo).toMatch(/administración/);
    expect(enviados).toHaveLength(0);
  });

  it('/auth/me se lo dice a la pantalla de entrada; a quien no es tutor, no', async () => {
    const tutor = await llamar(authController.me, { user: registrar({ userId: TUTOR, role: 'tutor' }) });
    expect(tutor.cuerpo.data.user.correo_propio_frenado).toMatch(/administración/);
    const ana = await llamar(authController.me, { user: yo() });
    expect(ana.cuerpo.data.user.correo_propio_frenado).toBeNull();
  });
});
