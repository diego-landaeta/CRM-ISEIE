import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Links de pago: el asistente de crear link (Diego, 19/11). Contra la base local
 * de verdad y con Stripe de mentira.
 *
 *   · `GET /api/links-pago/ventas-del-prospecto`: el prospecto (o el de una
 *     venta) con SUS ventas, su programa, total y pendiente, para elegir a cuál
 *     va el link. Lo ajeno (otro campus, o de otra gestora) es un 404;
 *   · CRM#909: desde una venta, el link no pasa de lo pendiente (400 € con 370
 *     pendientes daba 201), ni para el admin; una venta cobrada entera, ninguno;
 *   · un link creado desde la ficha del prospecto PARA una de sus ventas va a
 *     esa venta, y al pagarse el cobro entra en ella y salda su cuota.
 *
 *   npx vitest run tests/linksPago680asistente.test.js
 */

process.env.LOG_LEVEL = 'silent';
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const integrationsModel = await import('../src/modules/integrations/integrations.model.js');
const { default: linksPago } = await import('../src/modules/links-pago/index.js');
const servicio = await import('../src/modules/stripe-payments/stripe-payments.service.js');

let preparadas = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = vi.fn(async (url, opciones = {}) => {
  const metodo = (opciones.method || 'GET').toUpperCase();
  const u = new URL(String(url));
  const r = preparadas.find(([m, ruta]) => m === metodo && u.pathname === ruta);
  if (!r) throw new Error(`Stripe de mentira: sin respuesta para ${metodo} ${u.pathname}`);
  const [, , status, body] = r;
  const datos = typeof body === 'function' ? body() : body ?? {};
  return { ok: status < 400, status, json: async () => datos, text: async () => JSON.stringify(datos) };
});
let n = 0;
const stripeCreaBien = () => {
  preparadas = [
    ['POST', '/v1/prices', 200, () => ({ id: `price_as_${++n}` })],
    ['POST', '/v1/payment_links', 200, () => ({ id: `plink_as_${MARCA}_${n}`, url: `https://buy.stripe.com/test_as_${n}` })],
  ];
};

const app = express();
app.use(express.json());
app.use(linksPago.prefix, linksPago.router);
app.use(errorHandler);
const api = supertest(app);

const MARCA = `LP680AS${Date.now().toString(36)}`;
const m = MARCA.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const CLAVE_RK = 'rk_' + 'test_EscrituraDeMentira680as';
const CLAVE_LECTURA = 'rk_' + 'test_LecturaDeMentira680asxy';

let A; let B;
const p = {};
const prod = {};

async function ponerClave(projectId, provider, clave) {
  const e = encrypt(clave);
  await integrationsModel.upsert({ projectId, provider, active: true, encrypted_value: e.encrypted, iv: e.iv, auth_tag: e.authTag, config_public: {} });
}
async function nuevoLead(projectId, responsable) {
  return (await one('INSERT INTO leads (project_id, nombre, email, telefono, responsable_id, status) VALUES ($1, $2, $3, $4, $5, \'nuevo\') RETURNING id',
    [projectId, `${MARCA} lead`, `ficha${Math.random().toString(36).slice(2, 8)}@${m}.test`, '+34600000000', responsable?.id ?? null])).id;
}
async function nuevaVenta(projectId, leadId, { total = 1000, producto = null, vendedora = null } = {}) {
  return (await one(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado,
                              fecha_conversion, vendedora_id)
     VALUES ($1, $2, $3, $4, $5, 0, CURRENT_DATE - 5, $6) RETURNING id`,
    [leadId, projectId, `${MARCA} venta`, producto, total, vendedora?.id ?? null])).id;
}
const crear = (u, cuerpo) => api.post('/api/links-pago').set(como(u)).send({ moneda: 'EUR', caducidad_dias: 7, ...cuerpo });
const ventasDe = (u, params) => api.get('/api/links-pago/ventas-del-prospecto').query(params).set(como(u));

beforeAll(async () => {
  const campus = async (x) => {
    const r = await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${x}`, `${m}-${x}`, `${MARCA}-k-${x}`]);
    ids.projects.push(r.id);
    return r.id;
  };
  A = await campus('a');
  B = await campus('b');
  const persona = async (x, role, suyos) => {
    const u = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', $3) RETURNING id, role',
      [`${MARCA} ${x}`, `${x}@${m}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  p.admin = await persona('admin', 'admin', [A]);
  p.gestora = await persona('gestora', 'gestor', [A]);
  p.otra = await persona('otra', 'gestor', [A]);
  const curso = async (c, nombre, precio) => (await one(
    'INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, $3, \'EUR\') RETURNING id', [c, `${MARCA} ${nombre}`, precio])).id;
  prod.A = await curso(A, 'máster', 1000);
  prod.A2 = await curso(A, 'experto', 600);
  prod.B = await curso(B, 'otro', 500);
  await ponerClave(A, 'stripe_links', CLAVE_RK);
  await ponerClave(A, 'stripe', CLAVE_LECTURA);
}, 60_000);

afterAll(async () => {
  for (const [sql, lista] of [
    ['DELETE FROM projects WHERE id = ANY($1)', ids.projects],
    ['DELETE FROM user_activity_log WHERE user_id = ANY($1)', ids.users],
    ['DELETE FROM admin_notifications WHERE target_user_ids && $1::int[]', ids.users],
    ['DELETE FROM user_projects WHERE user_id = ANY($1)', ids.users],
    ['DELETE FROM users WHERE id = ANY($1)', ids.users],
  ]) {
    try { await q(sql, [lista]); } catch { /* el siguiente sigue */ }
  }
  globalThis.fetch = fetchOriginal;
});

beforeEach(() => { preparadas = []; });

describe('las ventas del prospecto, para elegir a cuál va el link', { timeout: 60_000 }, () => {
  it('trae el prospecto con su correo y teléfono, y cada venta con su programa, total, cobrado y pendiente', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const v1 = await nuevaVenta(A, lead, { total: 1000, producto: prod.A, vendedora: p.gestora });
    const v2 = await nuevaVenta(A, lead, { total: 600, producto: prod.A2, vendedora: p.gestora });
    await q('INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 630, CURRENT_DATE)', [v1]);

    const r = await ventasDe(p.gestora, { leadId: lead });
    expect(r.status).toBe(200);
    expect(r.body.data.lead).toMatchObject({ id: lead, project_id: A, telefono: '+34600000000' });
    expect(r.body.data.lead.email).toMatch(/@/);
    const porId = Object.fromEntries(r.body.data.ventas.map((v) => [v.id, v]));
    expect(porId[v1]).toMatchObject({ producto_nombre: `${MARCA} máster`, importe_total: 1000, cobrado: 630, pendiente: 370 });
    expect(porId[v2]).toMatchObject({ producto_nombre: `${MARCA} experto`, importe_total: 600, cobrado: 0, pendiente: 600 });

    // Desde una venta: el mismo prospecto.
    const r2 = await ventasDe(p.gestora, { conversionId: v2 });
    expect(r2.status).toBe(200);
    expect(r2.body.data.lead.id).toBe(lead);
    expect(r2.body.data.ventas).toHaveLength(2);
  });

  it('el prospecto de otra gestora o de otro campus: 404, como si no existiera', async () => {
    const deOtra = await nuevoLead(A, p.otra);
    expect((await ventasDe(p.gestora, { leadId: deOtra })).status).toBe(404);
    const deOtroCampus = await nuevoLead(B, null);
    expect((await ventasDe(p.admin, { leadId: deOtroCampus })).status).toBe(404);
    expect((await ventasDe(p.gestora, {})).status).toBe(400);
  });
});

describe('CRM#909: desde una venta, nunca por encima de lo pendiente', { timeout: 60_000 }, () => {
  it('400 € con 370 pendientes: 400 LINK_SUPERA_PENDIENTE con el pendiente en el mensaje, también para el admin', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const venta = await nuevaVenta(A, lead, { total: 1000, producto: prod.A, vendedora: p.gestora });
    await q('INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 630, CURRENT_DATE)', [venta]);
    stripeCreaBien();
    for (const quien of [p.gestora, p.admin]) {
      const r = await crear(quien, { leadId: lead, conversionId: venta, productId: prod.A, importe: 400 });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('LINK_SUPERA_PENDIENTE');
      expect(r.body.error).toMatch(/370\.00 EUR/);
    }
    expect(Number((await one('SELECT COUNT(*) AS n FROM payment_links WHERE conversion_id = $1', [venta])).n)).toBe(0);
    // Justo lo pendiente, sí.
    const ok = await crear(p.gestora, { leadId: lead, conversionId: venta, productId: prod.A, importe: 370 });
    expect(ok.status).toBe(201);
  });

  it('una venta cobrada entera no admite links', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const venta = await nuevaVenta(A, lead, { total: 500, producto: prod.A, vendedora: p.gestora });
    await q('INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 500, CURRENT_DATE)', [venta]);
    const r = await crear(p.admin, { conversionId: venta, productId: prod.A, importe: 100 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('LINK_SUPERA_PENDIENTE');
    expect(r.body.error).toMatch(/cobrada entera/);
  });

  it('una venta que no es de ese prospecto: 400', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const otro = await nuevoLead(A, p.gestora);
    const venta = await nuevaVenta(A, otro, { total: 500, producto: prod.A, vendedora: p.gestora });
    const r = await crear(p.gestora, { leadId: lead, conversionId: venta, productId: prod.A, importe: 100 });
    expect(r.status).toBe(400);
  });
});

describe('el link de UNA venta del prospecto: el cobro entra en esa venta y salda su cuota', { timeout: 60_000 }, () => {
  it('con dos ventas, el link va a la elegida y su pago salda la cuota 1 de esa, no de la otra', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const otra = await nuevaVenta(A, lead, { total: 1000, producto: prod.A, vendedora: p.gestora });
    const venta = await nuevaVenta(A, lead, { total: 600, producto: prod.A2, vendedora: p.gestora });
    for (const v of [otra, venta]) {
      await q(`INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento)
               VALUES ($1, 1, $2, CURRENT_DATE), ($1, 2, $2, CURRENT_DATE + 30)`, [v, v === venta ? 300 : 500]);
    }
    stripeCreaBien();
    // El admin: un link por menos de lo pendiente (una cuota) sigue siendo «descuento»
    // para la gestora con tope 0 (fase 3); el link por cuota llega con el plan de pago.
    const r = await crear(p.admin, { leadId: lead, conversionId: venta, productId: prod.A2, importe: 300 });
    expect(r.status).toBe(201);
    expect(r.body.data.conversion_id).toBe(venta);
    // La lista dice a qué venta va, con su programa.
    const lista = await api.get('/api/links-pago').query({ leadId: lead }).set(como(p.admin));
    expect(lista.body.data.find((l) => l.id === r.body.data.id)).toMatchObject({ conversion_id: venta, venta_producto_nombre: `${MARCA} experto` });

    const link = r.body.data;
    const cargo = {
      id: `ch_${MARCA}_1`, amount: 30000, currency: 'eur', status: 'succeeded', created: Math.floor(Date.now() / 1000),
      billing_details: { email: `pagador@otro.test`, name: `${MARCA} Pagador` },
      metadata: { crm_link_id: String(link.id), crm_project_id: String(A), crm_lead_id: String(lead), crm_conversion_id: String(venta), crm_user_id: String(p.admin.id), crm_entorno: 'local' },
      payment_method_details: { type: 'card' },
    };
    await servicio.handleWebhookEvent(A, { id: `evt_${cargo.id}`, type: 'charge.succeeded', data: { object: cargo } });

    const cobros = await q('SELECT conversion_id, importe FROM conversion_payments WHERE conversion_id = ANY($1)', [[otra, venta]]);
    expect(cobros).toEqual([{ conversion_id: venta, importe: '300.00' }]);
    const cuotas = await q('SELECT conversion_id, numero, fecha_cobro IS NOT NULL AS cobrada FROM conversion_installments WHERE conversion_id = ANY($1) ORDER BY conversion_id, numero', [[otra, venta]]);
    expect(cuotas.filter((c) => c.cobrada)).toEqual([{ conversion_id: venta, numero: 1, cobrada: true }]);
    expect((await one('SELECT estado FROM payment_links WHERE id = $1', [link.id])).estado).toBe('pagado');
  });
});

describe('«Generar plan de pago» (Diego, 19/11): un link por cuota, y el cobro salda ESA cuota', { timeout: 60_000 }, () => {
  const plan = (u, cuerpo) => api.post('/api/links-pago/plan').set(como(u)).send(cuerpo);

  it('la gestora genera los links de las 3 cuotas; la segunda vez no duplica; pagar la 3 salda la 3', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const venta = await nuevaVenta(A, lead, { total: 900, producto: prod.A, vendedora: p.gestora });
    await q(`INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento)
             VALUES ($1, 1, 300, CURRENT_DATE), ($1, 2, 300, CURRENT_DATE + 30), ($1, 3, 300, CURRENT_DATE + 60)`, [venta]);

    const ver = await api.get('/api/links-pago/plan').query({ conversionId: venta }).set(como(p.gestora));
    expect(ver.status).toBe(200);
    expect(ver.body.data.cuotas.map((c) => [c.numero, c.importe, c.link_id])).toEqual([[1, 300, null], [2, 300, null], [3, 300, null]]);
    expect(ver.body.data.venta).toMatchObject({ id: venta, pendiente: 900 });

    stripeCreaBien();
    const r = await plan(p.gestora, { conversionId: venta });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.creados).toBe(3);
    expect(r.body.data.cuotas.every((c) => c.link_id && c.link_url)).toBe(true);
    const links = await q('SELECT l.id, l.importe, ci.numero, l.caduca_el FROM payment_links l JOIN conversion_installments ci ON ci.id = l.installment_id WHERE l.conversion_id = $1 ORDER BY ci.numero', [venta]);
    expect(links.map((l) => [l.numero, Number(l.importe)])).toEqual([[1, 300], [2, 300], [3, 300]]);
    // El de la cuota 3 dura hasta su vencimiento más la caducidad del campus.
    expect(new Date(links[2].caduca_el).getTime()).toBeGreaterThan(new Date(links[0].caduca_el).getTime());

    // Otra vez: no se duplican.
    const otra = await plan(p.gestora, { conversionId: venta });
    expect(otra.status).toBe(200);
    expect(otra.body.data).toMatchObject({ creados: 0, ya_tenian: 3 });

    // Se paga el link de la cuota 3: salda la 3, no la 1.
    const link3 = links[2];
    const cargo = {
      id: `ch_${MARCA}_plan3`, amount: 30000, currency: 'eur', status: 'succeeded', created: Math.floor(Date.now() / 1000),
      billing_details: { email: 'pagador@otro.test', name: `${MARCA} Pagador` },
      metadata: { crm_link_id: String(link3.id), crm_project_id: String(A), crm_lead_id: String(lead), crm_conversion_id: String(venta), crm_user_id: String(p.gestora.id), crm_entorno: 'local' },
      payment_method_details: { type: 'card' },
    };
    await servicio.handleWebhookEvent(A, { id: `evt_${cargo.id}`, type: 'charge.succeeded', data: { object: cargo } });
    const cuotas = await q('SELECT numero, fecha_cobro IS NOT NULL AS cobrada FROM conversion_installments WHERE conversion_id = $1 ORDER BY numero', [venta]);
    expect(cuotas).toEqual([{ numero: 1, cobrada: false }, { numero: 2, cobrada: false }, { numero: 3, cobrada: true }]);
    expect((await one('SELECT estado FROM payment_links WHERE id = $1', [link3.id])).estado).toBe('pagado');
  });

  it('sin plan de cuotas, 400 SIN_CUOTAS; la venta de otra gestora, 404; una cuota de otra venta, 400', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const sinCuotas = await nuevaVenta(A, lead, { total: 500, producto: prod.A, vendedora: p.gestora });
    expect((await plan(p.gestora, { conversionId: sinCuotas })).body.code).toBe('SIN_CUOTAS');

    const deOtra = await nuevaVenta(A, await nuevoLead(A, p.otra), { total: 500, producto: prod.A, vendedora: p.otra });
    expect((await plan(p.gestora, { conversionId: deOtra })).status).toBe(404);

    const conCuotas = await nuevaVenta(A, lead, { total: 400, producto: prod.A, vendedora: p.gestora });
    await q('INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento) VALUES ($1, 1, 200, CURRENT_DATE), ($1, 2, 200, CURRENT_DATE + 30)', [conCuotas]);
    const ajena = await one('INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento) VALUES ($1, 1, 100, CURRENT_DATE) RETURNING id', [deOtra]);
    const r = await plan(p.gestora, { conversionId: conCuotas, cuotaIds: [ajena.id] });
    expect(r.status).toBe(400);
  });
});
