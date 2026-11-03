import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #218, tanda 2 · Facturas con «Todos los proyectos».
 *
 * Sin campus ni empresa, la lista y las cifras decían «projectId requerido» y la
 * pantalla se quedaba tras el muro. Ahora: los campus de quien pide; super admin
 * y soporte, todos menos los de pruebas. Un campus ajeno sigue siendo 403.
 *
 *   npx vitest run tests/facturasTodos218.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/invoices/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `FT218${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], invoices: [] };
let MIO; let AJENO; let PRUEBAS; let ADMIN; let SUPER;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const deLaMarca = (r) => r.body.data.filter((f) => String(f.cliente_nombre).startsWith(MARCA)).map((f) => f.cliente_nombre).sort();

beforeAll(async () => {
  let n = 0;
  const campus = async (c, prueba = false) => {
    const p = await one(`INSERT INTO projects (nombre, slug, webhook_api_key, es_prueba) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-k-${c}`, prueba]);
    ids.projects.push(p.id);
    n += 1;
    const f = await one(
      `INSERT INTO invoices (project_id, ano, numero, codigo, cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais, items, base_imponible, total, estado)
       VALUES ($1, 2026, $2, $3, $4, 'X1234567L', 'Calle 1', 'Madrid', '28001', 'España', '[]'::jsonb, 100, 121, 'emitida') RETURNING id`,
      [p.id, 980000 + n + (Date.now() % 1000), `${MARCA}-${c}`, `${MARCA} ${c}`]);
    ids.invoices.push(f.id);
    return p.id;
  };
  MIO = await campus('mio'); AJENO = await campus('ajeno'); PRUEBAS = await campus('pruebas', true);
  const persona = async (c, role, suyos) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`, [`${MARCA} ${c}`, `${c}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const p of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, p]);
    return u;
  };
  ADMIN = await persona('admin', 'admin', [MIO]);
  SUPER = await persona('super', 'superadmin', []);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM invoices WHERE id = ANY($1::int[])', [ids.invoices]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
}, 60000);

describe('Facturas con «Todos los proyectos» (#218)', () => {
  it('un admin, sin campus: solo las de sus campus (antes, «projectId requerido»)', async () => {
    const r = await request.get('/api/invoices?tipo=normal&limit=200').set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(deLaMarca(r)).toEqual([`${MARCA} mio`]);
  });

  it('super admin, sin campus: las de todos menos las de pruebas', async () => {
    const r = await request.get('/api/invoices?tipo=normal&limit=200').set(como(SUPER));
    expect(r.status).toBe(200);
    expect(deLaMarca(r)).toEqual([`${MARCA} ajeno`, `${MARCA} mio`]);
  });

  it('las cifras, igual: sin campus ya no es un 400', async () => {
    expect((await request.get('/api/invoices/stats').set(como(ADMIN))).status).toBe(200);
    expect((await request.get('/api/invoices/stats').set(como(SUPER))).status).toBe(200);
  });

  it('un campus ajeno sigue siendo 403; el de pruebas, si se elige, se ve', async () => {
    expect((await request.get(`/api/invoices?projectId=${AJENO}`).set(como(ADMIN))).status).toBe(403);
    const r = await request.get(`/api/invoices?projectId=${PRUEBAS}&tipo=normal`).set(como(SUPER));
    expect(deLaMarca(r)).toEqual([`${MARCA} pruebas`]);
  });
});
