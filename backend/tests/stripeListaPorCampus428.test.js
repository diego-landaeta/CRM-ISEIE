import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #428 (2.ª parte) · La lista y las cifras de Pagos Stripe, solo con los campus
 * de quien pide.
 *
 * Probado en el staging de ISEIE el 18/11: un admin sin el campus recibía 200
 * con los cargos (importe, correo y nombre del cliente) y las cifras de ese
 * campus pidiéndolo por `projectId`, mientras `/leads` del mismo campus le daba
 * 403. Ahora: un campus ajeno es 403 y, sin pedir ninguno, solo los suyos.
 *
 *   npx vitest run tests/stripeListaPorCampus428.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { default: modulo } = await import('../src/modules/stripe-payments/index.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `SL428${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
let SUPER; let ADMIN; let MIO; let AJENO;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const correos = (r) => (r.body.data || []).map((c) => c.customer_email);

beforeAll(async () => {
  const campus = async (c) => {
    const p = await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-k-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  MIO = await campus('mio'); AJENO = await campus('ajeno');
  const persona = async (c, role, suyos) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
      [`${MARCA} ${c}`, `${c}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const p of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, p]);
    return u;
  };
  SUPER = await persona('super', 'superadmin', []);
  ADMIN = await persona('admin', 'admin', [MIO]);
  for (const [p, c] of [[MIO, 'mio'], [AJENO, 'ajeno']]) {
    await q(`INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, customer_email, stripe_created_at)
             VALUES ($1, $2, 'charge', 'succeeded', 50, 'EUR', $3, NOW())`,
    [p, `ch_${MARCA}_${c}`, `${c}.${MARCA.toLowerCase()}@prueba.test`]);
  }
}, 60000);

afterAll(async () => {
  for (const [sql, v] of [
    ['DELETE FROM stripe_payments WHERE project_id = ANY($1::int[])', ids.projects],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', ids.users],
    ['DELETE FROM users WHERE id = ANY($1::int[])', ids.users],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', ids.projects],
  ]) {
    try { await q(sql, [v]); } catch { /* sigue limpiando */ }
  }
  await pool.end();
}, 60000);

describe('#428 · la lista y las cifras, solo de sus campus', () => {
  it('la lista de un campus ajeno: 403 y ningún cargo', async () => {
    const r = await request.get(`/api/stripe-payments?projectId=${AJENO}&limit=5`).set(como(ADMIN));
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain('ajeno.');
  });

  it('las cifras de un campus ajeno: 403', async () => {
    const r = await request.get(`/api/stripe-payments/stats?projectId=${AJENO}`).set(como(ADMIN));
    expect(r.status).toBe(403);
  });

  it('su campus, sí: su cargo y no el ajeno', async () => {
    const r = await request.get(`/api/stripe-payments?projectId=${MIO}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(correos(r)).toContain(`mio.${MARCA.toLowerCase()}@prueba.test`);
    expect(correos(r)).not.toContain(`ajeno.${MARCA.toLowerCase()}@prueba.test`);
    const s = await request.get(`/api/stripe-payments/stats?projectId=${MIO}`).set(como(ADMIN));
    expect(s.status).toBe(200);
  });

  it('sin pedir campus: solo los suyos', async () => {
    const r = await request.get('/api/stripe-payments?limit=200&search=' + MARCA.toLowerCase()).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(correos(r)).not.toContain(`ajeno.${MARCA.toLowerCase()}@prueba.test`);
  });

  it('super admin, el que pida', async () => {
    const r = await request.get(`/api/stripe-payments?projectId=${AJENO}`).set(como(SUPER));
    expect(r.status).toBe(200);
    expect(correos(r)).toContain(`ajeno.${MARCA.toLowerCase()}@prueba.test`);
  });
});
