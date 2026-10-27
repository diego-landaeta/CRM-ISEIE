import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #423, QA de Diego (22/10) · punto 7. «Escalada en PATCH /users/:id: al
 * cambiar el rol se puede dar más de lo que tiene quien lo cambia. Nadie puede
 * dar un rol o permiso que no tenga.» Un admin le ponía a una gestora de su
 * campus el rol de soporte (las credenciales, crear campus…), que él no tiene.
 * Lo mismo al dar de alta. Lo que es solo sobre lo suyo (sus cursos, su
 * factura) no cuenta: un admin sigue dando de alta a un tutor.
 *
 * Contra la base de verdad, con gente propia y sin superadmin (QA, punto 9).
 */

vi.mock('../src/shared/services/brevo.service.js', async (original) => ({
  ...(await original()), sendWelcomeUserEmail: vi.fn(async () => ({ sent: true })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const { default: usuarios } = await import('../src/modules/users/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { olvidarPermisos } = await import('../src/modules/permissions/permissions.service.js');

const app = express();
app.use(express.json());
app.use(usuarios.prefix, usuarios.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `ESC423${Date.now().toString(36)}`;
const dominio = `${MARCA.toLowerCase()}.test`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
let CAMPUS;
const U = {};

async function persona(nombre, role, extra = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role, roles_extra) VALUES ($1, $2, 'x', $3, $4::user_role[])
     RETURNING id, role::text AS role`,
    [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${dominio}`, role, extra]);
  await q('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [u.id, CAMPUS]);
  return u;
}
const rolDe = async (u) => (await q(`SELECT role::text AS role, COALESCE(roles_extra::text[], '{}') AS extra FROM users WHERE id = $1`, [u.id]))[0];

beforeAll(async () => {
  const [c] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`]);
  CAMPUS = c.id;
  U.admin = await persona('Admin', 'admin');
  U.soporte = await persona('Soporte', 'soporte');
  U.gestora = await persona('Gestora', 'gestor');
  U.otra = await persona('Otra', 'gestor');
  U.doble = await persona('Doble', 'gestor', ['tutor']);
  olvidarPermisos();
}, 60000);

afterAll(async () => {
  const ids = (await q('SELECT id FROM users WHERE email LIKE $1', [`%@${dominio}`])).map((r) => r.id);
  await q('DELETE FROM permisos_registro WHERE usuario_id = ANY($1::int[])', [ids]).catch(() => {});
  await q(`DELETE FROM user_activity_log WHERE user_id = ANY($1::int[]) OR (details->>'usuario_id')::int = ANY($1::int[])`, [ids]);
  await q('DELETE FROM tutor_profiles WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  if (CAMPUS) await q('DELETE FROM projects WHERE id = $1', [CAMPUS]);
  await pool.end();
}, 60000);

describe('nadie da lo que no tiene, al cambiar el rol (#423, punto 7)', () => {
  it('un admin no le pone a una gestora el rol de soporte', async () => {
    const r = await request.patch(`/api/users/${U.gestora.id}`).set(como(U.admin)).send({ role: 'soporte' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('NO_LO_TIENES');
    expect((await rolDe(U.gestora)).role).toBe('gestor');
  });

  it('ni como rol de más', async () => {
    const r = await request.patch(`/api/users/${U.gestora.id}`).set(como(U.admin)).send({ roles_extra: ['soporte'] });
    expect(r.status).toBe(403);
    expect((await rolDe(U.gestora)).extra).toEqual([]);
  });

  it('sí la hace tutora: lo del tutor es solo sobre lo suyo', async () => {
    const r = await request.patch(`/api/users/${U.otra.id}`).set(como(U.admin)).send({ role: 'tutor' });
    expect(r.status).toBe(200);
    expect((await rolDe(U.otra)).role).toBe('tutor');
  });

  it('quitar no es dar: le quita el rol de más que el admin no tiene', async () => {
    const r = await request.patch(`/api/users/${U.doble.id}`).set(como(U.admin)).send({ roles_extra: [] });
    expect(r.status).toBe(200);
    expect((await rolDe(U.doble)).extra).toEqual([]);
  });
});

describe('ni al dar de alta (#423, punto 7)', () => {
  const alta = (quien, role, nombre) => request.post('/api/users').set(como(quien))
    .send({ nombre: `${MARCA} ${nombre}`, email: `${nombre}@${dominio}`, role, projectIds: [CAMPUS] });

  it('un admin no da de alta a alguien de soporte', async () => {
    const r = await alta(U.admin, 'soporte', 'nuevosoporte');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('NO_LO_TIENES');
    expect(await q('SELECT 1 FROM users WHERE email = $1', [`nuevosoporte@${dominio}`])).toEqual([]);
  });

  // Diego, 26/10 (decisión 3): «soporte SIGUE pudiendo dar de alta admins,
  // gestoras y colaboradores, como hasta hoy».
  it('soporte sí da de alta a un admin, a una gestora y a un colaborador', async () => {
    for (const [role, nombre] of [['admin', 'nuevoadmin'], ['gestor', 'nuevagestorasop'], ['colaborador', 'nuevocolab']]) {
      const r = await alta(U.soporte, role, nombre);
      expect(r.status, `${role}: ${JSON.stringify(r.body)}`).toBe(201);
      expect((await q('SELECT role::text AS role FROM users WHERE email = $1', [`${nombre}@${dominio}`]))[0]?.role).toBe(role);
    }
  });

  it('pero no le cambia el rol a quien ya existe (eso es «Permisos de cada persona»)', async () => {
    const r = await request.patch(`/api/users/${U.otra.id}`).set(como(U.soporte)).send({ role: 'admin' });
    expect(r.status).toBe(403);
    expect((await rolDe(U.otra)).role).not.toBe('admin');
  });

  it('un admin sí da de alta a una gestora y a un tutor', async () => {
    expect((await alta(U.admin, 'gestor', 'nuevagestora')).status).toBe(201);
    expect((await alta(U.admin, 'tutor', 'nuevotutor')).status).toBe(201);
  });
});
