import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Cobro automático de las cuotas con Stripe (#680, migración 309; Diego, 19/11/2026).
 * Contra la base local de verdad y con un Stripe de mentira que apunta cada llamada.
 *
 *   · las reglas puras: qué se puede programar (fechas, importes, lo pendiente);
 *   · activarlo al generar el plan: solo el link de la primera cuota, que guarda
 *     la tarjeta (setup_future_usage + cliente + texto de consentimiento);
 *     campus sin permitirlo, 409; clave sin permisos, 424 con lo que falta;
 *   · el alumno paga ese link: la tarjeta queda en la venta y Stripe recibe un
 *     Subscription Schedule con una fase por cuota (su fecha y su importe);
 *   · la gestora cambia una fecha: se rehacen las fases en Stripe;
 *   · `invoice.paid` de la cuota 3 salda la 3, no la primera pendiente;
 *   · `invoice.payment_failed`: Stripe deja de reintentar, un aviso, un solo
 *     reintento a los días del campus; el mismo aviso repetido no avisa dos veces;
 *   · quitarlo cancela el calendario.
 *
 *   npx vitest run tests/cobroAutomatico309.test.js
 */

process.env.LOG_LEVEL = 'silent';
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const integrationsModel = await import('../src/modules/integrations/integrations.model.js');
const { default: linksPago } = await import('../src/modules/links-pago/index.js');
const servicio = await import('../src/modules/stripe-payments/stripe-payments.service.js');
const cobroAuto = await import('../src/modules/links-pago/links-pago.cobro-auto.js');
const { crearLink } = await import('../src/modules/links-pago/links-pago.stripe.js');

// ─── Stripe de mentira ──────────────────────────────────────────────────────
let llamadas = [];
let respuestas = [];
const fetchOriginal = globalThis.fetch;
const cuerpoDe = (b) => Object.fromEntries(new URLSearchParams(String(b || '')));
globalThis.fetch = vi.fn(async (url, opciones = {}) => {
  const metodo = (opciones.method || 'GET').toUpperCase();
  const u = new URL(String(url));
  const llamada = { metodo, ruta: u.pathname, query: Object.fromEntries(u.searchParams), cuerpo: cuerpoDe(opciones.body), clave: opciones.headers?.['Idempotency-Key'] || null };
  llamadas.push(llamada);
  const r = respuestas.find(([m, ruta]) => m === metodo && (typeof ruta === 'string' ? u.pathname === ruta : ruta.test(u.pathname)));
  if (!r) throw new Error(`Stripe de mentira: sin respuesta para ${metodo} ${u.pathname}`);
  const [, , status, body] = r;
  const datos = typeof body === 'function' ? body(llamada) : body ?? {};
  return { ok: status < 400, status, json: async () => datos, text: async () => JSON.stringify(datos) };
});
const de = (metodo, ruta) => llamadas.filter((l) => l.metodo === metodo && (typeof ruta === 'string' ? l.ruta === ruta : ruta.test(l.ruta)));
let n = 0;
const BASICAS = () => [
  ['GET', '/v1/subscription_schedules', 200, { data: [] }],
  ['GET', '/v1/invoices', 200, { data: [] }],
  ['POST', '/v1/prices', 200, () => ({ id: `price_ca_${++n}` })],
  ['POST', '/v1/payment_links', 200, () => ({ id: `plink_ca_${MARCA}_${++n}`, url: `https://buy.stripe.com/test_ca_${n}` })],
  ['POST', /^\/v1\/payment_links\/[^/]+$/, 200, { id: 'plink', active: false }],
  ['POST', '/v1/subscription_schedules', 200, () => ({ id: `sub_sched_${MARCA}_${++n}`, status: 'not_started' })],
  ['GET', /^\/v1\/subscription_schedules\/[^/]+$/, 200, (l) => ({ id: l.ruta.split('/').pop(), status: 'not_started', phases: [] })],
  ['POST', /^\/v1\/subscription_schedules\/[^/]+\/cancel$/, 200, { status: 'canceled' }],
  ['POST', /^\/v1\/subscription_schedules\/[^/]+$/, 200, (l) => ({ id: l.ruta.split('/').pop(), status: 'not_started' })],
];

// ─── Datos ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(linksPago.prefix, linksPago.router);
app.use(errorHandler);
const api = supertest(app);

const MARCA = `CA309${Date.now().toString(36)}`;
const m = MARCA.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const CLAVE_RK = 'rk_' + 'test_EscrituraDeMentira309ca';
const CLAVE_LECTURA = 'rk_' + 'test_LecturaDeMentira309caxy';
let A; let B;
const p = {};
const prod = {};
const hoy = cobroAuto.hoyEnMadrid();
const dentroDe = (dias) => {
  const d = new Date(`${hoy}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

async function ponerClave(projectId, provider, clave) {
  const e = encrypt(clave);
  await integrationsModel.upsert({ projectId, provider, active: true, encrypted_value: e.encrypted, iv: e.iv, auth_tag: e.authTag, config_public: {} });
}
async function ventaConPlan({ campus = A, importes = [300, 300, 300], dias = [0, 30, 60], total = null } = {}) {
  const lead = (await one('INSERT INTO leads (project_id, nombre, email, telefono, responsable_id, status) VALUES ($1, $2, $3, $4, $5, \'nuevo\') RETURNING id',
    [campus, `${MARCA} alumno`, `alumno${Math.random().toString(36).slice(2, 8)}@${m}.test`, '+34600000000', p.gestora.id])).id;
  const venta = (await one(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado, fecha_conversion, vendedora_id)
     VALUES ($1, $2, $3, $4, $5, 0, CURRENT_DATE, $6) RETURNING id`,
    [lead, campus, `${MARCA} máster`, prod[campus], total ?? importes.reduce((a, b) => a + b, 0), p.gestora.id])).id;
  for (let i = 0; i < importes.length; i += 1) {
    await q('INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento) VALUES ($1, $2, $3, $4)',
      [venta, i + 1, importes[i], dentroDe(dias[i])]);
  }
  const cuotas = await q('SELECT id, numero FROM conversion_installments WHERE conversion_id = $1 ORDER BY numero', [venta]);
  return { lead, venta, cuotas };
}
const plan = (u, cuerpo) => api.post('/api/links-pago/plan').set(como(u)).send(cuerpo);

/** El alumno paga el link de la primera cuota con su tarjeta (lo que manda Stripe). */
async function pagarLink(link, { lead, venta }, { pm = `pm_${MARCA}_1`, cus = `cus_${MARCA}`, id = `ch_${MARCA}_${++n}` } = {}) {
  const cargo = {
    id, amount: Math.round(Number(link.importe) * 100), currency: 'eur', status: 'succeeded', created: Math.floor(Date.now() / 1000),
    customer: cus, payment_method: pm, payment_intent: `pi_${id}`,
    billing_details: { email: 'pagador@otro.test', name: `${MARCA} Pagador` },
    metadata: { crm_link_id: String(link.id), crm_project_id: String(A), crm_lead_id: String(lead), crm_conversion_id: String(venta), crm_user_id: String(p.gestora.id), crm_entorno: 'local' },
    payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } },
  };
  await servicio.handleWebhookEvent(A, { id: `evt_${cargo.id}`, type: 'charge.succeeded', data: { object: cargo } });
  return cargo;
}

beforeAll(async () => {
  const campus = async (x) => {
    const r = await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${x}`, `${m}-${x}`, `${MARCA}-k-${x}`]);
    ids.projects.push(r.id);
    return r.id;
  };
  A = await campus('a');
  B = await campus('b');
  const persona = async (x, role) => {
    const u = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', $3) RETURNING id, role',
      [`${MARCA} ${x}`, `${x}@${m}.test`, role]);
    ids.users.push(u.id);
    for (const c of [A, B]) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  p.admin = await persona('admin', 'admin');
  p.gestora = await persona('gestora', 'gestor');
  for (const c of [A, B]) {
    prod[c] = (await one('INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, 900, \'EUR\') RETURNING id', [c, `${MARCA} máster`])).id;
    await ponerClave(c, 'stripe_links', CLAVE_RK);
    await ponerClave(c, 'stripe', CLAVE_LECTURA);
  }
  // A lo permite (reintento a los 3 días); B no.
  await q('UPDATE projects SET links_pago_cobro_auto = TRUE, links_pago_cobro_auto_reintento_dias = 3 WHERE id = $1', [A]);
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

beforeEach(() => { llamadas = []; respuestas = BASICAS(); });

// ─── Lo puro ────────────────────────────────────────────────────────────────

describe('qué se puede programar en Stripe (planificar)', () => {
  const hoyF = '2026-11-19';
  it('cada cuota con su fecha e importe; cada fase dura hasta la siguiente; la última, un día', () => {
    const r = cobroAuto.planificar({ hoy: hoyF, pendiente: 900, cuotas: [
      { id: 1, numero: 2, importe: 300, vence: '2026-11-25' },
      { id: 2, numero: 3, importe: 300, vence: '2026-12-25' },
      { id: 3, numero: 4, importe: 300, vence: '2027-01-10' },
    ] });
    expect(r.problemas).toEqual([]);
    expect(r.fases.map((f) => [f.installmentId, f.fecha, f.importe, f.dias])).toEqual([
      [1, '2026-11-25', 300, 30], [2, '2026-12-25', 300, 16], [3, '2027-01-10', 300, 1]]);
  });
  it('hoy o antes no se programa; nunca más de lo pendiente; menos de 0,50 €, no', () => {
    const r = cobroAuto.planificar({ hoy: hoyF, pendiente: 450.3, cuotas: [
      { id: 1, numero: 1, importe: 300, vence: '2026-11-19' },
      { id: 2, numero: 2, importe: 300, vence: '2026-12-19' },
      { id: 3, numero: 3, importe: 300, vence: '2027-01-19' },
    ] });
    // La 1 (hoy) se come 300 de lo pendiente aunque no se programe: la 2 cobra 150,30 y la 3 nada.
    expect(r.fases.map((f) => [f.installmentId, f.importe])).toEqual([[2, 150.3]]);
    expect(r.problemas.map((x) => x.installmentId)).toEqual([1, 3]);
    expect(r.problemas[0].motivo).toMatch(/ya pasó/);
    expect(cobroAuto.planificar({ hoy: hoyF, pendiente: 0.4, cuotas: [{ id: 9, numero: 1, importe: 0.4, vence: '2026-12-01' }] })
      .problemas[0].motivo).toMatch(/0,50/);
  });
  it('más de un año entre dos cuotas: Stripe no lo admite y se dice', () => {
    const r = cobroAuto.planificar({ hoy: hoyF, pendiente: 600, cuotas: [
      { id: 1, numero: 1, importe: 300, vence: '2026-12-01' }, { id: 2, numero: 2, importe: 300, vence: '2028-01-01' }] });
    expect(r.fases.map((f) => f.installmentId)).toEqual([1]);
    expect(r.problemas[0]).toMatchObject({ installmentId: 2 });
  });
  it('el instante de cobro es su fecha a las 9:00 de Madrid (hora de invierno)', () => {
    expect(new Date(cobroAuto.instanteDe('2026-12-25') * 1000).toISOString()).toBe('2026-12-25T08:00:00.000Z');
  });
  it('el link que guarda la tarjeta: cliente, setup_future_usage y el consentimiento junto al botón', async () => {
    respuestas = [['POST', '/v1/payment_links', 200, { id: 'plink_x', url: 'u' }]];
    const texto = cobroAuto.textoConsentimiento({ campus: 'ISEIH', cuotas: [{ importe: 300 }, { importe: 300 }] });
    expect(texto).toMatch(/autorizas a ISEIH/);
    expect(texto).toMatch(/2 cuotas, 600,00 €/);
    await crearLink('rk_test_x', { priceId: 'price_1', metadata: { a: '1' }, guardaTarjeta: { consentimiento: texto } });
    const c = de('POST', '/v1/payment_links')[0].cuerpo;
    expect(c['payment_intent_data[setup_future_usage]']).toBe('off_session');
    expect(c.customer_creation).toBe('always');
    expect(c['custom_text[submit][message]']).toBe(texto);
  });
});

// ─── Con la base ────────────────────────────────────────────────────────────

describe('activarlo al generar el plan de pago', { timeout: 60_000 }, () => {
  it('campus que no lo permite: 409 y no se crea nada; el plan dice por qué', async () => {
    const saved = A;
    A = B;
    try {
      const v = await ventaConPlan({ campus: B });
      const ver = await api.get('/api/links-pago/plan').query({ conversionId: v.venta }).set(como(p.gestora));
      expect(ver.body.data.cobro_automatico).toMatchObject({ disponible: false, activo: false });
      expect(ver.body.data.cobro_automatico.motivo_no_disponible).toMatch(/no tiene permitido/);
      const r = await plan(p.gestora, { conversionId: v.venta, cobroAutomatico: true });
      expect(r.status).toBe(409);
      expect(de('POST', '/v1/payment_links')).toHaveLength(0);
    } finally { A = saved; }
  });

  it('clave sin permisos de schedules: 424 diciendo qué permisos faltan', async () => {
    const v = await ventaConPlan();
    respuestas = [['GET', '/v1/subscription_schedules', 403, { error: { message: 'The provided key does not have the required permissions' } }]];
    const r = await plan(p.gestora, { conversionId: v.venta, cobroAutomatico: true });
    expect(r.status).toBe(424);
    expect(r.body.code).toBe('CLAVE_SIN_PERMISO_DE_COBRO');
    expect(r.body.error).toMatch(/Subscription Schedules/);
    expect(await one('SELECT activo FROM conversion_cobro_auto WHERE conversion_id = $1', [v.venta])).toBeUndefined();
  });

  it('solo el link de la primera cuota, que guarda la tarjeta; pagarlo programa las demás en Stripe con sus fechas', async () => {
    const v = await ventaConPlan();
    const r = await plan(p.gestora, { conversionId: v.venta, cobroAutomatico: true });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.creados).toBe(1);
    const links = await q('SELECT id, importe, guarda_tarjeta, installment_id FROM payment_links WHERE conversion_id = $1', [v.venta]);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ guarda_tarjeta: true, installment_id: v.cuotas[0].id });
    expect(de('POST', '/v1/payment_links')[0].cuerpo['payment_intent_data[setup_future_usage]']).toBe('off_session');
    const estado = r.body.data.cobro_automatico;
    expect(estado).toMatchObject({ activo: true, tarjeta: null });
    expect(estado.cuotas[0].guarda_tarjeta).toBe(true);
    expect(de('POST', '/v1/subscription_schedules')).toHaveLength(0); // sin tarjeta, nada en Stripe todavía

    // El alumno paga la cuota 1 con su link: entra en su venta, salda la 1 y guarda la tarjeta.
    llamadas = [];
    await pagarLink({ ...links[0] }, v);
    const ca = await one('SELECT * FROM conversion_cobro_auto WHERE conversion_id = $1', [v.venta]);
    expect(ca).toMatchObject({ tarjeta_marca: 'visa', tarjeta_ultimos4: '4242', stripe_customer_id: `cus_${MARCA}` });
    expect(ca.stripe_schedule_id).toMatch(new RegExp(`^sub_sched_${MARCA}_`));
    expect((await one('SELECT fecha_cobro FROM conversion_installments WHERE id = $1', [v.cuotas[0].id])).fecha_cobro).not.toBeNull();

    // Un precio por cuota (cada N días, N = lo que dura su fase) y un calendario con una fase por cuota.
    const precios = de('POST', '/v1/prices').map((l) => l.cuerpo);
    expect(precios.map((c) => [c.unit_amount, c['recurring[interval]'], c['recurring[interval_count]']]))
      .toEqual([['30000', 'day', '30'], ['30000', 'day', '1']]);
    const cal = de('POST', '/v1/subscription_schedules')[0].cuerpo;
    expect(cal.customer).toBe(`cus_${MARCA}`);
    expect(cal['default_settings[default_payment_method]']).toBe(`pm_${MARCA}_1`);
    expect(cal.end_behavior).toBe('cancel');
    expect(Number(cal.start_date)).toBe(cobroAuto.instanteDe(dentroDe(30)));
    expect(Number(cal['phases[0][end_date]'])).toBe(cobroAuto.instanteDe(dentroDe(60)));
    expect(cal['phases[0][billing_cycle_anchor]']).toBe('phase_start');
    expect(cal['phases[1][metadata][crm_installment_id]']).toBe(String(v.cuotas[2].id));
    const enStripe = await q('SELECT installment_id, estado, fecha_programada::text AS f FROM cobro_auto_cuotas WHERE conversion_id = $1 ORDER BY installment_id', [v.venta]);
    expect(enStripe).toEqual([
      { installment_id: v.cuotas[1].id, estado: 'programada', f: dentroDe(30) },
      { installment_id: v.cuotas[2].id, estado: 'programada', f: dentroDe(60) }]);

    // Repasar sin cambios no llama a Stripe.
    llamadas = [];
    expect((await cobroAuto.sincronizar(v.venta)).sinCambios).toBe(true);
    expect(llamadas).toHaveLength(0);

    // La gestora cambia la fecha de la cuota 3: se rehacen las fases (calendario sin empezar).
    await q('UPDATE conversion_installments SET fecha_vencimiento = $2 WHERE id = $1', [v.cuotas[2].id, dentroDe(75)]);
    const s = await cobroAuto.sincronizar(v.venta);
    expect(s.error).toBeUndefined();
    const cambio = de('POST', `/v1/subscription_schedules/${ca.stripe_schedule_id}`)[0].cuerpo;
    expect(Number(cambio['phases[0][start_date]'])).toBe(cobroAuto.instanteDe(dentroDe(30)));
    expect(Number(cambio['phases[0][end_date]'])).toBe(cobroAuto.instanteDe(dentroDe(75)));
    expect((await one('SELECT fecha_programada::text AS f FROM cobro_auto_cuotas WHERE installment_id = $1', [v.cuotas[2].id])).f).toBe(dentroDe(75));

    // La ficha lo enseña cuota a cuota.
    const ver = await api.get('/api/links-pago/cobro-automatico').query({ conversionId: v.venta }).set(como(p.gestora));
    expect(ver.status).toBe(200);
    expect(ver.body.data.tarjeta).toMatchObject({ marca: 'visa', ultimos4: '4242', caduca: '12/2030' });
    expect(ver.body.data.cuotas.map((c) => [c.numero, c.estado, c.fecha_programada])).toEqual([[2, 'programada', dentroDe(30)], [3, 'programada', dentroDe(75)]]);
  });
});

describe('lo que llega de Stripe: las facturas de las cuotas', { timeout: 60_000 }, () => {
  async function preparada() {
    const v = await ventaConPlan();
    await plan(p.gestora, { conversionId: v.venta, cobroAutomatico: true });
    const [link] = await q('SELECT id, importe, guarda_tarjeta FROM payment_links WHERE conversion_id = $1', [v.venta]);
    await pagarLink(link, v, { cus: `cus_${MARCA}_${v.venta}` });
    const precios = await q('SELECT installment_id, stripe_price_id FROM cobro_auto_cuotas WHERE conversion_id = $1 ORDER BY installment_id', [v.venta]);
    return { ...v, precios, cus: `cus_${MARCA}_${v.venta}` };
  }
  const factura = (v, precio, extra = {}) => ({
    id: `in_${MARCA}_${precio}`, object: 'invoice', customer: v.cus, amount_paid: 30000, attempt_count: 1, auto_advance: true,
    hosted_invoice_url: `https://invoice.stripe.com/i/${precio}`, payment_intent: `pi_in_${precio}`,
    lines: { data: [{ price: { id: precio }, amount: 30000 }] }, ...extra,
  });

  it('invoice.paid de la cuota 3 salda la 3 (no la 2, que es la primera pendiente)', async () => {
    const v = await preparada();
    const precio3 = v.precios[1].stripe_price_id;
    const inv = factura(v, precio3);
    respuestas.push(['GET', '/v1/charges', 200, { data: [{
      id: `ch_${MARCA}_c3`, amount: 30000, currency: 'eur', status: 'succeeded', created: Math.floor(Date.now() / 1000),
      customer: v.cus, payment_method: `pm_${MARCA}_1`, payment_intent: inv.payment_intent, invoice: inv.id,
      billing_details: { email: null, name: null }, metadata: {}, payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } },
    }] }]);
    respuestas.push(['GET', `/v1/invoices/${inv.id}`, 200, inv]);
    await servicio.handleWebhookEvent(A, { id: `evt_${MARCA}_paid3`, type: 'invoice.paid', data: { object: inv } });
    const cuotas = await q('SELECT numero, fecha_cobro IS NOT NULL AS cobrada FROM conversion_installments WHERE conversion_id = $1 ORDER BY numero', [v.venta]);
    expect(cuotas).toEqual([{ numero: 1, cobrada: true }, { numero: 2, cobrada: false }, { numero: 3, cobrada: true }]);
    expect((await one('SELECT estado FROM cobro_auto_cuotas WHERE installment_id = $1', [v.cuotas[2].id])).estado).toBe('cobrada');
    const pagos = await q('SELECT importe::float8 AS importe FROM conversion_payments WHERE conversion_id = $1 ORDER BY id', [v.venta]);
    expect(pagos).toEqual([{ importe: 300 }, { importe: 300 }]);
  });

  it('invoice.payment_failed: Stripe deja de reintentar, aviso una vez, un solo reintento a los 3 días', async () => {
    const v = await preparada();
    const precio2 = v.precios[0].stripe_price_id;
    const inv = factura(v, precio2, { amount_paid: 0 });
    respuestas.push(['GET', `/v1/payment_intents/${inv.payment_intent}`, 200, { id: inv.payment_intent, last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.' } }]);
    respuestas.push(['POST', `/v1/invoices/${inv.id}`, 200, { id: inv.id, auto_advance: false }]);
    await servicio.handleWebhookEvent(A, { id: `evt_${MARCA}_f1`, type: 'invoice.payment_failed', data: { object: inv } });
    const fila = await one('SELECT estado, intentos, error_codigo, reintento_el::text AS r, url_pago FROM cobro_auto_cuotas WHERE installment_id = $1', [v.cuotas[1].id]);
    expect(fila).toMatchObject({ estado: 'fallida', intentos: 1, error_codigo: 'insufficient_funds', r: dentroDe(3), url_pago: inv.hosted_invoice_url });
    expect(de('POST', `/v1/invoices/${inv.id}`)[0].cuerpo.auto_advance).toBe('false');
    const avisos = () => q('SELECT title FROM admin_notifications WHERE type = \'cobro_automatico_fallido\' AND (metadata->>\'conversion_id\')::int = $1', [v.venta]);
    expect(await avisos()).toHaveLength(1);

    // El mismo aviso otra vez: ni otro intento ni otro aviso.
    await servicio.handleWebhookEvent(A, { id: `evt_${MARCA}_f1b`, type: 'invoice.payment_failed', data: { object: inv } });
    expect((await one('SELECT intentos FROM cobro_auto_cuotas WHERE installment_id = $1', [v.cuotas[1].id])).intentos).toBe(1);
    expect(await avisos()).toHaveLength(1);

    // Antes de su día no se reintenta; el día que toca, una vez (y solo una).
    llamadas = [];
    respuestas.push(['POST', `/v1/invoices/${inv.id}/pay`, 200, { id: inv.id, status: 'paid' }]);
    await cobroAuto.vuelta({ ahora: new Date(`${dentroDe(1)}T12:00:00Z`) });
    expect(de('POST', `/v1/invoices/${inv.id}/pay`)).toHaveLength(0);
    await cobroAuto.vuelta({ ahora: new Date(`${dentroDe(3)}T12:00:00Z`) });
    await cobroAuto.vuelta({ ahora: new Date(`${dentroDe(4)}T12:00:00Z`) });
    const reintentos = de('POST', `/v1/invoices/${inv.id}/pay`);
    expect(reintentos).toHaveLength(1);
    expect(reintentos[0].cuerpo.off_session).toBe('true');
    expect(reintentos[0].clave).toMatch(/reintento/);
  });

  it('quitar el cobro automático cancela el calendario en Stripe', async () => {
    const v = await preparada();
    llamadas = [];
    const { stripe_schedule_id: sched } = await one('SELECT stripe_schedule_id FROM conversion_cobro_auto WHERE conversion_id = $1', [v.venta]);
    expect(sched).toBeTruthy();
    const r = await api.put('/api/links-pago/cobro-automatico').set(como(p.gestora)).send({ conversionId: v.venta, activo: false });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.activo).toBe(false);
    expect(de('POST', `/v1/subscription_schedules/${sched}/cancel`)).toHaveLength(1);
    expect((await one('SELECT stripe_schedule_id FROM conversion_cobro_auto WHERE conversion_id = $1', [v.venta])).stripe_schedule_id).toBeNull();
    expect((await q('SELECT estado FROM cobro_auto_cuotas WHERE conversion_id = $1', [v.venta])).every((c) => c.estado === 'quitada')).toBe(true);
  });
});
