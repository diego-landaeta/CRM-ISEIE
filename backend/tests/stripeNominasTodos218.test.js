import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #218, tanda 2 · Pagos Stripe y Nóminas con «Todos los proyectos».
 *
 * A super admin y soporte, sin campus, el servidor les decía «projectId
 * requerido» (a un admin ya le recortaba a los suyos). Ahora: todos los campus
 * menos los de pruebas, con `campusDeTodos`.
 *
 * En ISEIE solo Nóminas: el módulo de Pagos Stripe de ISEIE es otro (sin la #44 ni
 * «Todos» en su modelo) y esa parte de la tanda 2 no se portó en la 2.6.0.
 *
 *   npx vitest run tests/stripeNominasTodos218.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { campusDeTodos } = await import('../src/shared/utils/ambito.js');
const modulos = await Promise.all(['payroll'].map((m) => import(`../src/modules/${m}/index.js`).then((x) => x.default)));

const app = express();
app.use(express.json());
for (const m of modulos) app.use(m.prefix, m.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `SN218${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
let SUPER; let ADMIN; let MIO; let PRUEBAS;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

beforeAll(async () => {
  const campus = async (c, prueba = false) => {
    const p = await one(`INSERT INTO projects (nombre, slug, webhook_api_key, es_prueba) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-k-${c}`, prueba]);
    ids.projects.push(p.id);
    return p.id;
  };
  MIO = await campus('mio'); PRUEBAS = await campus('pruebas', true);
  const persona = async (c, role, suyos) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`, [`${MARCA} ${c}`, `${c}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const p of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, p]);
    return u;
  };
  SUPER = await persona('super', 'superadmin', []);
  ADMIN = await persona('admin', 'admin', [MIO]);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
}, 60000);

describe('campusDeTodos', () => {
  it('a un admin, sus campus; a super admin, todos los activos menos los de pruebas', async () => {
    expect(await campusDeTodos({ user: { userId: ADMIN.id, role: 'admin' } })).toEqual([MIO]);
    const todos = await campusDeTodos({ user: { userId: SUPER.id, role: 'superadmin' } });
    expect(todos).toContain(MIO);
    expect(todos).not.toContain(PRUEBAS);
  });
});

describe('sin campus ya no es «projectId requerido» (#218)', () => {
  it.each([
    ['Nóminas, los planes', '/api/payroll/plans'],
  ])('%s, como super admin', async (_n, ruta) => {
    const r = await request.get(ruta).set(como(SUPER));
    expect(r.status).toBe(200);
  });

  it('y a un admin, como ya era', async () => {
    expect((await request.get('/api/payroll/plans').set(como(ADMIN))).status).toBe(200);
  });
});
