import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Las metas de ventas, solo dentro de tus campus (IDOR de `/api/ventas/goals`).
 *
 * Antes:
 *   · crear o borrar una meta no pedía ningún rol: un tutor o soporte podía fijar o
 *     borrar la meta de cualquiera (el `else` de `deleteGoal` borraba por id sin mirar);
 *   · un admin de un campus podía fijar o borrar la meta de otro campus, de otra empresa,
 *     cambiando el `user_id`, el `project_id` o el id de la URL.
 *
 *   npx vitest run tests/metasAmbito.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/sales/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `MET${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [] };
let P; let OTRO; let SUPER; let ADMIN; let ADMIN_OTRO; let GESTORA; let GESTORA_OTRO; let TUTOR; let SOPORTE;

const como = (u, rol = u.role) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: rol }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

async function persona(n, role, campus = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, c]);
  return u;
}

/** Una meta puesta directamente en la base, para borrarla por la API. */
const meta = async (userId, projectId, periodo = '2030-01') => (await q(
  `INSERT INTO sales_goals (user_id, project_id, periodo_yyyymm, meta_ventas, meta_facturacion, set_by_user_id)
   VALUES ($1, $2, $3, 5, 1000, $1) RETURNING id`, [userId, projectId, periodo]))[0].id;
const existe = async (id) => (await q(`SELECT 1 FROM sales_goals WHERE id = $1`, [id])).length === 1;
const cuerpo = (userId, projectId, periodo = '2030-02') => ({ user_id: userId, project_id: projectId, periodo_yyyymm: periodo, meta_ventas: 3, meta_facturacion: 900 });

beforeAll(async () => {
  const proy = async (c) => {
    const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  P = await proy('a'); OTRO = await proy('b');
  SUPER = await persona('SUPER', 'superadmin');
  ADMIN = await persona('ADMIN', 'admin', [P]);
  ADMIN_OTRO = await persona('ADMINOTRO', 'admin', [OTRO]);
  GESTORA = await persona('GESTORA', 'gestor', [P]);
  GESTORA_OTRO = await persona('GESTORAOTRO', 'gestor', [OTRO]);
  TUTOR = await persona('TUTOR', 'tutor', [P]);
  SOPORTE = await persona('SOPORTE', 'soporte', [P]);
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM sales_goals WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

describe('quién puede tocar metas', () => {
  it('un tutor o soporte no puede ni fijar ni borrar una meta (el rol no vale)', async () => {
    const id = await meta(GESTORA.id, P);
    for (const quien of [TUTOR, SOPORTE]) {
      expect((await request.post(`${modulo.prefix}/goals`).set(como(quien)).send(cuerpo(GESTORA.id, P, '2029-01'))).status).toBe(403);
      expect((await request.delete(`${modulo.prefix}/goals/${id}`).set(como(quien))).status).toBe(403);
    }
    expect(await q(`SELECT 1 FROM sales_goals WHERE periodo_yyyymm = '2029-01'`)).toHaveLength(0);
    expect(await existe(id)).toBe(true);
  });
});

describe('un admin, solo en sus campus', () => {
  it('fija la meta de una gestora de su campus', async () => {
    const r = await request.post(`${modulo.prefix}/goals`).set(como(ADMIN)).send(cuerpo(GESTORA.id, P));
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ user_id: GESTORA.id, project_id: P });
  });

  it('no fija la meta de una gestora de OTRO campus', async () => {
    const r = await request.post(`${modulo.prefix}/goals`).set(como(ADMIN)).send(cuerpo(GESTORA_OTRO.id, OTRO, '2030-03'));
    expect(r.status).toBe(403);
    expect(await q(`SELECT 1 FROM sales_goals WHERE user_id = $1`, [GESTORA_OTRO.id])).toHaveLength(0);
  });

  it('ni la de su gestora pero en un campus que no es suyo', async () => {
    expect((await request.post(`${modulo.prefix}/goals`).set(como(ADMIN)).send(cuerpo(GESTORA.id, OTRO, '2030-04'))).status).toBe(403);
  });

  it('ni una meta «de todos los campus» para alguien con quien no comparte ninguno', async () => {
    expect((await request.post(`${modulo.prefix}/goals`).set(como(ADMIN)).send(cuerpo(GESTORA_OTRO.id, null, '2030-05'))).status).toBe(403);
  });

  it('borra una meta de su campus', async () => {
    const id = await meta(GESTORA.id, P, '2030-06');
    expect((await request.delete(`${modulo.prefix}/goals/${id}`).set(como(ADMIN))).status).toBe(200);
    expect(await existe(id)).toBe(false);
  });

  it('una meta de otro campus es «no encontrada», y sigue ahí', async () => {
    const id = await meta(GESTORA_OTRO.id, OTRO, '2030-07');
    const r = await request.delete(`${modulo.prefix}/goals/${id}`).set(como(ADMIN));
    expect(r.status).toBe(404);
    expect(await existe(id)).toBe(true);
  });
});

describe('una gestora, solo lo suyo', () => {
  it('fija y borra la suya', async () => {
    expect((await request.post(`${modulo.prefix}/goals`).set(como(GESTORA)).send(cuerpo(GESTORA.id, P, '2030-08'))).status).toBe(201);
    const id = await meta(GESTORA.id, P, '2030-09');
    expect((await request.delete(`${modulo.prefix}/goals/${id}`).set(como(GESTORA))).status).toBe(200);
  });

  it('no la de otra, ni siquiera de su mismo campus', async () => {
    const otra = await persona('GESTORA2', 'gestor', [P]);
    expect((await request.post(`${modulo.prefix}/goals`).set(como(GESTORA)).send(cuerpo(otra.id, P, '2030-10'))).status).toBe(403);
    const id = await meta(otra.id, P, '2030-11');
    expect((await request.delete(`${modulo.prefix}/goals/${id}`).set(como(GESTORA))).status).toBe(404);
    expect(await existe(id)).toBe(true);
  });

  it('no fija su meta en un campus donde no trabaja', async () => {
    expect((await request.post(`${modulo.prefix}/goals`).set(como(GESTORA)).send(cuerpo(GESTORA.id, OTRO, '2030-12'))).status).toBe(403);
  });
});

describe('el superadmin, en todos', () => {
  it('fija y borra en cualquier campus', async () => {
    const r = await request.post(`${modulo.prefix}/goals`).set(como(SUPER)).send(cuerpo(GESTORA_OTRO.id, OTRO, '2031-01'));
    expect(r.status).toBe(201);
    expect((await request.delete(`${modulo.prefix}/goals/${r.body.data.id}`).set(como(SUPER))).status).toBe(200);
  });

  it('y el admin del otro campus, solo en el suyo (el espejo)', async () => {
    const id = await meta(GESTORA.id, P, '2031-02');
    expect((await request.delete(`${modulo.prefix}/goals/${id}`).set(como(ADMIN_OTRO))).status).toBe(404);
    expect(await existe(id)).toBe(true);
  });
});
