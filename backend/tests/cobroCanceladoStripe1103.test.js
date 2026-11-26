import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM#1103 / CRM-ISEIE#759 · Cobro automático cancelado en Stripe (migración 343).
 * Contra la base local de verdad y con un Stripe de mentira que apunta cada llamada.
 *
 * Carlos: «la persona cancela la suscripción en Stripe y no se hace el pago: como
 * no se cobra, no sale el aviso de impago».
 *
 *   · cobro automático del CRM (309): `customer.subscription.deleted` del
 *     calendario → las cuotas programadas siguen pendientes, marcadas con fecha y
 *     motivo; el cobro automático se quita; un aviso a la gestora y a los admins.
 *     El mismo aviso repetido, o el `subscription_schedule.canceled` de la misma
 *     cancelación, no marca ni avisa otra vez. Y el CRM no vuelve a programarlo;
 *   · lo que cancela el CRM (quitar el cobro automático) no es una cancelación;
 *   · el final normal del calendario tampoco;
 *   · `invoice.voided` de una cuota fallida: cancelada; su link nuevo no anula
 *     nada (la factura ya está anulada). `invoice.marked_uncollectible`: antes
 *     de crear su link, se anula la factura en Stripe (nunca dos maneras de pagar);
 *   · venta a plazos (#747): suscripción cancelada con la venta a medio pagar →
 *     `cancelada_en_stripe`, cuotas marcadas, aviso; pagada entera → cerrada sin
 *     aviso; cerrándola el CRM → nada; impagada → marcada y, si vuelve a activa,
 *     fuera las marcas; alumno de baja → marcada sin aviso;
 *   · la ficha (detalle de la venta) y «Por cobrar» enseñan la marca;
 *   · el repaso de lo que Stripe canceló antes: sin aplicar no toca nada.
 *
 *   npx vitest run tests/cobroCanceladoStripe1103.test.js
 */

process.env.LOG_LEVEL = 'silent';
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const integrationsModel = await import('../src/modules/integrations/integrations.model.js');
const { default: linksPago } = await import('../src/modules/links-pago/index.js');
const servicio = await import('../src/modules/stripe-payments/stripe-payments.service.js');
const cobroAuto = await import('../src/modules/links-pago/links-pago.cobro-auto.js');
const cancelado = await import('../src/modules/stripe-payments/cobro-cancelado.service.js');
const accounting = await import('../src/modules/accounting/accounting.model.js');
const conversionModel = await import('../src/modules/conversions/conversion.model.js');

// ─── Stripe de mentira ──────────────────────────────────────────────────────
let llamadas = [];
let respuestas = [];
const fetchOriginal = globalThis.fetch;
const cuerpoDe = (b) => Object.fromEntries(new URLSearchParams(String(b || '')));
globalThis.fetch = vi.fn(async (url, opciones = {}) => {
  const metodo = (opciones.method || 'GET').toUpperCase();
  const u = new URL(String(url));
  const llamada = { metodo, ruta: u.pathname, cuerpo: cuerpoDe(opciones.body) };
  llamadas.push(llamada);
  const r = respuestas.find(([m, ruta]) => m === metodo && (typeof ruta === 'string' ? u.pathname === ruta : ruta.test(u.pathname)));
  if (!r) throw new Error(`Stripe de mentira: sin respuesta para ${metodo} ${u.pathname}`);
  const [, , status, body] = r;
  const datos = typeof body === 'function' ? body(llamada) : body ?? {};
  return { ok: status < 400, status, json: async () => datos, text: async () => JSON.stringify(datos) };
});
const de = (metodo, ruta) => llamadas.filter((l) => l.metodo === metodo && (typeof ruta === 'string' ? l.ruta === ruta : ruta.test(l.ruta)));
let n = 0;
const MARCA = `CC1103${Date.now().toString(36)}`;
const m = MARCA.toLowerCase();
const BASICAS = () => [
  ['GET', '/v1/subscription_schedules', 200, { data: [] }],
  ['GET', '/v1/invoices', 200, { data: [] }],
  ['POST', '/v1/prices', 200, () => ({ id: `price_cc_${MARCA}_${++n}` })],
  ['POST', '/v1/payment_links', 200, () => ({ id: `plink_cc_${MARCA}_${++n}`, url: `https://buy.stripe.com/test_cc_${n}` })],
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

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const CLAVE_RK = 'rk_' + 'test_EscrituraDeMentira1103cc';
const CLAVE_LECTURA = 'rk_' + 'test_LecturaDeMentira1103ccxy';
let A;
const p = {};
let prod;
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
async function ventaConPlan({ importes = [300, 300, 300], dias = [0, 30, 60], cobrado = 0, sub = null } = {}) {
  const lead = (await one('INSERT INTO leads (project_id, nombre, email, telefono, responsable_id, status) VALUES ($1, $2, $3, $4, $5, \'nuevo\') RETURNING id',
    [A, `${MARCA} alumno`, `alumno${Math.random().toString(36).slice(2, 8)}@${m}.test`, '+34600000000', p.gestora.id])).id;
  const venta = (await one(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado, fecha_conversion, vendedora_id,
                              stripe_subscription_id, suscripcion_estado)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, $7, $8, $9) RETURNING id`,
    [lead, A, `${MARCA} máster`, prod, importes.reduce((a, b) => a + b, 0), cobrado, p.gestora.id, sub, sub ? 'activa' : null])).id;
  for (let i = 0; i < importes.length; i += 1) {
    await q('INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento) VALUES ($1, $2, $3, $4)',
      [venta, i + 1, importes[i], dentroDe(dias[i])]);
  }
  if (cobrado) await q('INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, $2, CURRENT_DATE)', [venta, cobrado]);
  const cuotas = await q('SELECT id, numero FROM conversion_installments WHERE conversion_id = $1 ORDER BY numero', [venta]);
  return { lead, venta, cuotas };
}
const plan = (u, cuerpo) => api.post('/api/links-pago/plan').set(como(u)).send(cuerpo);

/** Venta con cobro automático: el alumno pagó la cuota 1 y guardó la tarjeta; la 2 y la 3, programadas. */
async function preparada() {
  const v = await ventaConPlan();
  await plan(p.gestora, { conversionId: v.venta, cobroAutomatico: true });
  const [link] = await q('SELECT id, importe FROM payment_links WHERE conversion_id = $1', [v.venta]);
  const cus = `cus_${MARCA}_${v.venta}`;
  const cargo = {
    id: `ch_${MARCA}_${++n}`, amount: Math.round(Number(link.importe) * 100), currency: 'eur', status: 'succeeded', created: Math.floor(Date.now() / 1000),
    customer: cus, payment_method: `pm_${MARCA}_${v.venta}`, payment_intent: `pi_${MARCA}_${n}`,
    billing_details: { email: 'pagador@otro.test', name: `${MARCA} Pagador` },
    metadata: { crm_link_id: String(link.id), crm_project_id: String(A), crm_lead_id: String(v.lead), crm_conversion_id: String(v.venta), crm_user_id: String(p.gestora.id), crm_entorno: 'local' },
    payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } },
  };
  await servicio.handleWebhookEvent(A, { id: `evt_${cargo.id}`, type: 'charge.succeeded', data: { object: cargo } });
  const ca = await one('SELECT stripe_schedule_id FROM conversion_cobro_auto WHERE conversion_id = $1', [v.venta]);
  const precios = await q('SELECT installment_id, stripe_price_id FROM cobro_auto_cuotas WHERE conversion_id = $1 ORDER BY installment_id', [v.venta]);
  return { ...v, sched: ca.stripe_schedule_id, cus, precios };
}

const avisos = (venta) => q('SELECT title, message, target_user_ids, link_path FROM admin_notifications WHERE type = \'stripe_cobro_cancelado\' AND (metadata->>\'conversion_id\')::int = $1', [venta]);
const cuotaDe = (id) => one(`SELECT ci.fecha_cobro, ci.cobro_auto_cancelado_el, ci.cobro_auto_cancelado_motivo, cac.estado, cac.url_pago, cac.reintento_el
                               FROM conversion_installments ci LEFT JOIN cobro_auto_cuotas cac ON cac.installment_id = ci.id WHERE ci.id = $1`, [id]);
const subBorrada = (obj, id = `evt_${MARCA}_${++n}`) => ({ id, type: 'customer.subscription.deleted', created: Math.floor(Date.now() / 1000), data: { object: obj } });

beforeAll(async () => {
  const r = await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id', [`${MARCA} a`, `${m}-a`, `${MARCA}-k-a`]);
  A = r.id;
  ids.projects.push(A);
  const persona = async (x, role) => {
    const u = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', $3) RETURNING id, role',
      [`${MARCA} ${x}`, `${x}@${m}.test`, role]);
    ids.users.push(u.id);
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, A]);
    return u;
  };
  p.admin = await persona('admin', 'admin');
  p.gestora = await persona('gestora', 'gestor');
  prod = (await one('INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, 900, \'EUR\') RETURNING id', [A, `${MARCA} máster`])).id;
  await ponerClave(A, 'stripe_links', CLAVE_RK);
  await ponerClave(A, 'stripe', CLAVE_LECTURA);
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

// ─── El cobro automático del CRM (309) ──────────────────────────────────────

describe('cobro automático: el alumno cancela la suscripción en Stripe', { timeout: 60_000 }, () => {
  it('las cuotas siguen pendientes y marcadas, se quita el cobro automático y se avisa UNA vez', async () => {
    const v = await preparada();
    expect(v.sched).toBeTruthy();
    const sub = {
      id: `sub_${MARCA}_${v.venta}`, object: 'subscription', status: 'canceled', schedule: v.sched, customer: v.cus,
      canceled_at: Math.floor(Date.now() / 1000), metadata: { crm_cobro_auto: '1', crm_conversion_id: String(v.venta) },
      cancellation_details: { reason: 'cancellation_requested', feedback: 'too_expensive', comment: null },
    };
    const r = await servicio.handleWebhookEvent(A, subBorrada(sub, `evt_${MARCA}_borrada`));
    expect(r).toMatchObject({ processed: 'customer.subscription.deleted' });

    for (const c of [v.cuotas[1], v.cuotas[2]]) {
      const x = await cuotaDe(c.id);
      expect(x.fecha_cobro).toBeNull();               // sigue pendiente: si vence, es impago
      expect(x.estado).toBe('cancelada');
      expect(x.cobro_auto_cancelado_el).not.toBeNull();
      expect(x.cobro_auto_cancelado_motivo).toMatch(/demasiado caro/);
    }
    const ca = await one('SELECT activo, desactivado_por, cancelado_en_stripe_el, cancelado_en_stripe_motivo FROM conversion_cobro_auto WHERE conversion_id = $1', [v.venta]);
    expect(ca).toMatchObject({ activo: false, desactivado_por: null });
    expect(ca.cancelado_en_stripe_el).not.toBeNull();

    const a = await avisos(v.venta);
    expect(a).toHaveLength(1);
    expect(a[0].title).toMatch(/2 cuotas/);
    expect(a[0].target_user_ids).toEqual(expect.arrayContaining([p.gestora.id, p.admin.id]));
    expect(a[0].link_path).toBe(cancelado.rutaDeLaVenta(v.venta));

    // Stripe reenvía el aviso y manda además el del calendario: ni otra marca ni otro aviso.
    await servicio.handleWebhookEvent(A, subBorrada(sub, `evt_${MARCA}_borrada`));
    const r2 = await servicio.handleWebhookEvent(A, { id: `evt_${MARCA}_sched`, type: 'subscription_schedule.canceled', data: { object: { id: v.sched, status: 'canceled' } } });
    expect(r2.skipped).toBeTruthy();
    expect(await avisos(v.venta)).toHaveLength(1);
    expect(await q('SELECT 1 FROM stripe_cobros_cancelados WHERE conversion_id = $1', [v.venta])).toHaveLength(1);

    // El CRM no lo vuelve a programar solo (el alumno lo canceló): ningún calendario nuevo.
    llamadas = [];
    await cobroAuto.sincronizar(v.venta);
    await q('UPDATE conversion_installments SET fecha_vencimiento = $2 WHERE id = $1', [v.cuotas[2].id, dentroDe(80)]);
    await cobroAuto.sincronizar(v.venta);
    expect(de('POST', '/v1/subscription_schedules')).toHaveLength(0);
    expect((await one('SELECT stripe_schedule_id FROM conversion_cobro_auto WHERE conversion_id = $1', [v.venta])).stripe_schedule_id).toBeNull();

    // La ficha del cobro automático lo cuenta.
    const ver = await api.get('/api/links-pago/cobro-automatico').query({ conversionId: v.venta }).set(como(p.gestora));
    expect(ver.body.data.cancelado_en_stripe).toMatchObject({ motivo: expect.stringMatching(/se canceló/) });
    expect(ver.body.data.cuotas.map((c) => c.estado)).toEqual(['cancelada', 'cancelada']);
    expect(ver.body.data.cuotas[0].cancelada_el).toBeTruthy();

    // La venta y «Por cobrar» enseñan la marca.
    const venta = await conversionModel.findById(v.venta);
    expect(venta.installments.filter((c) => c.cobro_auto_cancelado_el)).toHaveLength(2);
    const pc = await accounting.getReceivable({ projectId: A });
    expect(pc.items.filter((i) => i.conversion_id === v.venta && i.cobro_auto_cancelado_el)).toHaveLength(2);
  });

  it('lo que cancela el propio CRM (quitar el cobro automático) no es una cancelación: ni marca ni aviso', async () => {
    const v = await preparada();
    const r = await api.put('/api/links-pago/cobro-automatico').set(como(p.gestora)).send({ conversionId: v.venta, activo: false });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const res = await servicio.handleWebhookEvent(A, subBorrada({
      id: `sub_${MARCA}_q${v.venta}`, status: 'canceled', schedule: v.sched, metadata: { crm_cobro_auto: '1', crm_conversion_id: String(v.venta) },
    }));
    expect(res.skipped).toBeTruthy();
    expect((await cuotaDe(v.cuotas[1].id)).estado).toBe('quitada');
    expect((await cuotaDe(v.cuotas[1].id)).cobro_auto_cancelado_el).toBeNull();
    expect(await avisos(v.venta)).toHaveLength(0);
  });

  it('el final normal del calendario (ya no queda ninguna programada) no es una cancelación', async () => {
    const v = await preparada();
    await q('UPDATE cobro_auto_cuotas SET estado = \'cobrada\' WHERE conversion_id = $1', [v.venta]);
    const res = await servicio.handleWebhookEvent(A, subBorrada({ id: `sub_${MARCA}_f${v.venta}`, status: 'canceled', schedule: v.sched }));
    expect(res.skipped).toMatch(/fin del calendario/);
    expect((await one('SELECT activo FROM conversion_cobro_auto WHERE conversion_id = $1', [v.venta])).activo).toBe(true);
    expect(await avisos(v.venta)).toHaveLength(0);
  });
});

describe('cobro automático: la factura de una cuota, anulada o incobrable', { timeout: 60_000 }, () => {
  const factura = (v, precio, extra = {}) => ({
    id: `in_${MARCA}_${precio}`, object: 'invoice', customer: v.cus, amount_paid: 0, attempt_count: 1,
    hosted_invoice_url: `https://invoice.stripe.com/i/${precio}`, lines: { data: [{ price: { id: precio } }] }, ...extra,
  });

  it('invoice.voided de una cuota fallida: cancelada, sin reintento ni su página; su link nuevo no anula nada', async () => {
    const v = await preparada();
    const precio2 = v.precios[0].stripe_price_id;
    const inv = factura(v, precio2);
    await q(`UPDATE cobro_auto_cuotas SET estado = 'fallida', stripe_invoice_id = $2, url_pago = $3, intentos = 1, reintento_el = $4
              WHERE installment_id = $1`, [v.cuotas[1].id, inv.id, inv.hosted_invoice_url, dentroDe(3)]);
    await servicio.handleWebhookEvent(A, { id: `evt_${MARCA}_void`, type: 'invoice.voided', data: { object: { ...inv, status: 'void' } } });
    const x = await cuotaDe(v.cuotas[1].id);
    expect(x).toMatchObject({ estado: 'cancelada', url_pago: null, reintento_el: null, fecha_cobro: null });
    expect(x.cobro_auto_cancelado_motivo).toMatch(/anuló/);
    // La cuota 3 sigue programada: una factura suelta no cancela el calendario.
    expect((await cuotaDe(v.cuotas[2].id)).estado).toBe('programada');
    expect(await avisos(v.venta)).toHaveLength(1);
    await servicio.handleWebhookEvent(A, { id: `evt_${MARCA}_void`, type: 'invoice.voided', data: { object: { ...inv, status: 'void' } } });
    expect(await avisos(v.venta)).toHaveLength(1);

    // «Mandar link de pago» de esa cuota: la factura ya está anulada, solo se crea el link.
    llamadas = [];
    respuestas.push(['GET', `/v1/invoices/${inv.id}`, 200, { id: inv.id, status: 'void' }]);
    const r = await plan(p.gestora, { conversionId: v.venta, cuotaIds: [v.cuotas[1].id] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(de('POST', `/v1/invoices/${inv.id}/void`)).toHaveLength(0);
    expect(r.body.data.cuotas[0].link_url).toMatch(/buy\.stripe\.com/);
  });

  it('invoice.marked_uncollectible: antes de su link, el CRM anula la factura en Stripe (no se paga dos veces)', async () => {
    const v = await preparada();
    const precio2 = v.precios[0].stripe_price_id;
    const inv = factura(v, precio2);
    await q('UPDATE cobro_auto_cuotas SET estado = \'fallida\', stripe_invoice_id = $2, intentos = 1 WHERE installment_id = $1', [v.cuotas[1].id, inv.id]);
    await servicio.handleWebhookEvent(A, { id: `evt_${MARCA}_inc`, type: 'invoice.marked_uncollectible', data: { object: { ...inv, status: 'uncollectible' } } });
    expect((await cuotaDe(v.cuotas[1].id)).estado).toBe('cancelada');

    llamadas = [];
    respuestas.push(['GET', `/v1/invoices/${inv.id}`, 200, { id: inv.id, status: 'uncollectible' }]);
    respuestas.push(['POST', `/v1/invoices/${inv.id}/void`, 200, { id: inv.id, status: 'void' }]);
    const r = await plan(p.gestora, { conversionId: v.venta, cuotaIds: [v.cuotas[1].id] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const orden = llamadas.map((l) => `${l.metodo} ${l.ruta}`);
    expect(orden.indexOf(`POST /v1/invoices/${inv.id}/void`)).toBeGreaterThanOrEqual(0);
    expect(orden.indexOf(`POST /v1/invoices/${inv.id}/void`)).toBeLessThan(orden.indexOf('POST /v1/payment_links'));
  });

  it('si Stripe ya la cobró con su factura, no se crea otro link', async () => {
    const v = await preparada();
    const inv = factura(v, v.precios[0].stripe_price_id);
    await q('UPDATE cobro_auto_cuotas SET estado = \'cancelada\', stripe_invoice_id = $2 WHERE installment_id = $1', [v.cuotas[1].id, inv.id]);
    respuestas.push(['GET', `/v1/invoices/${inv.id}`, 200, { id: inv.id, status: 'paid' }]);
    llamadas = [];
    const r = await plan(p.gestora, { conversionId: v.venta, cuotaIds: [v.cuotas[1].id] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CUOTA_YA_COBRADA_EN_STRIPE');
    expect(de('POST', '/v1/payment_links')).toHaveLength(0);
  });
});

// ─── Las ventas a plazos con suscripción (#747) ─────────────────────────────

describe('venta a plazos: la suscripción de Stripe se cancela', { timeout: 60_000 }, () => {
  it('a medio pagar: cancelada en Stripe, las cuotas sin cobrar marcadas y un aviso', async () => {
    const sub = `sub_${MARCA}_pl1`;
    const v = await ventaConPlan({ cobrado: 300, sub });
    await q('UPDATE conversion_installments SET fecha_cobro = CURRENT_DATE, importe_cobrado = 300 WHERE id = $1', [v.cuotas[0].id]);
    const obj = { id: sub, status: 'canceled', canceled_at: Math.floor(Date.now() / 1000), cancellation_details: { reason: 'payment_failed' } };
    const r = await servicio.handleWebhookEvent(A, subBorrada(obj, `evt_${MARCA}_pl1`));
    expect(r.processed).toBe('customer.subscription.deleted');
    const venta = await one('SELECT suscripcion_estado, suscripcion_cerrada_at FROM conversions WHERE id = $1', [v.venta]);
    expect(venta.suscripcion_estado).toBe('cancelada_en_stripe');
    expect(venta.suscripcion_cerrada_at).not.toBeNull();
    expect((await cuotaDe(v.cuotas[0].id)).cobro_auto_cancelado_el).toBeNull(); // la cobrada, no
    for (const c of [v.cuotas[1], v.cuotas[2]]) {
      const x = await cuotaDe(c.id);
      expect(x.fecha_cobro).toBeNull();
      expect(x.cobro_auto_cancelado_motivo).toMatch(/no pudo cobrar/);
    }
    const a = await avisos(v.venta);
    expect(a).toHaveLength(1);
    expect(a[0].message).toMatch(/Las 2 cuotas siguen pendientes/);
    await servicio.handleWebhookEvent(A, subBorrada(obj, `evt_${MARCA}_pl1`));
    expect(await avisos(v.venta)).toHaveLength(1);
  });

  it('pagada entera: se apunta cerrada, sin marcas ni aviso', async () => {
    const sub = `sub_${MARCA}_pl2`;
    const v = await ventaConPlan({ cobrado: 900, sub });
    await q('UPDATE conversion_installments SET fecha_cobro = CURRENT_DATE WHERE conversion_id = $1', [v.venta]);
    await servicio.handleWebhookEvent(A, subBorrada({ id: sub, status: 'canceled' }));
    expect((await one('SELECT suscripcion_estado FROM conversions WHERE id = $1', [v.venta])).suscripcion_estado).toBe('ya_cerrada');
    expect(await avisos(v.venta)).toHaveLength(0);
  });

  it('la está cerrando el CRM (#747): nada', async () => {
    const sub = `sub_${MARCA}_pl3`;
    const v = await ventaConPlan({ cobrado: 300, sub });
    await q('UPDATE conversions SET suscripcion_estado = \'cerrando\' WHERE id = $1', [v.venta]);
    const r = await servicio.handleWebhookEvent(A, subBorrada({ id: sub, status: 'canceled' }));
    expect(r.skipped).toBeTruthy();
    expect(await avisos(v.venta)).toHaveLength(0);
  });

  it('impagada: marcada sin cerrarla; si vuelve a activa, fuera las marcas', async () => {
    const sub = `sub_${MARCA}_pl4`;
    const v = await ventaConPlan({ sub });
    const upd = (status, antes) => servicio.handleWebhookEvent(A, {
      id: `evt_${MARCA}_${++n}`, type: 'customer.subscription.updated', data: { object: { id: sub, status }, previous_attributes: { status: antes } },
    });
    await upd('unpaid', 'past_due');
    let venta = await one('SELECT suscripcion_estado, suscripcion_cerrada_at FROM conversions WHERE id = $1', [v.venta]);
    expect(venta).toMatchObject({ suscripcion_estado: 'cancelada_en_stripe', suscripcion_cerrada_at: null });
    expect((await cuotaDe(v.cuotas[0].id)).cobro_auto_cancelado_el).not.toBeNull();
    await upd('active', 'unpaid');
    venta = await one('SELECT suscripcion_estado FROM conversions WHERE id = $1', [v.venta]);
    expect(venta.suscripcion_estado).toBe('activa');
    expect((await cuotaDe(v.cuotas[0].id)).cobro_auto_cancelado_el).toBeNull();
    // Si vuelve a quedarse impagada, se apunta otra vez.
    await upd('unpaid', 'active');
    expect((await cuotaDe(v.cuotas[0].id)).cobro_auto_cancelado_el).not.toBeNull();
  });

  it('alumno de baja: se marca, pero no se avisa (no es un impago)', async () => {
    const sub = `sub_${MARCA}_pl5`;
    const v = await ventaConPlan({ sub });
    await q('UPDATE conversions SET baja_fecha = CURRENT_DATE, baja_motivo = \'voluntaria\' WHERE id = $1', [v.venta]);
    await servicio.handleWebhookEvent(A, subBorrada({ id: sub, status: 'canceled' }));
    expect((await cuotaDe(v.cuotas[0].id)).cobro_auto_cancelado_el).not.toBeNull();
    expect(await avisos(v.venta)).toHaveLength(0);
  });

  it('una suscripción que no es de ninguna venta: nada', async () => {
    const r = await servicio.handleWebhookEvent(A, subBorrada({ id: `sub_${MARCA}_ajena`, status: 'canceled' }));
    expect(r.skipped).toMatch(/ninguna venta/);
  });
});

describe('el repaso de lo que Stripe canceló antes (al desplegar)', { timeout: 60_000 }, () => {
  it('sin aplicar solo lo dice; aplicando, marca (y una segunda vez no repite)', async () => {
    const sub = `sub_${MARCA}_rep`;
    const v = await ventaConPlan({ sub });
    const llamar = async (_k, ruta) => (ruta === `/v1/subscriptions/${sub}` ? { id: sub, status: 'canceled' } : { status: 'active' });
    const clave = async () => 'rk_test_x';
    const seco = await cancelado.repasar({ llamar, clave });
    expect(seco.find((f) => f.conversionId === v.venta)).toMatchObject({ estadoStripe: 'canceled', resultado: 'se marcaría' });
    expect((await cuotaDe(v.cuotas[0].id)).cobro_auto_cancelado_el).toBeNull();
    const hecho = await cancelado.repasar({ aplicar: true, llamar, clave });
    expect(hecho.find((f) => f.conversionId === v.venta).resultado).toMatch(/marcada \(3 cuotas\)/);
    expect((await cuotaDe(v.cuotas[0].id)).cobro_auto_cancelado_el).not.toBeNull();
    expect(await avisos(v.venta)).toHaveLength(1);
    const otra = await cancelado.repasar({ aplicar: true, llamar, clave });
    expect(otra.find((f) => f.conversionId === v.venta)).toBeUndefined(); // ya no está abierta
    expect(await avisos(v.venta)).toHaveLength(1);
  });
});
