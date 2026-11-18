import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #428 · Pagos de Stripe: cada uno, solo en sus campus.
 *
 * Ver un cargo, sincronizar, asociarlo, desasociarlo y decidir su disputa iban
 * solo por el id (o por el projectId que mandara el navegador): con permiso de
 * ver pagos se leía el cargo de cualquier campus, y con el de editar se movía
 * dinero de otra empresa. También se podía asociar un cargo de un campus a una
 * venta de otro.
 *
 *   npx vitest run tests/stripePagosPorCampus428.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { default: modulo } = await import('../src/modules/stripe-payments/index.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `SP428${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], leads: [], conversions: [] };
let SUPER; let ADMIN; let MIO; let AJENO;
let cargoMio; let cargoAjeno; let ventaMia; let ventaAjena; let leadMio; let leadAjeno;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const cargo = (id) => one('SELECT * FROM stripe_payments WHERE id = $1', [id]);

beforeAll(async () => {
  const campus = async (c) => {
    const p = await one(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
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

  const venta = async (p, c) => {
    const l = await one(`INSERT INTO leads (project_id, nombre, email, status) VALUES ($1, $2, $3, 'convertido') RETURNING id`,
      [p, `${MARCA} ${c}`, `${c}.${MARCA.toLowerCase()}@prueba.test`]);
    ids.leads.push(l.id);
    const v = await one(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
                         VALUES ($1, $2, 'Máster', 1000, 0, CURRENT_DATE) RETURNING id`, [l.id, p]);
    ids.conversions.push(v.id);
    return { lead: l.id, venta: v.id };
  };
  ({ lead: leadMio, venta: ventaMia } = await venta(MIO, 'mia'));
  ({ lead: leadAjeno, venta: ventaAjena } = await venta(AJENO, 'ajena'));

  const nuevoCargo = (p, c, extra = '') => one(
    `INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, customer_email, stripe_created_at${extra ? ', lead_id, conversion_id, link_method' : ''})
     VALUES ($1, $2, 'charge', 'succeeded', 50, 'EUR', $3, NOW()${extra}) RETURNING id`,
    [p, `ch_${MARCA}_${c}`, `${c}.${MARCA.toLowerCase()}@prueba.test`]);
  cargoMio = (await nuevoCargo(MIO, 'mio')).id;
  // El ajeno ya está asociado a su venta: así se ve que desasociarlo desde fuera no lo suelta.
  cargoAjeno = (await nuevoCargo(AJENO, 'ajeno', `, ${leadAjeno}, ${ventaAjena}, 'manual'`)).id;
}, 60000);

afterAll(async () => {
  for (const [sql, v] of [
    ['DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])', ids.conversions],
    ['DELETE FROM stripe_payments WHERE project_id = ANY($1::int[])', ids.projects],
    ['DELETE FROM conversions WHERE id = ANY($1::int[])', ids.conversions],
    ['DELETE FROM leads WHERE id = ANY($1::int[])', ids.leads],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', ids.users],
    ['DELETE FROM users WHERE id = ANY($1::int[])', ids.users],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', ids.projects],
  ]) {
    try { await q(sql, [v]); } catch { /* sigue limpiando */ }
  }
  await pool.end();
}, 60000);

describe('#428 · ver un cargo', () => {
  it('el de un campus ajeno es un 404, como si no existiera', async () => {
    const r = await request.get(`/api/stripe-payments/${cargoAjeno}`).set(como(ADMIN));
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain('ajeno.');
  });

  it('el suyo, sí; y super admin, cualquiera', async () => {
    expect((await request.get(`/api/stripe-payments/${cargoMio}`).set(como(ADMIN))).status).toBe(200);
    expect((await request.get(`/api/stripe-payments/${cargoAjeno}`).set(como(SUPER))).status).toBe(200);
  });
});

describe('#428 · sincronizar', () => {
  it('un campus ajeno es un 403 y no se llega a sincronizar', async () => {
    const r = await request.post('/api/stripe-payments/sync').set(como(ADMIN)).send({ projectId: AJENO });
    expect(r.status).toBe(403);
  });

  it('el suyo pasa la comprobación (sin clave de Stripe, lo que diga la sincronización)', async () => {
    const r = await request.post('/api/stripe-payments/sync').set(como(ADMIN)).send({ projectId: MIO });
    expect([403, 404]).not.toContain(r.status);
  });
});

describe('#428 · asociar, desasociar y disputa', () => {
  it('asociar un cargo ajeno: 404 y el cargo no cambia', async () => {
    const r = await request.post(`/api/stripe-payments/${cargoAjeno}/link`).set(como(ADMIN)).send({ conversionId: ventaMia });
    expect(r.status).toBe(404);
    expect((await cargo(cargoAjeno)).conversion_id).toBe(ventaAjena);
  });

  it('asociar su cargo a una venta o a un prospecto de otro campus: 404 y nada asociado', async () => {
    let r = await request.post(`/api/stripe-payments/${cargoMio}/link`).set(como(ADMIN)).send({ conversionId: ventaAjena });
    expect(r.status).toBe(404);
    r = await request.post(`/api/stripe-payments/${cargoMio}/link`).set(como(ADMIN)).send({ leadId: leadAjeno });
    expect(r.status).toBe(404);
    const c = await cargo(cargoMio);
    expect(c.conversion_id).toBeNull();
    expect(c.lead_id).toBeNull();
    const { n } = await one('SELECT COUNT(*)::int AS n FROM conversion_payments WHERE conversion_id = $1', [ventaAjena]);
    expect(n).toBe(0);
  });

  it('su cargo con su venta, sí: queda asociado y con su cobro', async () => {
    const r = await request.post(`/api/stripe-payments/${cargoMio}/link`).set(como(ADMIN)).send({ conversionId: ventaMia, leadId: leadMio });
    expect(r.status).toBe(200);
    const c = await cargo(cargoMio);
    expect(c.conversion_id).toBe(ventaMia);
    expect(c.conversion_payment_id).not.toBeNull();
  });

  it('desasociar un cargo ajeno: 404 y sigue asociado', async () => {
    const r = await request.delete(`/api/stripe-payments/${cargoAjeno}/link`).set(como(ADMIN));
    expect(r.status).toBe(404);
    expect((await cargo(cargoAjeno)).conversion_id).toBe(ventaAjena);
  });

  it('decidir la disputa de un cargo ajeno: 404 y sin decisión', async () => {
    const r = await request.patch(`/api/stripe-payments/${cargoAjeno}/dispute`).set(como(ADMIN)).send({ decision: 'accept_refund' });
    expect(r.status).toBe(404);
    expect((await cargo(cargoAjeno)).dispute_my_decision).toBeNull();
  });

  it('y el suyo, sí', async () => {
    const r = await request.patch(`/api/stripe-payments/${cargoMio}/dispute`).set(como(ADMIN)).send({ decision: 'contest' });
    expect(r.status).toBe(200);
    expect((await cargo(cargoMio)).dispute_my_decision).toBe('contest');
  });
});
