import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Links de pago creados directamente en Stripe (CRM-ISEIE#688, gemela de CRM#1019). Contra la base local
 * de verdad y con Stripe de mentira (nada sale a Stripe).
 *
 *   · un link creado en el panel de Stripe sale en Links de pago («Creado en
 *     Stripe») en su campus, por el aviso `payment_link.*` o al traerlos; los
 *     del CRM no;
 *   · pagarlo con el correo de un cliente con una venta pendiente apunta el
 *     cobro en su venta, una sola vez aunque el aviso llegue dos veces o llegue
 *     también el del cargo, y sin duplicar el cobro que ya hubiera apuntado;
 *   · sin correo, por el móvil;
 *   · con un correo desconocido, o varias ventas posibles, queda en «Cobros de
 *     Stripe por vincular»; vincularlo a mano lo apunta en la venta elegida, una
 *     vez, y solo en una venta del campus del cobro;
 *   · permisos: `links_pago.ver_todos` y solo en sus campus.
 *
 *   npx vitest run tests/linksDeStripe688.test.js
 */

process.env.LOG_LEVEL = 'silent';
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const integrationsModel = await import('../src/modules/integrations/integrations.model.js');
const { default: linksPago } = await import('../src/modules/links-pago/index.js');
const servicio = await import('../src/modules/stripe-payments/stripe-payments.service.js');
const externos = await import('../src/modules/links-pago/links-pago.externos.js');

// ─── Stripe de mentira ──────────────────────────────────────────────────────
// [método, ruta (texto exacto o RegExp), status, cuerpo]. Lo que no esté preparado revienta.
let preparadas = [];
const llamadas = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = vi.fn(async (url, opciones = {}) => {
  const metodo = (opciones.method || 'GET').toUpperCase();
  const u = new URL(String(url));
  llamadas.push({ metodo, ruta: u.pathname, query: Object.fromEntries(u.searchParams) });
  const r = preparadas.find(([m, ruta]) => m === metodo && (ruta instanceof RegExp ? ruta.test(u.pathname) : u.pathname === ruta));
  if (!r) throw new Error(`Stripe de mentira: sin respuesta para ${metodo} ${u.pathname}`);
  const [, , status, body] = r;
  const datos = typeof body === 'function' ? body(u) : body ?? {};
  return { ok: status < 400, status, json: async () => datos, text: async () => JSON.stringify(datos) };
});

const app = express();
app.use(express.json());
app.use(linksPago.prefix, linksPago.router);
app.use(errorHandler);
const api = supertest(app);

const MARCA = `LS1019${Date.now().toString(36)}`;
const m = MARCA.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const CLAVE_LINKS = 'rk_' + 'test_LinksDeMentira1019abc';
const CLAVE_LECTURA = 'rk_' + 'test_LecturaDeMentira1019xy';

let A; let B;
const p = {};

async function ponerClave(projectId, provider, clave, config = {}) {
  const e = encrypt(clave);
  await integrationsModel.upsert({ projectId, provider, active: true, encrypted_value: e.encrypted, iv: e.iv, auth_tag: e.authTag, config_public: config });
}
async function nuevoLead(projectId, { email = null, telefono = null, status = 'nuevo', responsable = null } = {}) {
  return (await one('INSERT INTO leads (project_id, nombre, email, telefono, responsable_id, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [projectId, `${MARCA} alumna`, email, telefono, responsable?.id ?? null, status])).id;
}
async function nuevaVenta(projectId, leadId, { total = 1000 } = {}) {
  return (await one(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
     VALUES ($1, $2, $3, $4, 0, CURRENT_DATE - 5) RETURNING id`,
    [leadId, projectId, `${MARCA} venta`, total])).id;
}
const cobrosDe = (conversionId) => q('SELECT id, importe::float8 AS importe, notas FROM conversion_payments WHERE conversion_id = $1 ORDER BY id', [conversionId]);
const filaCargo = (projectId, stripeId) => one(
  `SELECT id, conversion_id, conversion_payment_id, link_method, stripe_link_externo_id, por_vincular_motivo,
          por_vincular_candidatos, checkout_externo
     FROM stripe_payments WHERE project_id = $1 AND stripe_id = $2`, [projectId, stripeId]);

let n = 0;
/** Un pago con un link de Stripe: la sesión de Checkout y su cargo. */
function pagoDeStripe({ plink, euros = 300, email = null, telefono = null, descuento = 0, codigo = null, metadata = {} }) {
  const k = ++n;
  const pi = `pi_${MARCA}_${k}`;
  const cargo = {
    id: `ch_${MARCA}_${k}`, amount: Math.round(euros * 100), currency: 'eur', status: 'succeeded',
    created: Math.floor(Date.now() / 1000), payment_intent: pi,
    billing_details: { email, name: `${MARCA} Pagadora`, phone: telefono }, metadata: {},
    payment_method_details: { type: 'card' },
  };
  const sesion = {
    id: `cs_${MARCA}_${k}`, object: 'checkout.session', payment_link: plink, payment_status: 'paid', payment_intent: pi,
    currency: 'eur', amount_subtotal: Math.round((euros + descuento) * 100), amount_total: Math.round(euros * 100),
    total_details: { amount_discount: Math.round(descuento * 100) },
    discounts: codigo ? [{ promotion_code: codigo }] : [],
    customer_details: { email, name: `${MARCA} Pagadora`, phone: telefono }, metadata,
  };
  const evento = { id: `evt_${MARCA}_${k}`, type: 'checkout.session.completed', data: { object: sesion } };
  return { cargo, sesion, evento };
}
/** Stripe contesta el cargo de la sesión (y lo que pide cualquier cargo asociado). */
function stripeDa(cargo) {
  preparadas = [
    ['GET', '/v1/charges', 200, { data: [cargo], has_more: false }],
    ['GET', /^\/v1\/charges\/ch_/, 200, { ...cargo, invoice: null }],
    // El link que llega por un aviso se completa en segundo plano.
    ['GET', /^\/v1\/payment_links\/plink_/, 200, (u) => ({ id: u.pathname.split('/').pop(), active: true, url: 'https://buy.stripe.com/test_x', metadata: {} })],
  ];
}
const plink = (x) => `plink_${MARCA}_${x}`;

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
  p.adminB = await persona('adminb', 'admin', [B]);
  p.gestora = await persona('gestora', 'gestor', [A]);

  await ponerClave(A, 'stripe_links', CLAVE_LINKS);
  await ponerClave(A, 'stripe', CLAVE_LECTURA);
  await ponerClave(B, 'stripe', CLAVE_LECTURA);
}, 60_000);

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 50)); // lo que quedara en segundo plano
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

beforeEach(() => { llamadas.length = 0; preparadas = []; });

// ─── 1. Lo que se guarda de un link de Stripe ───────────────────────────────

describe('lo que se guarda de un Payment Link de Stripe', () => {
  it('el nombre, el importe y la moneda salen de sus líneas; sin importe fijo, null', () => {
    const d = externos.datosDelLink({
      id: 'plink_1', url: 'https://buy.stripe.com/x', active: true, allow_promotion_codes: true,
      line_items: { data: [{ description: 'Máster', amount_total: 120050, currency: 'eur' }] },
    });
    expect(d).toMatchObject({ nombre: 'Máster', importe: 1200.5, moneda: 'EUR', activo: true, codigos_promocionales: true });
    const libre = externos.datosDelLink({ id: 'plink_2', active: false, line_items: { data: [{ description: 'Donación', amount_total: 0, currency: 'eur' }] } });
    expect(libre).toMatchObject({ importe: null, activo: false, codigos_promocionales: false });
  });

  it('el móvil se compara por sus 9 últimas cifras', () => {
    expect(externos.movilNormalizado('+34 611 22 33 44')).toBe('611223344');
    expect(externos.movilNormalizado('123')).toBeNull();
  });
});

// ─── 2. Que salga en Links de pago ──────────────────────────────────────────

describe('un link creado en Stripe sale en Links de pago de su campus', { timeout: 60_000 }, () => {
  it('por el aviso payment_link.created; uno del CRM no', async () => {
    preparadas = [['GET', /^\/v1\/payment_links\/plink_/, 200, (u) => ({
      id: u.pathname.split('/').pop(), active: true, url: 'https://buy.stripe.com/test_aviso', allow_promotion_codes: true,
      line_items: { data: [{ description: `${MARCA} curso del panel`, amount_total: 45000, currency: 'eur' }] }, metadata: {},
    })]];
    const r = await servicio.handleWebhookEvent(A, { id: `evt_${MARCA}_pl1`, type: 'payment_link.created',
      data: { object: { id: plink('aviso'), active: true, url: 'https://buy.stripe.com/test_aviso', metadata: {} } } });
    expect(r.processed).toBe('payment_link.created');
    const delCrm = await servicio.handleWebhookEvent(A, { id: `evt_${MARCA}_pl2`, type: 'payment_link.created',
      data: { object: { id: plink('crm'), active: true, metadata: { crm_link_id: '5', crm_project_id: String(A) } } } });
    expect(delCrm.skipped).toMatch(/CRM/);
    await new Promise((res) => setTimeout(res, 300)); // se completa en segundo plano con sus líneas

    const lista = await api.get('/api/links-pago/externos').query({ projectId: A }).set(como(p.admin));
    expect(lista.status).toBe(200);
    const mios = lista.body.data.filter((l) => l.stripe_payment_link_id.includes(MARCA));
    expect(mios.map((l) => l.stripe_payment_link_id)).toEqual([plink('aviso')]);
    expect(mios[0]).toMatchObject({ nombre: `${MARCA} curso del panel`, moneda: 'EUR', activo: true, codigos_promocionales: true });
    expect(Number(mios[0].importe)).toBe(450);
  });

  it('«Traer de Stripe» los recoge con la clave de links; los del CRM se quedan fuera', async () => {
    preparadas = [
      ['GET', '/v1/payment_links', 200, { has_more: false, data: [
        { id: plink('traido'), active: false, url: 'https://buy.stripe.com/test_t', metadata: {},
          line_items: { data: [{ description: `${MARCA} experto`, amount_total: 9900, currency: 'usd' }] } },
        { id: plink('crm2'), active: true, metadata: { crm_link_id: '9' } },
      ] }],
      ['GET', '/v1/checkout/sessions', 200, { data: [], has_more: false }],
    ];
    const r = await api.post('/api/links-pago/externos/sincronizar').send({ projectId: A }).set(como(p.admin));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ links: 1, nuevos: 1, cobros: 0 });
    expect(llamadas.every((c) => c.metodo === 'GET')).toBe(true);
    const fila = await one('SELECT activo, moneda, importe::float8 AS importe FROM stripe_links_externos WHERE project_id = $1 AND stripe_payment_link_id = $2', [A, plink('traido')]);
    expect(fila).toEqual({ activo: false, moneda: 'USD', importe: 99 });
    expect(await one('SELECT 1 AS x FROM stripe_links_externos WHERE stripe_payment_link_id = $1', [plink('crm2')])).toBeUndefined();
  });

  it('permisos: sin «ver todos», 403; de otro campus, ni se ven ni se traen', async () => {
    expect((await api.get('/api/links-pago/externos').set(como(p.gestora))).status).toBe(403);
    expect((await api.get('/api/links-pago/por-vincular').set(como(p.gestora))).status).toBe(403);
    const deB = await api.get('/api/links-pago/externos').set(como(p.adminB));
    expect(deB.status).toBe(200);
    expect(deB.body.data.some((l) => l.project_id === A)).toBe(false);
    const traerA = await api.post('/api/links-pago/externos/sincronizar').send({ projectId: A }).set(como(p.adminB));
    expect(traerA.status).toBe(403);
    expect(llamadas).toHaveLength(0);
  });
});

// ─── 3. Su cobro, a la venta ────────────────────────────────────────────────

describe('el cobro de un link de Stripe', { timeout: 60_000 }, () => {
  it('con el correo de un cliente con su venta pendiente: a esa venta, una vez, con el descuento en la nota', async () => {
    const email = `cliente@${m}.test`;
    const lead = await nuevoLead(A, { email, responsable: p.gestora });
    const venta = await nuevaVenta(A, lead, { total: 1000 });
    const { cargo, evento } = pagoDeStripe({ plink: plink('cobro'), euros: 270, email, descuento: 30, codigo: 'promo_x' });
    stripeDa(cargo);

    const r = await servicio.handleWebhookEvent(A, evento);
    expect(r.processed).toBe('checkout.session.completed');
    const sp = await filaCargo(A, cargo.id);
    expect(sp).toMatchObject({ conversion_id: venta, link_method: 'auto_link_stripe', por_vincular_motivo: null });
    expect(sp.stripe_link_externo_id).toBeTruthy();
    const cobros = await cobrosDe(venta);
    expect(cobros).toHaveLength(1);
    expect(cobros[0].importe).toBe(270);
    expect(cobros[0].notas).toContain(cargo.id);
    expect(cobros[0].notas).toMatch(/link creado en Stripe · descuento 30\.00 con el código promo_x/);
    expect(sp.conversion_payment_id).toBe(cobros[0].id);

    // El mismo aviso otra vez, y el del cargo: ni otro cobro ni otro cargo.
    await servicio.handleWebhookEvent(A, evento);
    await servicio.handleWebhookEvent(A, { id: `evt_${cargo.id}_ch`, type: 'charge.succeeded', data: { object: cargo } });
    expect(await cobrosDe(venta)).toHaveLength(1);
    expect((await q('SELECT id FROM stripe_payments WHERE project_id = $1 AND stripe_id = $2', [A, cargo.id]))).toHaveLength(1);
    // Y sale en la lista con lo cobrado.
    const lista = await api.get('/api/links-pago/externos').query({ projectId: A }).set(como(p.admin));
    expect(lista.body.data.find((l) => l.stripe_payment_link_id === plink('cobro'))).toMatchObject({ cobros: 1, cobrado: 270, por_vincular: 0 });
  });

  it('si la gestora ya lo había apuntado a mano, se engancha a ese cobro sin sumar otro', async () => {
    const email = `amano@${m}.test`;
    const lead = await nuevoLead(A, { email });
    const venta = await nuevaVenta(A, lead, { total: 900 });
    await q('INSERT INTO conversion_payments (conversion_id, importe, fecha, metodo) VALUES ($1, 300, CURRENT_DATE, \'tarjeta\')', [venta]);
    const { cargo, evento } = pagoDeStripe({ plink: plink('amano'), euros: 300, email });
    stripeDa(cargo);
    await servicio.handleWebhookEvent(A, evento);
    expect(await cobrosDe(venta)).toHaveLength(1);
    expect((await filaCargo(A, cargo.id)).link_method).toBe('auto_dedup');
  });

  it('el aviso del cargo antes que el de la sesión: el cargo ya asociado por el correo no se toca', async () => {
    const email = `antes@${m}.test`;
    const lead = await nuevoLead(A, { email, status: 'convertido' });
    const venta = await nuevaVenta(A, lead, { total: 500 });
    const { cargo, evento } = pagoDeStripe({ plink: plink('antes'), euros: 500, email });
    stripeDa(cargo);
    await servicio.handleWebhookEvent(A, { id: `evt_${cargo.id}_ch`, type: 'charge.succeeded', data: { object: cargo } });
    expect(await cobrosDe(venta)).toHaveLength(1);
    await servicio.handleWebhookEvent(A, evento);
    expect(await cobrosDe(venta)).toHaveLength(1);
    const sp = await filaCargo(A, cargo.id);
    expect(sp.link_method).toBe('auto_email');
    expect(sp.stripe_link_externo_id).toBeTruthy(); // queda dicho de qué link vino
  });

  it('sin correo, por el móvil', async () => {
    const lead = await nuevoLead(A, { telefono: '+34 699 11 22 33' });
    const venta = await nuevaVenta(A, lead, { total: 800 });
    const { cargo, evento } = pagoDeStripe({ plink: plink('movil'), euros: 200, telefono: '0034699112233' });
    stripeDa(cargo);
    await servicio.handleWebhookEvent(A, evento);
    expect(await cobrosDe(venta)).toHaveLength(1);
    expect((await filaCargo(A, cargo.id)).link_method).toBe('auto_link_stripe');
  });

  it('varias ventas pendientes: a la bandeja, con las dos como candidatas', async () => {
    const email = `dos@${m}.test`;
    const lead = await nuevoLead(A, { email });
    const v1 = await nuevaVenta(A, lead, { total: 400 });
    const v2 = await nuevaVenta(A, lead, { total: 600 });
    const { cargo, evento } = pagoDeStripe({ plink: plink('dos'), euros: 100, email });
    stripeDa(cargo);
    await servicio.handleWebhookEvent(A, evento);
    const sp = await filaCargo(A, cargo.id);
    expect(sp.conversion_payment_id).toBeNull();
    expect(sp.por_vincular_motivo).toBe('varias_coincidencias');
    expect(sp.por_vincular_candidatos.map((c) => c.conversion_id).sort()).toEqual([v1, v2].sort());
    expect(await cobrosDe(v1)).toHaveLength(0);
    expect(await cobrosDe(v2)).toHaveLength(0);
  });
});

// ─── 4. La bandeja «Cobros de Stripe por vincular» ──────────────────────────

describe('«Cobros de Stripe por vincular»', { timeout: 60_000 }, () => {
  it('correo desconocido → bandeja; vincular a mano lo apunta en la venta elegida, una vez', async () => {
    const { cargo, evento } = pagoDeStripe({ plink: plink('nadie'), euros: 150, email: `nadie@${m}.test` });
    stripeDa(cargo);
    await servicio.handleWebhookEvent(A, evento);
    // El mismo aviso dos veces: sigue siendo un solo cobro en la bandeja.
    await servicio.handleWebhookEvent(A, evento);
    const sp = await filaCargo(A, cargo.id);
    expect(sp.por_vincular_motivo).toBe('sin_coincidencia');

    const bandeja = await api.get('/api/links-pago/por-vincular').query({ projectId: A }).set(como(p.admin));
    expect(bandeja.status).toBe(200);
    const fila = bandeja.body.data.find((f) => f.stripe_id === cargo.id);
    expect(fila).toMatchObject({ importe: 150, motivo: 'sin_coincidencia', email: `nadie@${m}.test` });
    expect(fila.motivo_texto).toMatch(/Nadie/);
    // Otro campus no la ve.
    const deB = await api.get('/api/links-pago/por-vincular').set(como(p.adminB));
    expect(deB.body.data.some((f) => f.stripe_id === cargo.id)).toBe(false);

    // La venta se busca en el campus del cobro.
    const lead = await nuevoLead(A, { email: `otra.direccion@${m}.test` });
    const venta = await nuevaVenta(A, lead, { total: 600 });
    const busca = await api.get('/api/links-pago/por-vincular/ventas').query({ cargoId: sp.id, q: 'otra.direccion' }).set(como(p.admin));
    expect(busca.status).toBe(200);
    expect(busca.body.data.map((v) => v.conversion_id)).toContain(venta);

    // Una venta de otro campus: 404.
    const leadB = await nuevoLead(B, { email: `b@${m}.test` });
    const ventaB = await nuevaVenta(B, leadB);
    expect((await api.post(`/api/links-pago/por-vincular/${sp.id}/vincular`).send({ conversionId: ventaB }).set(como(p.admin))).status).toBe(404);
    // Desde otro campus, el cobro no existe.
    expect((await api.post(`/api/links-pago/por-vincular/${sp.id}/vincular`).send({ conversionId: venta }).set(como(p.adminB))).status).toBe(404);

    const ok = await api.post(`/api/links-pago/por-vincular/${sp.id}/vincular`).send({ conversionId: venta }).set(como(p.admin));
    expect(ok.status).toBe(200);
    expect(ok.body.data.conversion_id).toBe(venta);
    const cobros = await cobrosDe(venta);
    expect(cobros).toHaveLength(1);
    expect(cobros[0].importe).toBe(150);
    expect(ok.body.data.conversion_payment_id).toBe(cobros[0].id);
    const despues = await filaCargo(A, cargo.id);
    expect(despues).toMatchObject({ conversion_id: venta, link_method: 'manual', por_vincular_motivo: null });

    // Ni otra vez a mano ni por el aviso repetido.
    expect((await api.post(`/api/links-pago/por-vincular/${sp.id}/vincular`).send({ conversionId: venta }).set(como(p.admin))).status).toBe(409);
    await servicio.handleWebhookEvent(A, evento);
    expect(await cobrosDe(venta)).toHaveLength(1);
    const bandeja2 = await api.get('/api/links-pago/por-vincular').query({ projectId: A }).set(como(p.admin));
    expect(bandeja2.body.data.some((f) => f.stripe_id === cargo.id)).toBe(false);
  });

  it('una sesión pagada cuyo aviso no llegó la recoge «Traer de Stripe», una vez', async () => {
    const { cargo, sesion } = pagoDeStripe({ plink: plink('perdido'), euros: 80, email: `perdida@${m}.test` });
    stripeDa(cargo);
    preparadas.push(
      ['GET', '/v1/payment_links', 200, { has_more: false, data: [] }],
      ['GET', '/v1/checkout/sessions', 200, { has_more: false, data: [sesion] }],
    );
    const r = await api.post('/api/links-pago/externos/sincronizar').send({ projectId: A }).set(como(p.admin));
    expect(r.status).toBe(200);
    expect(r.body.data.cobros).toBe(1);
    expect((await filaCargo(A, cargo.id)).por_vincular_motivo).toBe('sin_coincidencia');
    // La vuelta siguiente no la vuelve a pedir.
    llamadas.length = 0;
    const r2 = await api.post('/api/links-pago/externos/sincronizar').send({ projectId: A }).set(como(p.admin));
    expect(r2.body.data.cobros).toBe(0);
    expect(llamadas.some((c) => c.ruta === '/v1/charges')).toBe(false);
  });

  it('un checkout sin link ni marca del CRM (la web) sigue sin tocarse', async () => {
    const r = await servicio.handleWebhookEvent(A, { id: `evt_${MARCA}_web`, type: 'checkout.session.completed',
      data: { object: { id: 'cs_web', payment_status: 'paid', payment_intent: 'pi_web', metadata: { order_id: '1' } } } });
    expect(r.skipped).toMatch(/sin marca/);
    expect(llamadas).toHaveLength(0);
  });
});
