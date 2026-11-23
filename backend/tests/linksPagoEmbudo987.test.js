import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * El embudo de los links de pago (CRM#987; Diego, 21/11/2026).
 *
 *   · por gestora y por campus: creados, abiertos y pagados en el periodo, con
 *     su % y lo cobrado por esos links; y las cuotas del cobro automático que
 *     vencen en el periodo: cobradas solas, fallidas y pendientes;
 *   · con el ámbito de siempre: la gestora ve lo suyo; con «ver todos», lo de sus
 *     campus; nunca lo de otro campus;
 *   · el periodo manda: lo de otro mes no cuenta; fechas mal puestas, 400.
 *
 *   npx vitest run tests/linksPagoEmbudo987.test.js
 */

process.env.LOG_LEVEL = 'silent';
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { default: linksPago } = await import('../src/modules/links-pago/index.js');
const { agrupar } = await import('../src/modules/links-pago/links-pago.embudo.js');

const app = express();
app.use(express.json());
app.use(linksPago.prefix, linksPago.router);
app.use(errorHandler);
const api = supertest(app);

const MARCA = `LP987${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], leads: [], products: [], conversions: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
let A; let B; let curso;
const p = {};
let n = 0;

async function link(creador, { campus = A, estado = 'creado', abierto = false, cobrado = null, devuelto = null, fecha = '2026-11-10' } = {}) {
  n += 1;
  const l = await one(
    `INSERT INTO payment_links (project_id, product_id, created_by, importe, moneda, estado, url, created_at, caduca_el, abierto_el, pagado_el)
     VALUES ($1, $2, $3, 500, 'EUR', $4::varchar, $5, $6::timestamptz, $6::timestamptz + INTERVAL '7 days',
             CASE WHEN $7::boolean THEN $6::timestamptz ELSE NULL END, CASE WHEN $4::varchar = 'pagado' THEN $6::timestamptz ELSE NULL END)
     RETURNING id`,
    [campus, curso, creador.id, estado, `https://buy.stripe.com/test_987_${n}`, `${fecha}T10:00:00+01:00`, abierto]);
  if (cobrado) {
    await q(`INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, stripe_created_at, payment_link_id, refunded, refunded_amount)
             VALUES ($1, $2, 'payment_intent', 'succeeded', $3, 'EUR', NOW(), $4, $5, $6)`,
    [campus, `pi_987_${MARCA}_${n}`, cobrado, l.id, devuelto != null, devuelto]);
  }
  return l.id;
}

beforeAll(async () => {
  const campus = async (x) => {
    const r = await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${x}`, `${MARCA.toLowerCase()}-${x}`, `${MARCA}-k-${x}`]);
    ids.projects.push(r.id);
    return r.id;
  };
  A = await campus('a');
  B = await campus('b');
  const persona = async (x, role, suyos) => {
    const u = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', $3) RETURNING id, role, nombre',
      [`${MARCA} ${x}`, `${x}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  p.g1 = await persona('gestora-1', 'gestor', [A]);
  p.g2 = await persona('gestora-2', 'gestor', [A]);
  p.gB = await persona('gestora-b', 'gestor', [B]);
  p.admin = await persona('admin', 'admin', [A]);
  curso = (await one('INSERT INTO products (project_id, nombre, precio) VALUES ($1, $2, 500) RETURNING id', [A, `${MARCA} curso`])).id;
  ids.products.push(curso);

  // Gestora 1: 4 en noviembre (uno abierto, uno pagado con 500 € y otro pagado con 300 €) y uno de octubre.
  await link(p.g1);
  await link(p.g1, { estado: 'abierto', abierto: true });
  await link(p.g1, { estado: 'pagado', cobrado: 500 });
  await link(p.g1, { estado: 'pagado', cobrado: 300 });
  await link(p.g1, { fecha: '2026-10-20', estado: 'pagado', cobrado: 999 });
  // Gestora 2: uno caducado que se llegó a abrir y uno pagado (200 €) con 50 € devueltos.
  await link(p.g2, { estado: 'caducado', abierto: true });
  await link(p.g2, { estado: 'pagado', cobrado: 200, devuelto: 50 });
  // Otro campus.
  await link(p.gB, { campus: B, estado: 'pagado', cobrado: 700 });

  // Las cuotas del cobro automático de una venta de la gestora 1.
  const lead = (await one('INSERT INTO leads (project_id, nombre, responsable_id) VALUES ($1, $2, $3) RETURNING id', [A, `${MARCA} lead`, p.g1.id])).id;
  ids.leads.push(lead);
  const venta = (await one(`INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, vendedora_id)
                            VALUES ($1, $2, $5, $3, 500, $4) RETURNING id`, [lead, A, curso, p.g1.id, `${MARCA} curso`])).id;
  ids.conversions.push(venta);
  const cuotas = [['2026-11-05', 'cobrada'], ['2026-11-15', 'fallida'], ['2026-11-25', 'programada'], ['2026-11-26', 'quitada'], ['2026-12-05', 'programada']];
  for (const [i, [vence, estado]] of cuotas.entries()) {
    const ci = await one('INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento) VALUES ($1, $2, 100, $3) RETURNING id',
      [venta, i + 1, vence]);
    await q('INSERT INTO cobro_auto_cuotas (installment_id, conversion_id, project_id, estado, fecha_programada) VALUES ($1, $2, $3, $4, $5)',
      [ci.id, venta, A, estado, vence]);
  }
  // Una venta sin vendedora: sus cuotas cuentan para la responsable de la ficha (gestora 2).
  const lead2 = (await one('INSERT INTO leads (project_id, nombre, responsable_id) VALUES ($1, $2, $3) RETURNING id', [A, `${MARCA} lead 2`, p.g2.id])).id;
  ids.leads.push(lead2);
  const venta2 = (await one(`INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total)
                             VALUES ($1, $2, $4, $3, 300) RETURNING id`, [lead2, A, curso, `${MARCA} curso`])).id;
  ids.conversions.push(venta2);
  const ci2 = await one('INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento) VALUES ($1, 1, 100, $2) RETURNING id',
    [venta2, '2026-11-12']);
  await q('INSERT INTO cobro_auto_cuotas (installment_id, conversion_id, project_id, estado, fecha_programada) VALUES ($1, $2, $3, $4, $5)',
    [ci2.id, venta2, A, 'cobrada', '2026-11-12']);
}, 60_000);

afterAll(async () => {
  for (const [sql, lista] of [
    ['DELETE FROM stripe_payments WHERE project_id = ANY($1)', ids.projects],
    ['DELETE FROM payment_links WHERE project_id = ANY($1)', ids.projects],
    ['DELETE FROM conversions WHERE id = ANY($1)', ids.conversions],
    ['DELETE FROM leads WHERE id = ANY($1)', ids.leads],
    ['DELETE FROM products WHERE id = ANY($1)', ids.products],
    ['DELETE FROM user_projects WHERE user_id = ANY($1)', ids.users],
    ['DELETE FROM users WHERE id = ANY($1)', ids.users],
    ['DELETE FROM projects WHERE id = ANY($1)', ids.projects],
  ]) {
    try { await q(sql, [lista]); } catch { /* sigue */ }
  }
});

const pedir = (u, qs = 'desde=2026-11-01&hasta=2026-11-30') => api.get(`/api/links-pago/embudo?${qs}`).set(como(u));

describe('el embudo', () => {
  it('la gestora ve lo suyo: creados, abiertos y pagados con su %, lo cobrado y sus cuotas', async () => {
    const r = await pedir(p.g1, `desde=2026-11-01&hasta=2026-11-30&projectId=${A}`);
    expect(r.status).toBe(200);
    expect(r.body.data.por_gestora).toHaveLength(1);
    expect(r.body.data.por_gestora[0]).toMatchObject({
      user_id: p.g1.id, creados: 4, abiertos: 3, pagados: 2, pct_abiertos: 75, pct_pagados: 50, cobrado: 800,
      cuotas_cobradas: 1, cuotas_fallidas: 1, cuotas_pendientes: 1,
    });
    expect(r.body.data.por_campus).toEqual([expect.objectContaining({ project_id: A, creados: 4 })]);
  });

  it('con «ver todos», las de su campus; nunca las de otro', async () => {
    const r = await pedir(p.admin);
    expect(r.status).toBe(200);
    const g = Object.fromEntries(r.body.data.por_gestora.map((f) => [f.user_id, f]));
    expect(g[p.g1.id].creados).toBe(4);
    // Lo devuelto se resta de lo cobrado; las cuotas de la venta sin vendedora, a la responsable.
    expect(g[p.g2.id]).toMatchObject({ creados: 2, abiertos: 2, pagados: 1, pct_pagados: 50, cobrado: 150, cuotas_cobradas: 1 });
    expect(g[p.gB.id]).toBeUndefined();
    expect(r.body.data.total).toMatchObject({ creados: 6, abiertos: 5, pagados: 3, cobrado: 950, cuotas_cobradas: 2 });
    // Pedir el otro campus a mano no lo abre.
    const otro = await pedir(p.admin, `desde=2026-11-01&hasta=2026-11-30&projectId=${B}`);
    expect(otro.body.data?.total?.creados ?? 0).toBe(0);
  });

  it('el periodo manda; fechas al revés o mal escritas, 400', async () => {
    const oct = await pedir(p.g1, 'desde=2026-10-01&hasta=2026-10-31');
    expect(oct.body.data.total).toMatchObject({ creados: 1, pagados: 1, cobrado: 999, cuotas_cobradas: 0 });
    expect((await pedir(p.g1, 'desde=2026-11-30&hasta=2026-11-01')).status).toBe(400);
    expect((await pedir(p.g1, 'desde=2026-13-01')).status).toBe(400);
    expect((await pedir(p.g1, 'desde=2026-02-30&hasta=2026-03-10')).status).toBe(400);
  });

  it('agrupar suma por gestora y por campus, y el % sin links es «—» (null)', () => {
    const r = agrupar([], [{ project_id: 1, campus: 'X', created_by: 2, gestora: 'G', cobradas: 2, fallidas: 0, pendientes: 1 }]);
    expect(r.total).toMatchObject({ creados: 0, pct_pagados: null, cuotas_cobradas: 2, cuotas_pendientes: 1 });
  });
});
