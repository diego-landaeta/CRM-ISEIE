import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * «Crear link de pago» sencillo (Carlos y Diego, 20/11/2026): producto, pago
 * único o cuotas, y ya. Sin prospecto ni venta. Contra la base local de verdad y
 * con un Stripe de mentira que apunta cada llamada.
 *
 *   · crear un link sin persona: solo el campus (uno de los suyos) y el curso;
 *     Checkout pide el teléfono; un campus ajeno es un 404;
 *   · «cuotas» dice ANTES de crear el link si no se puede (campus sin cobro
 *     automático, clave sin permisos) y no crea nada;
 *   · pago único sin persona: al pagarse se crea el prospecto (para quien creó
 *     el link, con origen «link de pago») y la venta; Stripe avisa dos veces y
 *     hay una sola venta;
 *   · el correo ya es de un prospecto del campus: la venta va en él, sin otro;
 *   · cuotas sin persona: el link cobra la cuota 1 y guarda la tarjeta; al
 *     pagarlo, venta por el total con N cuotas mensuales, cuota 1 saldada,
 *     calendario en Stripe con las demás, y el `invoice.paid` de la 2 salda la 2.
 *
 *   npx vitest run tests/linkSencilloCuotas.test.js
 */

process.env.LOG_LEVEL = 'silent';
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const integrationsModel = await import('../src/modules/integrations/integrations.model.js');
const { default: linksPago } = await import('../src/modules/links-pago/index.js');
const servicio = await import('../src/modules/stripe-payments/stripe-payments.service.js');
const { repartirEnCuotas, fechasMensuales, planDeCuotas } = await import('../src/modules/links-pago/links-pago.service.js');

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
  return { ok: status < 400, status, json: async () => datos, text: async () => JSON.stringify(datos) };
});
const de = (metodo, ruta) => llamadas.filter((l) => l.metodo === metodo && (typeof ruta === 'string' ? l.ruta === ruta : ruta.test(l.ruta)));
let n = 0;
const BASICAS = () => [
  ['GET', '/v1/subscription_schedules', 200, { data: [] }],
  ['GET', '/v1/invoices', 200, { data: [] }],
  ['POST', '/v1/prices', 200, () => ({ id: `price_ls_${MARCA}_${++n}` })],
  ['POST', '/v1/payment_links', 200, () => ({ id: `plink_ls_${MARCA}_${++n}`, url: `https://buy.stripe.com/test_ls_${n}` })],
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

const MARCA = `LS${Date.now().toString(36)}`;
const m = MARCA.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const CLAVE_RK = 'rk_' + 'test_EscrituraDeMentiraLinkSencillo';
const CLAVE_LECTURA = 'rk_' + 'test_LecturaDeMentiraLinkSencillo';
let A; let B; let C;
const p = {};
const prod = {};

async function ponerClave(projectId, provider, clave) {
  const e = encrypt(clave);
  await integrationsModel.upsert({ projectId, provider, active: true, encrypted_value: e.encrypted, iv: e.iv, auth_tag: e.authTag, config_public: {} });
}
const crear = (u, cuerpo) => api.post('/api/links-pago').set(como(u)).send(cuerpo);
const linkDe = (id) => one('SELECT * FROM payment_links WHERE id = $1', [id]);

/** El alumno paga el link en Checkout (lo que manda Stripe: el cargo, con la marca del link). */
async function pagar(link, { email, nombre = `${MARCA} Alumna Nueva`, telefono = '+34611222333', importe, cus = null, pm = null, id = `ch_${MARCA}_${++n}` }) {
  const cargo = {
    id, amount: Math.round(Number(importe) * 100), currency: 'eur', status: 'succeeded', created: Math.floor(Date.now() / 1000),
    customer: cus, payment_method: pm, payment_intent: `pi_${id}`,
    billing_details: { email, name: nombre, phone: telefono },
    // Sin `crm_lead_id` ni `crm_conversion_id`: el link no era de nadie.
    metadata: { crm_link_id: String(link.id), crm_project_id: String(link.project_id), crm_user_id: String(link.created_by), crm_entorno: 'local' },
    payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } },
  };
  await servicio.handleWebhookEvent(link.project_id, { id: `evt_${cargo.id}`, type: 'charge.succeeded', data: { object: cargo } });
  return cargo;
}

beforeAll(async () => {
  const campus = async (x) => {
    const r = await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${x}`, `${m}-${x}`, `${MARCA}-k-${x}`]);
    ids.projects.push(r.id);
    return r.id;
  };
  A = await campus('a'); // permite el cobro automático
  B = await campus('b'); // no lo permite
  C = await campus('c'); // de nadie de la prueba
  const persona = async (x, role, suyos) => {
    const u = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', $3) RETURNING id, role',
      [`${MARCA} ${x}`, `${x}@${m}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  p.gestora = await persona('gestora', 'gestor', [A, B]);
  p.otra = await persona('otra', 'gestor', [A]);
  for (const c of [A, B, C]) {
    prod[c] = (await one('INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, 900, \'EUR\') RETURNING id', [c, `${MARCA} máster`])).id;
    await ponerClave(c, 'stripe_links', CLAVE_RK);
    await ponerClave(c, 'stripe', CLAVE_LECTURA);
  }
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

describe('las cuotas de un link', () => {
  it('total entre N, con los céntimos en la última', () => {
    expect(repartirEnCuotas(1000, 3)).toEqual([333.33, 333.33, 333.34]);
    expect(repartirEnCuotas(900, 3)).toEqual([300, 300, 300]);
    expect(repartirEnCuotas(100.01, 2)).toEqual([50, 50.01]);
  });
  it('mensuales desde el día del pago; un 31 cae en el último día de los meses cortos', () => {
    expect(fechasMensuales('2026-11-20', 3)).toEqual(['2026-11-20', '2026-12-20', '2027-01-20']);
    expect(fechasMensuales('2027-01-31', 3)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(planDeCuotas({ total: 1000, n: 3, desde: '2026-11-20' })[2]).toEqual({ numero: 3, importe: 333.34, vence: '2027-01-20' });
  });
});

// ─── Crear ──────────────────────────────────────────────────────────────────

describe('crear un link sin prospecto', { timeout: 60_000 }, () => {
  it('solo el campus y el curso: se crea, sin prospecto ni venta, y Checkout pide el teléfono', async () => {
    const r = await crear(p.gestora, { projectId: A, productId: prod[A], importe: 900 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ lead_id: null, conversion_id: null, modalidad: 'unico', estado: 'creado' });
    const cuerpo = de('POST', '/v1/payment_links')[0].cuerpo;
    expect(cuerpo['phone_number_collection[enabled]']).toBe('true');
    expect(cuerpo['metadata[crm_lead_id]']).toBeUndefined();
    expect(cuerpo['payment_intent_data[setup_future_usage]']).toBeUndefined();
  });

  it('un campus que no es suyo: 404, y nada en Stripe', async () => {
    const r = await crear(p.gestora, { projectId: C, productId: prod[C], importe: 900 });
    expect(r.status).toBe(404);
    expect(llamadas).toHaveLength(0);
  });

  it('el descuento sigue con su tope: sin descuento permitido, no baja del catálogo', async () => {
    const r = await crear(p.gestora, { projectId: A, productId: prod[A], importe: 800 });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('DESCUENTO_MAXIMO');
  });
});

describe('«cuotas» dice antes si no se puede', { timeout: 60_000 }, () => {
  it('campus sin cobro automático: lo dice al elegir campus y, al crear, 409 sin tocar Stripe', async () => {
    const ver = await api.get('/api/links-pago/cuotas-disponibles').query({ projectId: B }).set(como(p.gestora));
    expect(ver.status).toBe(200);
    expect(ver.body.data).toMatchObject({ disponible: false });
    expect(ver.body.data.motivo).toMatch(/no tiene permitido el cobro automático/);
    const r = await crear(p.gestora, { projectId: B, productId: prod[B], importe: 900, modalidad: 'cuotas', num_cuotas: 3 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CUOTAS_NO_DISPONIBLES');
    expect(de('POST', '/v1/payment_links')).toHaveLength(0);
  });

  it('clave sin permisos de schedules: lo dice, con los permisos que faltan', async () => {
    respuestas = [['GET', '/v1/subscription_schedules', 403, { error: { message: 'The provided key does not have the required permissions' } }]];
    const ver = await api.get('/api/links-pago/cuotas-disponibles').query({ projectId: A }).set(como(p.gestora));
    expect(ver.body.data.disponible).toBe(false);
    expect(ver.body.data.motivo).toMatch(/Subscription Schedules/);
  });

  it('campus que lo permite: disponible, con su máximo de cuotas', async () => {
    const ver = await api.get('/api/links-pago/cuotas-disponibles').query({ projectId: A }).set(como(p.gestora));
    expect(ver.body.data).toMatchObject({ disponible: true, motivo: null, cuotas_max: 12 });
  });

  it('más cuotas que el máximo del campus: 400', async () => {
    const r = await crear(p.gestora, { projectId: A, productId: prod[A], importe: 900, modalidad: 'cuotas', num_cuotas: 13 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('CUOTAS_MAXIMAS');
  });
});

// ─── El cobro ───────────────────────────────────────────────────────────────

describe('al pagarse un link sin prospecto', { timeout: 60_000 }, () => {
  it('pago único: crea el prospecto (de quien creó el link, origen «link de pago») y la venta; dos avisos, una venta', async () => {
    const { body: { data: link } } = await crear(p.gestora, { projectId: A, productId: prod[A], importe: 900 });
    const email = `nueva${Math.random().toString(36).slice(2, 8)}@${m}.test`;
    const cargo = await pagar(link, { email, importe: 900 });

    const leads = await q('SELECT id, nombre, telefono, responsable_id, producto_interes_id, status FROM leads WHERE project_id = $1 AND LOWER(email) = $2', [A, email]);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ nombre: `${MARCA} Alumna Nueva`, responsable_id: p.gestora.id, producto_interes_id: prod[A], status: 'convertido' });
    expect(leads[0].telefono).toMatch(/611222333/);
    expect((await one('SELECT utm_source, utm_campaign FROM lead_utms WHERE lead_id = $1', [leads[0].id])))
      .toMatchObject({ utm_source: 'link_de_pago', utm_campaign: `link-${link.id}` });

    const ventas = await q('SELECT id, importe_total, vendedora_id, producto_contratado_id FROM conversions WHERE lead_id = $1', [leads[0].id]);
    expect(ventas).toHaveLength(1);
    expect(ventas[0]).toMatchObject({ vendedora_id: p.gestora.id, producto_contratado_id: prod[A] });
    expect(Number(ventas[0].importe_total)).toBe(900);
    const pagos = await q('SELECT importe::float8 AS importe FROM conversion_payments WHERE conversion_id = $1', [ventas[0].id]);
    expect(pagos).toEqual([{ importe: 900 }]);

    // La pantalla «Links de pago» lo enseña ya con su prospecto y su venta.
    const l = await linkDe(link.id);
    expect(l).toMatchObject({ estado: 'pagado', lead_id: leads[0].id, conversion_id: ventas[0].id });
    // El aviso, a quien creó el link.
    const aviso = await one(`SELECT target_user_ids, title FROM admin_notifications WHERE metadata->>'stripe_id' = $1`, [cargo.id]);
    expect(aviso.target_user_ids).toEqual([p.gestora.id]);
    expect(aviso.title).toMatch(/Link de pago cobrado/);

    // Stripe avisa otra vez (o el sondeo lo trae): nada se repite.
    await servicio.handleWebhookEvent(A, { id: `evt_${cargo.id}_2`, type: 'charge.succeeded', data: { object: cargo } });
    expect(await q('SELECT id FROM leads WHERE project_id = $1 AND LOWER(email) = $2', [A, email])).toHaveLength(1);
    expect(await q('SELECT id FROM conversions WHERE lead_id = $1', [leads[0].id])).toHaveLength(1);
    expect(await q('SELECT id FROM conversion_payments WHERE conversion_id = $1', [ventas[0].id])).toHaveLength(1);
  });

  it('el correo ya es de un prospecto del campus: la venta va en él, sin crear otro', async () => {
    const email = `ya${Math.random().toString(36).slice(2, 8)}@${m}.test`;
    const lead = (await one('INSERT INTO leads (project_id, nombre, email, responsable_id, status) VALUES ($1, $2, $3, $4, \'nuevo\') RETURNING id',
      [A, `${MARCA} Ya Estaba`, email, p.otra.id])).id;
    const { body: { data: link } } = await crear(p.gestora, { projectId: A, productId: prod[A], importe: 900 });
    await pagar(link, { email: email.toUpperCase(), importe: 900 });

    expect(await q('SELECT id FROM leads WHERE project_id = $1 AND LOWER(email) = $2', [A, email])).toHaveLength(1);
    const ventas = await q('SELECT id, vendedora_id FROM conversions WHERE lead_id = $1', [lead]);
    expect(ventas).toHaveLength(1);
    // La venta es de quien creó el link; la ficha sigue con su responsable.
    expect(ventas[0].vendedora_id).toBe(p.gestora.id);
    expect((await one('SELECT responsable_id FROM leads WHERE id = $1', [lead])).responsable_id).toBe(p.otra.id);
    expect((await linkDe(link.id))).toMatchObject({ lead_id: lead, conversion_id: ventas[0].id, estado: 'pagado' });
  });

  it('cuotas: la 1 con el link (guarda la tarjeta), la venta con su plan, el calendario en Stripe y la 2 salda la 2', async () => {
    const r = await crear(p.gestora, { projectId: A, productId: prod[A], importe: 900, modalidad: 'cuotas', num_cuotas: 3 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const link = r.body.data;
    expect(link).toMatchObject({ modalidad: 'cuotas', num_cuotas: 3, guarda_tarjeta: true, lead_id: null });
    expect(Number(link.importe)).toBe(900);
    expect(Number(link.importe_cuota)).toBe(300);
    // Stripe cobra la cuota 1 y guarda la tarjeta, con el consentimiento de las otras dos.
    expect(de('POST', '/v1/prices')[0].cuerpo.unit_amount).toBe('30000');
    const pl = de('POST', '/v1/payment_links')[0].cuerpo;
    expect(pl['payment_intent_data[setup_future_usage]']).toBe('off_session');
    expect(pl['custom_text[submit][message]']).toMatch(/2 cuotas, 600,00 €/);
    expect(pl['phone_number_collection[enabled]']).toBe('true');

    const email = `cuotas${Math.random().toString(36).slice(2, 8)}@${m}.test`;
    const cus = `cus_${MARCA}_cuotas`;
    llamadas = [];
    const cargo = await pagar(link, { email, importe: 300, cus, pm: `pm_${MARCA}_cuotas` });
    const fecha = new Date(cargo.created * 1000).toISOString().slice(0, 10);
    const fechas = fechasMensuales(fecha, 3);

    const lead = await one('SELECT id FROM leads WHERE project_id = $1 AND LOWER(email) = $2', [A, email]);
    const venta = await one('SELECT id, importe_total, metodo_pago, vendedora_id FROM conversions WHERE lead_id = $1', [lead.id]);
    expect(Number(venta.importe_total)).toBe(900);
    expect(venta.vendedora_id).toBe(p.gestora.id);
    const cuotas = await q(
      `SELECT id, numero, importe_previsto::float8 AS importe, fecha_vencimiento::text AS vence, fecha_cobro IS NOT NULL AS cobrada
         FROM conversion_installments WHERE conversion_id = $1 ORDER BY numero`, [venta.id]);
    expect(cuotas.map((c) => [c.numero, c.importe, c.vence, c.cobrada])).toEqual([
      [1, 300, fechas[0], true], [2, 300, fechas[1], false], [3, 300, fechas[2], false]]);

    // Cobro automático activo, con la tarjeta, y las cuotas 2 y 3 programadas en Stripe.
    const ca = await one('SELECT * FROM conversion_cobro_auto WHERE conversion_id = $1', [venta.id]);
    expect(ca).toMatchObject({ activo: true, tarjeta_ultimos4: '4242', stripe_customer_id: cus });
    expect(ca.stripe_schedule_id).toMatch(new RegExp(`^sub_sched_${MARCA}_`));
    const cal = de('POST', '/v1/subscription_schedules')[0].cuerpo;
    expect(cal.customer).toBe(cus);
    expect(cal['phases[0][metadata][crm_installment_id]']).toBe(String(cuotas[1].id));
    expect(cal['phases[1][metadata][crm_installment_id]']).toBe(String(cuotas[2].id));
    const enStripe = await q('SELECT installment_id, estado, stripe_price_id FROM cobro_auto_cuotas WHERE conversion_id = $1 ORDER BY installment_id', [venta.id]);
    expect(enStripe.map((c) => [c.installment_id, c.estado])).toEqual([[cuotas[1].id, 'programada'], [cuotas[2].id, 'programada']]);
    expect((await linkDe(link.id))).toMatchObject({ estado: 'pagado', lead_id: lead.id, conversion_id: venta.id });

    // Stripe cobra sola la cuota 2: su factura salda la 2.
    const precio2 = enStripe[0].stripe_price_id;
    const inv = {
      id: `in_${MARCA}_c2`, object: 'invoice', customer: cus, amount_paid: 30000, attempt_count: 1, auto_advance: true,
      payment_intent: `pi_in_${MARCA}_c2`, lines: { data: [{ price: { id: precio2 }, amount: 30000 }] },
    };
    respuestas.push(['GET', '/v1/charges', 200, { data: [{
      id: `ch_${MARCA}_c2`, amount: 30000, currency: 'eur', status: 'succeeded', created: Math.floor(Date.now() / 1000),
      customer: cus, payment_method: `pm_${MARCA}_cuotas`, payment_intent: inv.payment_intent, invoice: inv.id,
      billing_details: { email: null, name: null }, metadata: {}, payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } },
    }] }]);
    respuestas.push(['GET', `/v1/invoices/${inv.id}`, 200, inv]);
    await servicio.handleWebhookEvent(A, { id: `evt_${MARCA}_paid2`, type: 'invoice.paid', data: { object: inv } });
    const ahora = await q('SELECT numero, fecha_cobro IS NOT NULL AS cobrada FROM conversion_installments WHERE conversion_id = $1 ORDER BY numero', [venta.id]);
    expect(ahora).toEqual([{ numero: 1, cobrada: true }, { numero: 2, cobrada: true }, { numero: 3, cobrada: false }]);
    const pagos = await q('SELECT importe::float8 AS importe FROM conversion_payments WHERE conversion_id = $1 ORDER BY id', [venta.id]);
    expect(pagos).toEqual([{ importe: 300 }, { importe: 300 }]);

    // Y el aviso repetido del pago de la cuota 1 no crea otra venta.
    await servicio.handleWebhookEvent(A, { id: `evt_${cargo.id}_otra`, type: 'charge.succeeded', data: { object: cargo } });
    expect(await q('SELECT id FROM conversions WHERE lead_id = $1', [lead.id])).toHaveLength(1);
  });
});
