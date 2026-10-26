import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #423 · Las tres decisiones de Diego del 26/10, fijadas contra la base de verdad.
 *
 *   1. Su cuenta, «literalmente como superadmin, con soporte»: rol principal
 *      superadmin y soporte de rol de más. Lo puede todo —también dar permisos y
 *      cambiar el rol de otros, que a soporte se le quita— y su contraseña la
 *      sigue poniendo otro superadmin. A cualquier otra persona de soporte le vale
 *      la lista de Hugo: ni permisos de personas ni rol de otros.
 *   2. Los admin SIGUEN cambiando lo que trae cada rol y los roles a medida, pero
 *      nadie le pone a un rol lo que él no tiene.
 *   3. Soporte SIGUE dando de alta admins, gestoras y colaboradores.
 *
 * Gente propia, en un campus propio; se borra al acabar.
 */

vi.mock('../src/shared/services/brevo.service.js', async (original) => ({
  ...(await original()), sendWelcomeUserEmail: vi.fn(async () => ({ sent: true })),
}));

const { default: app } = await import('../src/app.js');
const { default: pool } = await import('../src/shared/config/db.js');
const { olvidarPermisos } = await import('../src/modules/permissions/permissions.service.js');
const { puedeDarDeAltaComoSoporte } = await import('../src/modules/permissions/permissions.editar.js');

const request = supertest(app);
const MARCA = `DEC423${Date.now().toString(36)}`;
const dominio = `${MARCA.toLowerCase()}.test`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const U = {};
const T = {};
let CAMPUS;

async function persona(clave, role, extra = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role, roles_extra) VALUES ($1, $2, 'x', $3, $4::user_role[])
     RETURNING id, email, role::text AS role`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}@${dominio}`, role, extra]);
  await q('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [u.id, CAMPUS]);
  U[clave] = u;
  T[clave] = jwt.sign({ userId: u.id, email: u.email, role, roles_extra: extra }, process.env.JWT_SECRET, { expiresIn: '1h' });
}
const como = (clave) => ({ Authorization: `Bearer ${T[clave]}` });
const rolDe = async (clave) => (await q(`SELECT role::text AS role FROM users WHERE id = $1`, [U[clave].id]))[0].role;

beforeAll(async () => {
  const [c] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`]);
  CAMPUS = c.id;
  await persona('diego', 'superadmin', ['soporte', 'colaborador']);
  await persona('carlos', 'superadmin');
  await persona('soporte', 'soporte');
  await persona('admin', 'admin');
  await persona('gestora', 'gestor');
  await persona('gestora2', 'gestor');
  olvidarPermisos();
}, 60000);

afterAll(async () => {
  const ids = (await q('SELECT id FROM users WHERE email LIKE $1', [`%@${dominio}`])).map((r) => r.id);
  await q('DELETE FROM role_permission_overrides WHERE updated_by = ANY($1::int[])', [ids]).catch(() => {});
  await q('DELETE FROM permisos_registro WHERE usuario_id = ANY($1::int[]) OR quien_id = ANY($1::int[])', [ids]).catch(() => {});
  await q('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [ids]);
  await q(`DELETE FROM user_activity_log WHERE user_id = ANY($1::int[]) OR (details->>'usuario_id')::int = ANY($1::int[])`, [ids]).catch(() => {});
  await q('DELETE FROM user_refresh_tokens WHERE user_id = ANY($1::int[])', [ids]).catch(() => {});
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  if (CAMPUS) await q('DELETE FROM projects WHERE id = $1', [CAMPUS]);
  await pool.end();
}, 60000);

describe('1 · Diego, superadmin con soporte (26/10)', () => {
  it('lo puede todo, también lo que es solo de soporte', async () => {
    const me = await request.get('/api/auth/me').set(como('diego'));
    expect(me.status, JSON.stringify(me.body)).toBe(200);
    const p = me.body.data.permissions;
    for (const k of ['roles.edit', 'users.excepciones', 'credentials.view', 'credentials.revelar', 'projects.create', 'installation.edit', 'leads.restaurar']) {
      expect(p[k], k).toBe(true);
    }
  });

  it('sigue con soporte de rol de más: guardarlo no se lo quita', async () => {
    const [u] = await q(`SELECT COALESCE(roles_extra::text[], '{}') AS extra FROM users WHERE id = $1`, [U.diego.id]);
    expect([...u.extra].sort()).toEqual(['colaborador', 'soporte']);
  });

  it('da permisos a una persona y le cambia el rol, que a soporte se le quita', async () => {
    const r = await request.put(`/api/permissions/personas/${U.gestora.id}/excepciones`).set(como('diego'))
      .send({ cambios: { 'leads.export': true } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const x = await request.patch(`/api/users/${U.gestora2.id}`).set(como('diego')).send({ role: 'admin' });
    expect(x.status, JSON.stringify(x.body)).toBe(200);
    expect(await rolDe('gestora2')).toBe('admin');
  });

  it('cambia lo que trae un rol', async () => {
    const r = await request.put('/api/permissions/roles/fijos/gestor').set(como('diego')).send({ permisos: { 'credentials.view': false } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it('su contraseña la pone otro superadmin; un admin, no', async () => {
    const pass = { password: 'Cambio-423-Segura!', confirmPassword: 'Cambio-423-Segura!' };
    expect((await request.patch(`/api/users/${U.diego.id}/password`).set(como('admin')).send(pass)).status).toBe(403);
    const r = await request.patch(`/api/users/${U.diego.id}/password`).set(como('carlos')).send(pass);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it('otra persona de soporte sigue la lista de Hugo: ni permisos de personas ni el rol de otros', async () => {
    expect((await request.put(`/api/permissions/personas/${U.gestora.id}/excepciones`).set(como('soporte'))
      .send({ cambios: { 'leads.export': false } })).status).toBe(403);
    expect((await request.patch(`/api/users/${U.gestora.id}`).set(como('soporte')).send({ role: 'admin' })).status).toBe(403);
    expect(await rolDe('gestora')).toBe('gestor');
  });
});

describe('2 · los admin siguen cambiando roles, sin dar lo que no tienen (26/10)', () => {
  it('cambia lo que trae un rol fijo con lo que él tiene', async () => {
    const r = await request.put('/api/permissions/roles/fijos/gestor').set(como('admin')).send({ permisos: { 'leads.export': true } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await request.put('/api/permissions/roles/fijos/gestor').set(como('admin')).send({ permisos: { 'leads.export': false } });
  });

  it('no le pone a un rol lo que él no tiene', async () => {
    const r = await request.put('/api/permissions/roles/fijos/gestor').set(como('admin')).send({ permisos: { 'projects.create': true } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('NO_LO_TIENES');
  });

  it('crea un rol a medida; soporte, no', async () => {
    const r = await request.post('/api/permissions/roles/a-medida').set(como('admin')).send({ nombre: `${MARCA} del admin`, base: 'gestor' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await q('DELETE FROM permisos_registro WHERE custom_role_id = $1', [r.body.data.id]).catch(() => {});
    await q('DELETE FROM custom_roles WHERE id = $1', [r.body.data.id]);
    expect((await request.post('/api/permissions/roles/a-medida').set(como('soporte')).send({ nombre: 'x', base: 'gestor' })).status).toBe(403);
  });
});

describe('3 · soporte sigue dando de alta admins, gestoras y colaboradores (26/10)', () => {
  const alta = (quien, role, nombre) => request.post('/api/users').set(como(quien))
    .send({ nombre: `${MARCA} ${nombre}`, email: `${nombre}@${dominio}`, role, projectIds: [CAMPUS] });

  it('da de alta a los tres', async () => {
    for (const [role, nombre] of [['admin', 'altaadmin'], ['gestor', 'altagestora'], ['colaborador', 'altacolab']]) {
      const r = await alta('soporte', role, nombre);
      expect(r.status, `${role}: ${JSON.stringify(r.body)}`).toBe(201);
    }
  });

  it('la regla, sin base: solo para el alta, solo esos roles y solo a quien tiene soporte', () => {
    const soporte = { userId: 1, role: 'soporte', roles_extra: [] };
    expect(puedeDarDeAltaComoSoporte(soporte, { role: 'admin' })).toBe(true);
    expect(puedeDarDeAltaComoSoporte(soporte, { role: 'gestor', roles_extra: ['colaborador'] })).toBe(true);
    expect(puedeDarDeAltaComoSoporte(soporte, { role: 'gestor', roles_extra: ['tutor'] })).toBe(false);
    expect(puedeDarDeAltaComoSoporte({ userId: 2, role: 'admin', roles_extra: [] }, { role: 'admin' })).toBe(false);
    expect(puedeDarDeAltaComoSoporte({ userId: 3, role: 'gestor', roles_extra: ['soporte'] }, { role: 'admin' })).toBe(true);
  });
});
