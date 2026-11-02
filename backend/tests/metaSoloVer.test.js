import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool from '../src/shared/config/db.js';

/**
 * Meta Ads, solo ver, para el equipo de desarrollo (Diego, 26/10/2026: «en Meta tendrán
 * acceso Ruth, Julián, Jesús, Emmanuel —solo CEDIA él—; en ISEIE, Jonathan y Gustavo»),
 * contra la base de verdad: con `meta_ads.view` ve la de SUS campus; configurar sigue
 * siendo del admin; sin el permiso, nada; y lo demás del CRM, cerrado igual.
 *
 *   cd backend && npx vitest run tests/metaSoloVer.test.js
 */
const request = supertest(app);
const MARCA = `META_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];
const U = {};
const T = {};
const P = {};
const ids = { projects: [] };

async function persona(clave, role, { campus = [], meta = false } = {}) {
  const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, email`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}_${MARCA.toLowerCase()}@test.local`, role]);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, P[c]]);
  if (meta) await q(`INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, 'meta_ads', 'view', true)`, [u.id]);
  U[clave] = u;
  T[clave] = jwt.sign({ userId: u.id, email: u.email, role, roles_extra: [], customRoleId: null }, process.env.JWT_SECRET, { expiresIn: '1h' });
}
const como = (c) => ({ Authorization: `Bearer ${T[c]}` });

beforeAll(async () => {
  for (const c of ['A', 'D']) {
    const p = await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c.toLowerCase()}`, `${MARCA}-${c}`]);
    ids.projects.push(p.id);
    P[c] = p.id;
  }
  await persona('conMeta', 'colaborador', { campus: ['A'], meta: true });
  await persona('sinMeta', 'colaborador', { campus: ['A'] });
  await persona('adminA', 'admin', { campus: ['A'] });
});

afterAll(async () => {
  const us = Object.values(U).map((u) => u.id);
  await q('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [us]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
}, 60000);

describe('Meta Ads, solo ver', () => {
  it('con meta_ads.view ve la de su campus: 200', async () => {
    const r = await request.get(`/api/meta-ads/accounts?projectId=${P.A}`).set(como('conMeta'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it('de un campus que no es suyo: 403 (y para un admin, igual)', async () => {
    expect((await request.get(`/api/meta-ads/accounts?projectId=${P.D}`).set(como('conMeta'))).status).toBe(403);
    expect((await request.get(`/api/meta-ads/accounts?projectId=${P.D}`).set(como('adminA'))).status).toBe(403);
    expect((await request.get(`/api/meta-ads/accounts?projectId=${P.A}`).set(como('adminA'))).status).toBe(200);
  });

  it('configurar (conectar, sincronizar, asociar) sigue siendo del admin: 403', async () => {
    expect((await request.post('/api/meta-ads/connect').set(como('conMeta'))
      .send({ project_id: P.A, ad_account_id: 'act_1', access_token: 'x' })).status).toBe(403);
    expect((await request.post('/api/meta-ads/associations').set(como('conMeta'))
      .send({ project_id: P.A, campaign_id: '1', product_ids: [] })).status).toBe(403);
    expect((await request.post('/api/meta-ads/accounts/1/sync').set(como('conMeta'))).status).toBe(403);
  });

  it('sin el permiso, nada; y prospectos, ventas y facturas siguen cerrados', async () => {
    expect((await request.get(`/api/meta-ads/accounts?projectId=${P.A}`).set(como('sinMeta'))).status).toBe(403);
    for (const ruta of ['/api/leads', '/api/conversions', '/api/invoices']) {
      expect((await request.get(ruta).set(como('conMeta'))).status, ruta).toBe(403);
    }
  });

  it('/auth/me le dice al frontal quién tiene Meta', async () => {
    expect((await request.get('/api/auth/me').set(como('conMeta'))).body.data.permissions['meta_ads.view']).toBe(true);
    expect((await request.get('/api/auth/me').set(como('sinMeta'))).body.data.permissions['meta_ads.view']).toBe(false);
  });
});
