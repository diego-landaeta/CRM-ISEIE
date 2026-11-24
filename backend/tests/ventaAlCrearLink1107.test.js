import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM#1107 / CRM-ISEIE#762 (Diego, 24/11/2026). Contra la base de verdad y con un
 * Stripe de mentira que apunta cada llamada.
 *
 *   1. La venta se crea AL CREAR el link desde un prospecto:
 *      · pago único: por el importe del link, pendiente, a nombre de quien lo
 *        crea, y el prospecto pasa a «Convertido»; al pagarse, el cobro va a ella
 *        (aunque el alumno pague con otro correo) y nada se repite;
 *      · en cuotas con cobro automático: con su plan y el cobro automático
 *        marcado; el pago del link salda la inicial (cuota 1);
 *      · la ficha ya tenía la venta de ese curso con lo pendiente: el link va a esa;
 *      · venta repetida (CRM#898): 409 sin tocar Stripe; con `forzar`, otra.
 *   2. Caducado o anulado sin pagar: la venta se queda como está y se avisa a
 *      quien creó el link (campana y un recordatorio de hoy, «Tu día»). Una vez.
 *   3. «Link de pago usado» en la venta: el cargo de Stripe se une al pago inicial
 *      sin crear otro cobro; si está en otra venta, no se mueve; si el importe no
 *      cuadra o no se encuentra, se dice.
 *
 *   npx vitest run tests/ventaAlCrearLink1107.test.js
 */

process.env.LOG_LEVEL = 'silent';
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const integrationsModel = await import('../src/modules/integrations/integrations.model.js');
const { default: linksPago } = await import('../src/modules/links-pago/index.js');
const servicio = await import('../src/modules/stripe-payments/stripe-payments.service.js');
const linksService = await import('../src/modules/links-pago/links-pago.service.js');
const { leerReferencia, unirCargoDeLaReferencia } = await import('../src/modules/links-pago/links-pago.referencia.js');
const { textosDelAviso } = await import('../src/modules/links-pago/links-pago.venta.js');
const { TIPOS } = await import('../src/modules/notifications/tipos.js');

// ─── Stripe de mentira ──────────────────────────────────────────────────────
let llamadas = [];
let respuestas = [];
const fetchOriginal = globalThis.fetch;
const cuerpoDe = (b) => Object.fromEntries(new URLSearchParams(String(b || '')));
globalThis.fetch = vi.fn(async (url, opciones = {}) => {
  const metodo = (opciones.method || 'GET').toUpperCase();
  const u = new URL(String(url));
  const llamada = { metodo, ruta: u.pathname, query: Object.fromEntries(u.searchParams), cuerpo: cuerpoDe(opciones.body) };
  llamadas.push(llamada);
  const r = respuestas.find(([m, ruta]) => m === metodo && (typeof ruta === 'string' ? u.pathname === ruta : ruta.test(u.pathname)));
  if (!r) throw new Error(`Stripe de mentira: sin respuesta para ${metodo} ${u.pathname}`);
  const [, , status, body] = r;
  const datos = typeof body === 'function' ? body(llamada) : body ?? {};
  const st = typeof datos?.__status === 'number' ? datos.__status : status;
  return { ok: st < 400, status: st, json: async () => datos, text: async () => JSON.stringify(datos) };
});
const de = (metodo, ruta) => llamadas.filter((l) => l.metodo === metodo && (typeof ruta === 'string' ? l.ruta === ruta : ruta.test(l.ruta)));
let n = 0;
const MARCA = `VL${Date.now().toString(36)}`;
const m = MARCA.toLowerCase();
const BASICAS = () => [
  ['GET', '/v1/subscription_schedules', 200, { data: [] }],
  ['GET', '/v1/invoices', 200, { data: [] }],
  ['POST', '/v1/prices', 200, () => ({ id: `price_vl_${MARCA}_${++n}` })],
  ['POST', '/v1/payment_links', 200, () => ({ id: `plink_vl_${MARCA}_${++n}`, url: `https://buy.stripe.com/test_vl_${MARCA}_${n}` })],
  ['POST', /^\/v1\/payment_links\/[^/]+$/, 200, { id: 'plink', active: false }],
  ['POST', '/v1/subscription_schedules', 200, () => ({ id: `sub_sched_${MARCA}_${++n}`, status: 'not_started' })],
  ['GET', /^\/v1\/subscription_schedules\/[^/]+$/, 200, (l) => ({ id: l.ruta.split('/').pop(), status: 'not_started', phases: [] })],
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
const CLAVE_RK = 'rk_' + 'test_EscrituraDeMentiraVentaAlCrear';
const CLAVE_LECTURA = 'rk_' + 'test_LecturaDeMentiraVentaAlCrear';
let A;
const p = {};
let prod;

async function ponerClave(projectId, provider, clave) {
  const e = encrypt(clave);
  await integrationsModel.upsert({ projectId, provider, active: true, encrypted_value: e.encrypted, iv: e.iv, auth_tag: e.authTag, config_public: {} });
}
const crear = (u, cuerpo) => api.post('/api/links-pago').set(como(u)).send(cuerpo);
const linkDe = (id) => one('SELECT * FROM payment_links WHERE id = $1', [id]);
async function nuevoLead({ email = null } = {}) {
  return (await one(`INSERT INTO leads (project_id, nombre, email, responsable_id, status, producto_interes_id)
                     VALUES ($1, $2, $3, $4, 'nuevo', $5) RETURNING id`,
  [A, `${MARCA} Alumna ${++n}`, email, p.gestora.id, prod])).id;
}
async function nuevaVenta(leadId, { total = 900, pagado = 0 } = {}) {
  const v = (await one(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado, fecha_conversion)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE) RETURNING id`,
    [leadId, A, `${MARCA} máster`, prod, total, pagado])).id;
  let cp = null;
  if (pagado > 0) cp = (await one("INSERT INTO conversion_payments (conversion_id, importe, fecha, notas) VALUES ($1, $2, CURRENT_DATE, 'Pago inicial') RETURNING id", [v, pagado])).id;
  return { id: v, cp };
}
const cargoDe = ({ id = `ch_${MARCA}_${++n}`, importe, email = 'otro.correo@example.com', link = null, cus = null, pm = null }) => ({
  id, amount: Math.round(Number(importe) * 100), currency: 'eur', status: 'succeeded', created: Math.floor(Date.now() / 1000),
  customer: cus, payment_method: pm, payment_intent: `pi_${id}`,
  billing_details: { email, name: 'Quien Paga', phone: null },
  metadata: link ? {
    crm_link_id: String(link.id), crm_project_id: String(link.project_id), crm_lead_id: String(link.lead_id || ''),
    crm_user_id: String(link.created_by), crm_entorno: 'local',
  } : {},
  payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } },
});
async function pagar(link, opciones) {
  const cargo = cargoDe({ ...opciones, link });
  await servicio.handleWebhookEvent(link.project_id, { id: `evt_${cargo.id}`, type: 'charge.succeeded', data: { object: cargo } });
  return cargo;
}

beforeAll(async () => {
  const r = await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} campus`, `${m}-a`, `${MARCA}-k-a`]);
  A = r.id;
  ids.projects.push(A);
  const persona = async (x, role) => {
    const u = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', $3) RETURNING id, role',
      [`${MARCA} ${x}`, `${x}@${m}.test`, role]);
    ids.users.push(u.id);
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, A]);
    return u;
  };
  p.gestora = await persona('gestora', 'gestor');
  p.otra = await persona('otra', 'gestor');
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

// ─── 1. La venta, al crear el link ──────────────────────────────────────────

describe('la venta nace con el link desde un prospecto', { timeout: 60_000 }, () => {
  it('pago único: venta pendiente por el importe, a su nombre, prospecto «Convertido»; el cobro va a ella', async () => {
    const lead = await nuevoLead({ email: `ficha${n}@${m}.test` });
    const r = await crear(p.gestora, { leadId: lead, productId: prod, importe: 900 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const link = r.body.data;
    expect(link.venta_del_link).toMatchObject({ creada: true });
    const ventaId = link.venta_del_link.conversion_id;
    expect(link.conversion_id).toBe(ventaId);

    const v = await one(`SELECT lead_id, importe_total::float8 AS total, importe_pagado::float8 AS pagado, vendedora_id,
                                producto_contratado_id, notas_pago, fecha_compromiso_pago::text AS compromiso
                           FROM conversions WHERE id = $1`, [ventaId]);
    expect(v).toMatchObject({ lead_id: lead, total: 900, pagado: 0, vendedora_id: p.gestora.id, producto_contratado_id: prod });
    expect(v.notas_pago).toMatch(new RegExp(`al crear el link de pago n\\.º ${link.id}\\.`));
    // Se espera hasta que caduca el link, no desde hoy.
    expect(v.compromiso).toBe(new Date(link.caduca_el).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }));
    expect((await one('SELECT status FROM leads WHERE id = $1', [lead])).status).toBe('convertido');
    const ev = await one("SELECT datos FROM payment_link_eventos WHERE link_id = $1 AND tipo = 'venta_del_link'", [link.id]);
    expect(ev.datos).toMatchObject({ conversion_id: ventaId, creada: true });

    // Paga con OTRO correo: el cobro va a esa venta y no se crea otra.
    const cargo = await pagar(link, { importe: 900, email: 'paga.con.otro@example.com' });
    expect(await q('SELECT id FROM conversions WHERE lead_id = $1', [lead])).toHaveLength(1);
    expect(await q('SELECT importe::float8 AS importe FROM conversion_payments WHERE conversion_id = $1', [ventaId])).toEqual([{ importe: 900 }]);
    expect(await linkDe(link.id)).toMatchObject({ estado: 'pagado', conversion_id: ventaId });
    // Stripe avisa otra vez: nada se repite.
    await servicio.handleWebhookEvent(A, { id: `evt_${cargo.id}_2`, type: 'charge.succeeded', data: { object: cargo } });
    expect(await q('SELECT id FROM conversions WHERE lead_id = $1', [lead])).toHaveLength(1);
    expect(await q('SELECT id FROM conversion_payments WHERE conversion_id = $1', [ventaId])).toHaveLength(1);
  });

  it('en cuotas con cobro automático: la venta con su plan y el cobro automático; el link salda la inicial', async () => {
    const lead = await nuevoLead();
    const [hoy, f1, f2] = linksService.fechasMensuales(linksService.hoyEnMadrid(), 3);
    const r = await crear(p.gestora, {
      leadId: lead, productId: prod, importe: 900, modalidad: 'cuotas', num_cuotas: 2, inicial: 300,
      cuotas: [{ importe: 300, vence: f1 }, { importe: 300, vence: f2 }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const link = r.body.data;
    expect(link).toMatchObject({ modalidad: 'cuotas', guarda_tarjeta: true });
    const ventaId = link.venta_del_link.conversion_id;
    const v = await one('SELECT importe_total::float8 AS total, metodo_pago FROM conversions WHERE id = $1', [ventaId]);
    expect(v).toMatchObject({ total: 900, metodo_pago: 'fraccionado' });
    const cuotas = await q(`SELECT numero, importe_previsto::float8 AS importe, fecha_vencimiento::text AS vence, fecha_cobro IS NOT NULL AS cobrada
                              FROM conversion_installments WHERE conversion_id = $1 ORDER BY numero`, [ventaId]);
    expect(cuotas).toEqual([
      { numero: 1, importe: 300, vence: hoy, cobrada: false },
      { numero: 2, importe: 300, vence: f1, cobrada: false },
      { numero: 3, importe: 300, vence: f2, cobrada: false },
    ]);
    expect((await one('SELECT activo FROM conversion_cobro_auto WHERE conversion_id = $1', [ventaId])).activo).toBe(true);

    await pagar(link, { importe: 300, cus: `cus_${MARCA}_c`, pm: `pm_${MARCA}_c` });
    const despues = await q('SELECT numero, fecha_cobro IS NOT NULL AS cobrada FROM conversion_installments WHERE conversion_id = $1 ORDER BY numero', [ventaId]);
    expect(despues.map((c) => c.cobrada)).toEqual([true, false, false]);
    expect(await q('SELECT importe::float8 AS importe FROM conversion_payments WHERE conversion_id = $1', [ventaId])).toEqual([{ importe: 300 }]);
    expect(await q('SELECT id FROM conversions WHERE lead_id = $1', [lead])).toHaveLength(1);
  });

  it('la ficha ya tiene la venta de ese curso con lo pendiente: el link va a esa, sin otra venta', async () => {
    const lead = await nuevoLead();
    const venta = await nuevaVenta(lead, { total: 900 });
    const r = await crear(p.gestora, { leadId: lead, productId: prod, importe: 900 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.venta_del_link).toEqual({ conversion_id: venta.id, creada: false });
    expect(r.body.data.conversion_id).toBe(venta.id);
    expect(de('POST', '/v1/payment_links')[0].cuerpo['metadata[crm_conversion_id]']).toBe(String(venta.id));
    expect(await q('SELECT id FROM conversions WHERE lead_id = $1', [lead])).toHaveLength(1);
  });

  it('venta repetida (CRM#898): 409 con la venta, sin tocar Stripe; con «forzar», otra venta que lo dice', async () => {
    const lead = await nuevoLead();
    const vieja = await nuevaVenta(lead, { total: 900, pagado: 900 });
    const r = await crear(p.gestora, { leadId: lead, productId: prod, importe: 900 });
    expect([r.status, r.body.code], JSON.stringify(r.body)).toEqual([409, 'VENTA_YA_EXISTE']);
    expect(r.body.data.venta.id).toBe(vieja.id);
    expect(llamadas).toHaveLength(0);

    const f = await crear(p.gestora, { leadId: lead, productId: prod, importe: 900, forzar: true });
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    const nueva = f.body.data.venta_del_link.conversion_id;
    expect(nueva).not.toBe(vieja.id);
    expect((await one('SELECT repetida_de FROM conversions WHERE id = $1', [nueva])).repetida_de).toBe(vieja.id);
  });
});

// ─── 2. Caducado o anulado sin pagar ────────────────────────────────────────

describe('link sin pagar con su venta: aviso a quien lo creó, la venta no se toca', { timeout: 60_000 }, () => {
  const avisosDe = (linkId) => q(
    "SELECT title, message, target_user_ids, link_path FROM admin_notifications WHERE type = 'link_pago_sin_pagar' AND (metadata->>'payment_link_id')::int = $1",
    [linkId]);

  it('el tipo de aviso existe y pide acción', () => {
    expect(TIPOS.link_pago_sin_pagar).toBeTruthy();
    expect(textosDelAviso({ id: 7, conversion_id: 9, lead_nombre: 'Ana', producto_nombre: 'Máster', pendiente: 900 }, 'caducado').title)
      .toBe('Link de pago caducado sin pagar: Ana');
  });

  it('caduca: campana y recordatorio de hoy para la gestora; la venta sigue pendiente; una sola vez', async () => {
    const lead = await nuevoLead();
    const { body: { data: link } } = await crear(p.gestora, { leadId: lead, productId: prod, importe: 900 });
    const ventaId = link.venta_del_link.conversion_id;
    await q("UPDATE payment_links SET caduca_el = NOW() - interval '1 minute' WHERE id = $1", [link.id]);
    await linksService.caducarVencidos({ lote: 500 });
    expect((await linkDe(link.id)).estado).toBe('caducado');

    const avisos = await avisosDe(link.id);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ target_user_ids: [p.gestora.id], link_path: `/prospectos/${lead}` });
    expect(avisos[0].message).toMatch(new RegExp(`venta n\\.º ${ventaId}`));
    const rec = await one(`SELECT created_by, fecha_recordatorio::text AS dia, notificado_at IS NOT NULL AS avisado, completado, nota
                             FROM lead_reminders WHERE lead_id = $1`, [lead]);
    expect(rec).toMatchObject({ created_by: p.gestora.id, dia: linksService.hoyEnMadrid(), avisado: true, completado: false });
    expect(rec.nota).toMatch(/genera un link nuevo, registra el pago si pagó por otra vía o anula la venta/);
    // La venta, intacta.
    expect(await one('SELECT importe_total::float8 AS total FROM conversions WHERE id = $1', [ventaId])).toEqual({ total: 900 });

    // Otra vuelta (o renovarlo y que el nuevo siga vivo): no se repite.
    await (await import('../src/modules/links-pago/links-pago.venta.js')).avisarSinPagar(link.id, 'caducado');
    expect(await avisosDe(link.id)).toHaveLength(1);
  });

  it('anulado: también avisa; un link que nunca trajo su venta, no', async () => {
    const lead = await nuevoLead();
    const { body: { data: link } } = await crear(p.gestora, { leadId: lead, productId: prod, importe: 900 });
    const r = await api.post(`/api/links-pago/${link.id}/anular`).set(como(p.gestora)).send({ motivo: 'Se lo mando de nuevo' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await avisosDe(link.id)).toHaveLength(1);

    // Sin prospecto (solo el campus): no nace con venta, no hay nada que avisar.
    const { body: { data: suelto } } = await crear(p.gestora, { projectId: A, productId: prod, importe: 900 });
    expect(suelto.conversion_id).toBeNull();
    await api.post(`/api/links-pago/${suelto.id}/anular`).set(como(p.gestora)).send({ motivo: 'no' });
    expect(await avisosDe(suelto.id)).toHaveLength(0);
  });
});

// ─── 3. «Link de pago usado» en la venta ────────────────────────────────────

describe('lo que se pega como link de pago usado', () => {
  it('entiende links, sesiones, pagos y cargos de Stripe; lo demás no', () => {
    expect(leerReferencia('https://buy.stripe.com/test_abc123?prefilled_email=x')).toEqual({ tipo: 'url', valor: 'https://buy.stripe.com/test_abc123', deStripe: true });
    expect(leerReferencia('plink_1Qabcdef')).toEqual({ tipo: 'plink', valor: 'plink_1Qabcdef' });
    expect(leerReferencia('https://checkout.stripe.com/c/pay/cs_live_a1B2c3d4#fid=x')).toEqual({ tipo: 'cs', valor: 'cs_live_a1B2c3d4' });
    expect(leerReferencia(' pi_3Nabcdef ')).toEqual({ tipo: 'pi', valor: 'pi_3Nabcdef' });
    expect(leerReferencia('ch_3Nabcdef')).toEqual({ tipo: 'ch', valor: 'ch_3Nabcdef' });
    expect(leerReferencia('Transferencia 12345')).toBeNull();
    expect(leerReferencia('')).toBeNull();
  });
});

describe('el cobro del link usado, al pago inicial de la venta', { timeout: 60_000 }, () => {
  const cargos = new Map();
  const conCargos = () => [
    ['GET', '/v1/charges', 200, (l) => ({ data: [...cargos.values()].filter((c) => c.payment_intent === l.query.payment_intent) })],
    ['GET', /^\/v1\/charges\/[^/]+$/, 200, (l) => cargos.get(l.ruta.split('/').pop()) || { __status: 404, error: { message: 'No such charge' } }],
    ['GET', '/v1/payment_links', 200, { data: [{ id: `plink_usado_${MARCA}`, url: `https://buy.stripe.com/test_usado_${m}` }], has_more: false }],
    ['GET', '/v1/checkout/sessions', 200, (l) => ({
      data: l.query.payment_link === `plink_usado_${MARCA}` ? [{ id: 'cs_test_x', payment_status: 'paid', payment_intent: `pi_usado_${MARCA}` }] : [],
    })],
  ];
  beforeEach(() => { respuestas = [...BASICAS(), ...conCargos()]; });

  it('con el pi_: se trae el cargo y se une al pago inicial, aunque el correo sea otro; sin otro cobro', async () => {
    const lead = await nuevoLead({ email: `ficha.pi@${m}.test` });
    const v = await nuevaVenta(lead, { total: 900, pagado: 300 });
    const ch = cargoDe({ id: `ch_pi_${MARCA}`, importe: 300, email: 'otra.persona@example.com' });
    ch.payment_intent = `pi_pi_${MARCA}`;
    cargos.set(ch.id, ch);
    const r = await unirCargoDeLaReferencia({
      projectId: A, referencia: `pi_pi_${MARCA}`, importe: 300, conversionId: v.id, conversionPaymentId: v.cp, userId: p.gestora.id,
    });
    expect(r.estado, r.mensaje).toBe('unido');
    expect(r.mensaje).toMatch(/otra\.persona@example\.com/);
    const sp = await one('SELECT conversion_id, conversion_payment_id, link_method FROM stripe_payments WHERE project_id = $1 AND stripe_id = $2', [A, ch.id]);
    expect(sp).toEqual({ conversion_id: v.id, conversion_payment_id: v.cp, link_method: 'manual_cobro' });
    expect(await q('SELECT importe::float8 AS importe FROM conversion_payments WHERE conversion_id = $1', [v.id])).toEqual([{ importe: 300 }]);

    // Otra vez: ya está.
    const otra = await unirCargoDeLaReferencia({ projectId: A, referencia: `pi_pi_${MARCA}`, importe: 300, conversionId: v.id, conversionPaymentId: v.cp });
    expect(otra.estado).toBe('ya_unido');

    // El mismo cobro pegado en OTRA venta: avisa y no lo mueve.
    const v2 = await nuevaVenta(await nuevoLead(), { total: 900, pagado: 300 });
    const r2 = await unirCargoDeLaReferencia({ projectId: A, referencia: ch.id, importe: 300, conversionId: v2.id, conversionPaymentId: v2.cp });
    expect(r2.estado).toBe('en_otra_venta');
    expect(r2.mensaje).toMatch(new RegExp(`venta n\\.º ${v.id}`));
    expect((await one('SELECT conversion_id FROM stripe_payments WHERE project_id = $1 AND stripe_id = $2', [A, ch.id])).conversion_id).toBe(v.id);
  });

  it('con el link de buy.stripe.com: lo encuentra por sus sesiones pagadas (y «Buscar en Stripe» no une nada)', async () => {
    const ch = cargoDe({ id: `ch_usado_${MARCA}`, importe: 250 });
    ch.payment_intent = `pi_usado_${MARCA}`;
    cargos.set(ch.id, ch);
    const ver = await api.get('/api/links-pago/buscar-cobro')
      .query({ projectId: A, referencia: `https://buy.stripe.com/test_usado_${m}`, importe: 250 }).set(como(p.gestora));
    expect(ver.status, JSON.stringify(ver.body)).toBe(200);
    expect(ver.body.data).toMatchObject({ estado: 'encontrado', cargo: { stripe_id: ch.id, importe: 250, conversion_id: null } });
    expect((await one('SELECT conversion_id FROM stripe_payments WHERE project_id = $1 AND stripe_id = $2', [A, ch.id])).conversion_id).toBeNull();

    // El importe no cuadra con la inicial: no se une.
    const v = await nuevaVenta(await nuevoLead(), { total: 900, pagado: 300 });
    const r = await unirCargoDeLaReferencia({ projectId: A, referencia: `https://buy.stripe.com/test_usado_${m}`, importe: 300, conversionId: v.id, conversionPaymentId: v.cp });
    expect(r.estado).toBe('importe_distinto');
    expect((await one('SELECT conversion_id FROM stripe_payments WHERE project_id = $1 AND stripe_id = $2', [A, ch.id])).conversion_id).toBeNull();
  });

  it('no se encuentra, o no es de Stripe: se dice y la referencia queda como estaba', async () => {
    const v = await nuevaVenta(await nuevoLead(), { total: 900, pagado: 300 });
    const r = await unirCargoDeLaReferencia({ projectId: A, referencia: 'ch_noexiste123', importe: 300, conversionId: v.id, conversionPaymentId: v.cp });
    expect(r.estado).toBe('no_encontrado');
    expect(r.mensaje).toMatch(/Se guarda como referencia/);
    expect((await unirCargoDeLaReferencia({ projectId: A, referencia: 'Transferencia 5555' })).estado).toBe('no_es_de_stripe');
  });
});
