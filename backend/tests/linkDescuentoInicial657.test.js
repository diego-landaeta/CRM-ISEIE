import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Links de pago: otro importe, descuento e inicial más cuotas (CRM-ISEIE#657,
 * gemela de CRM#982).
 *
 * Diego, 21/11/2026: «los enlaces de pago poder dar descuentos y poner montos
 * diferentes, y las cuotas, porque un enlace de pago es la inicial y lo otro son
 * las cuotas, no únicamente con el monto del programa. Son dos recorridos».
 *
 *   · lo puro: el total con el descuento en € o en %, el reparto de lo que queda
 *     tras la inicial (la última cuota ajusta el céntimo), las fechas, y lo que
 *     dice Zod (importe y inicial mayores que 0, inicial menor que el total,
 *     descuento que no pasa del precio, total que cuadra, cuotas de 1 en adelante);
 *   · las reglas del campus: de 1 al máximo de cuotas tras la inicial, 0,50 € como
 *     poco, y el tope de descuento contra el catálogo;
 *   · el cobro automático con una inicial distinta: Stripe programa cada cuota
 *     con su importe, así que el plan sale igual;
 *   · contra la base, con un Stripe de mentira: el pago único con descuento cobra
 *     el total y la venta se crea por él, con el precio original y el descuento;
 *     la inicial más cuotas cobra la inicial y, al pagarse, la venta lleva la
 *     inicial como cuota 1, el resto en N cuotas iguales y el calendario de
 *     Stripe con esas N.
 *
 *   npx vitest run tests/linkDescuentoInicial657.test.js
 */

process.env.LOG_LEVEL = 'silent';
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const integrationsModel = await import('../src/modules/integrations/integrations.model.js');
const { default: linksPago } = await import('../src/modules/links-pago/index.js');
const servicio = await import('../src/modules/stripe-payments/stripe-payments.service.js');
const { crearSchema, totalConDescuento } = await import('../src/modules/links-pago/links-pago.validation.js');
const {
  comprobarReglas, planConInicial, planDelLink, fechasMensuales, restaCentimos,
} = await import('../src/modules/links-pago/links-pago.service.js');
const { planificar } = await import('../src/modules/links-pago/links-pago.cobro-auto.js');

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
const MARCA = `LD${Date.now().toString(36)}`;
const m = MARCA.toLowerCase();
const BASICAS = () => [
  ['GET', '/v1/subscription_schedules', 200, { data: [] }],
  ['GET', '/v1/invoices', 200, { data: [] }],
  ['POST', '/v1/prices', 200, () => ({ id: `price_ld_${MARCA}_${++n}` })],
  ['POST', '/v1/payment_links', 200, () => ({ id: `plink_ld_${MARCA}_${++n}`, url: `https://buy.stripe.com/test_ld_${n}` })],
  ['POST', /^\/v1\/payment_links\/[^/]+$/, 200, { id: 'plink', active: false }],
  ['POST', '/v1/subscription_schedules', 200, () => ({ id: `sub_sched_${MARCA}_${++n}`, status: 'not_started' })],
  ['GET', /^\/v1\/subscription_schedules\/[^/]+$/, 200, (l) => ({ id: l.ruta.split('/').pop(), status: 'not_started', phases: [] })],
  ['POST', /^\/v1\/subscription_schedules\/[^/]+\/cancel$/, 200, { status: 'canceled' }],
  ['POST', /^\/v1\/subscription_schedules\/[^/]+$/, 200, (l) => ({ id: l.ruta.split('/').pop(), status: 'not_started' })],
];

// ─── Lo puro ────────────────────────────────────────────────────────────────

const valida = (b) => crearSchema.safeParse({ projectId: 1, productId: 2, ...b });
const mensaje = (b) => { const r = valida(b); return r.success ? null : r.error.errors[0].message; };

describe('el total con descuento', () => {
  it('en % y en €, al céntimo; un descuento que pasa del precio no da total', () => {
    expect(totalConDescuento({ precio: 1000, tipo: 'pct', valor: 10 })).toEqual({ total: 900, descuento: 100 });
    // 999,99 × 12,5 % = 124,99875 → 125,00: se redondea el descuento, no el total.
    expect(totalConDescuento({ precio: 999.99, tipo: 'pct', valor: 12.5 })).toEqual({ total: 874.99, descuento: 125 });
    expect(totalConDescuento({ precio: 900, tipo: 'monto', valor: 100.5 })).toEqual({ total: 799.5, descuento: 100.5 });
    expect(totalConDescuento({ precio: 900, tipo: 'monto', valor: 900.01 })).toBeNull();
    expect(totalConDescuento({ precio: 900, tipo: 'pct', valor: 100.01 })).toBeNull();
  });
});

describe('Zod', () => {
  it('el importe, mayor que 0', () => {
    expect(mensaje({ importe: 0 })).toBe('El importe tiene que ser mayor que 0');
    expect(mensaje({ importe: -5 })).toBe('El importe tiene que ser mayor que 0');
  });
  it('con descuento, el total tiene que cuadrar al céntimo con el precio y el descuento', () => {
    expect(valida({ importe: 900, precio_original: 1000, descuento_tipo: 'pct', descuento_valor: 10 }).success).toBe(true);
    expect(valida({ importe: 949.5, precio_original: 1000, descuento_tipo: 'monto', descuento_valor: '50,5' }).success).toBe(true);
    expect(mensaje({ importe: 901, precio_original: 1000, descuento_tipo: 'pct', descuento_valor: 10 }))
      .toBe('El total no cuadra con el precio y el descuento: vuelve a calcularlo');
    // Sin descuento, el precio original es el total.
    expect(mensaje({ importe: 900, precio_original: 1000 })).toBe('El total no cuadra con el precio y el descuento: vuelve a calcularlo');
  });
  it('el descuento no supera el precio, ni el 100 %, y va con su tipo y su precio', () => {
    expect(mensaje({ importe: 1, precio_original: 1000, descuento_tipo: 'monto', descuento_valor: 1000.01 })).toBe('El descuento no puede superar el precio');
    expect(mensaje({ importe: 1, precio_original: 1000, descuento_tipo: 'pct', descuento_valor: 101 })).toBe('El descuento no puede pasar del 100 %');
    expect(mensaje({ importe: 900, precio_original: 1000, descuento_tipo: 'pct' })).toBe('Di el descuento y si es en € o en %');
    expect(mensaje({ importe: 900, descuento_tipo: 'pct', descuento_valor: 10 })).toBe('Con descuento, falta el precio del que sale');
    expect(mensaje({ importe: 900, precio_original: 1000, descuento_tipo: 'gratis', descuento_valor: 10 })).toMatch(/en € .* o en %/);
    expect(mensaje({ importe: 900, precio_original: 1000, descuento_tipo: 'pct', descuento_valor: -10 })).toBe('El descuento no puede ser negativo');
  });
  it('la inicial: mayor que 0, menor que el total y solo en cuotas; con ella, cuotas de 1 en adelante', () => {
    expect(valida({ importe: 900, modalidad: 'cuotas', num_cuotas: 1, inicial: 300 }).success).toBe(true);
    expect(mensaje({ importe: 900, modalidad: 'cuotas', num_cuotas: 3, inicial: 0 })).toBe('La inicial tiene que ser mayor que 0');
    expect(mensaje({ importe: 900, modalidad: 'cuotas', num_cuotas: 3, inicial: 900 })).toBe('La inicial tiene que ser menor que el total');
    expect(mensaje({ importe: 900, modalidad: 'cuotas', num_cuotas: 3, inicial: 950 })).toBe('La inicial tiene que ser menor que el total');
    expect(mensaje({ importe: 900, inicial: 300 })).toBe('La inicial solo va con «cuotas»');
    expect(mensaje({ importe: 900, modalidad: 'cuotas', num_cuotas: 0, inicial: 300 })).toMatch(/como poco 1/);
    expect(mensaje({ importe: 900, modalidad: 'cuotas', num_cuotas: 37, inicial: 300 })).toMatch(/como mucho 36/);
    // Sin inicial, como antes: de 2.
    expect(mensaje({ importe: 900, modalidad: 'cuotas', num_cuotas: 1 })).toBe('Sin inicial, de 2 cuotas en adelante');
  });
});

describe('el plan con inicial', () => {
  it('la inicial es la cuota 1, hoy; el resto en N iguales, una al mes, la última con los céntimos', () => {
    expect(planConInicial({ total: 1000, inicial: 250, n: 3, desde: '2026-11-21' })).toEqual([
      { numero: 1, importe: 250, vence: '2026-11-21' }, { numero: 2, importe: 250, vence: '2026-12-21' },
      { numero: 3, importe: 250, vence: '2027-01-21' }, { numero: 4, importe: 250, vence: '2027-02-21' }]);
    const p = planConInicial({ total: 900, inicial: 300.01, n: 3, desde: '2027-01-31' });
    expect(p.map((c) => c.importe)).toEqual([300.01, 199.99, 199.99, 200.01]);
    expect(p.map((c) => c.vence)).toEqual(fechasMensuales('2027-01-31', 4));
    expect(p.reduce((t, c) => Math.round((t + c.importe) * 100) / 100, 0)).toBe(900);
    expect(planConInicial({ total: 1000, inicial: 100, n: 7, desde: '2026-11-21' }).map((c) => c.importe))
      .toEqual([100, 128.57, 128.57, 128.57, 128.57, 128.57, 128.57, 128.58]);
    expect(restaCentimos(900, 300.1)).toBe(599.9);
  });
  it('planDelLink: con inicial, N + 1 pagos; sin ella (antes del 21/11), el total entre N; pago único, nada', () => {
    expect(planDelLink({ modalidad: 'cuotas', num_cuotas: 2, importe: '900.00', importe_inicial: '600.00' }, '2026-11-21')
      .map((c) => c.importe)).toEqual([600, 300]);
    expect(planDelLink({ modalidad: 'cuotas', num_cuotas: 3, importe: '1000.00', importe_inicial: null }, '2026-11-21')
      .map((c) => c.importe)).toEqual([333.33, 333.33, 333.34]);
    expect(planDelLink({ modalidad: 'unico', num_cuotas: null, importe: '900.00' }, '2026-11-21')).toBeNull();
  });
});

describe('las reglas del campus', () => {
  const cfg = { cuotas_admitidas: true, cuotas_max: 6, monedas: ['EUR'], moneda_defecto: 'EUR', caducidad_dias: 7, caducidad_max_dias: 30, descuento_max_pct: 15 };
  const prod = { id: 1, precio: '1000', moneda: 'EUR' };
  const reglas = (x) => () => comprobarReglas({ cfg, prod, esAdmin: false, modalidad: 'cuotas', ...x });
  it('con inicial, de 1 al máximo del campus después de ella', () => {
    expect(reglas({ importe: 900, inicial: 300, numCuotas: 1 })()).toMatchObject({ moneda: 'EUR', descuentoPct: 10 });
    expect(reglas({ importe: 900, inicial: 300, numCuotas: 6 })()).toMatchObject({ moneda: 'EUR' });
    expect(reglas({ importe: 900, inicial: 300, numCuotas: 7 })).toThrow(/de 1 a 6 cuotas después de la inicial/);
  });
  it('la inicial y cada cuota, de 0,50 € como poco; la inicial, menor que el total', () => {
    expect(reglas({ importe: 900, inicial: 0.4, numCuotas: 3 })).toThrow(/La inicial tiene que ser de al menos 0,50 €/);
    expect(reglas({ importe: 900, inicial: 899.9, numCuotas: 3 })).toThrow(/Cada cuota tiene que ser de al menos 0,50 €/);
    expect(reglas({ importe: 900, inicial: 900, numCuotas: 3 })).toThrow(/La inicial tiene que ser menor que el total/);
  });
  it('el tope de descuento se mide con el total contra el catálogo', () => {
    expect(() => comprobarReglas({ cfg, prod, esAdmin: false, importe: 849.99 })).toThrow(/El descuento máximo en este campus es un 15 %/);
    expect(comprobarReglas({ cfg, prod, esAdmin: false, importe: 850 })).toMatchObject({ descuentoPct: 15, precioCatalogo: 1000 });
  });
});

describe('el cobro automático con una inicial distinta', () => {
  it('pagada la inicial, Stripe programa las N cuotas con su importe y su fecha', () => {
    const plan = planConInicial({ total: 900, inicial: 300.01, n: 3, desde: '2026-11-21' });
    const cuotas = plan.slice(1).map((c, i) => ({ id: 100 + i, numero: c.numero, importe: c.importe, vence: c.vence }));
    const { fases, problemas } = planificar({ cuotas, pendiente: 599.99, hoy: '2026-11-21' });
    expect(problemas).toEqual([]);
    expect(fases.map((f) => [f.numero, f.fecha, f.importe])).toEqual([
      [2, '2026-12-21', 199.99], [3, '2027-01-21', 199.99], [4, '2027-02-21', 200.01]]);
  });
});

// ─── Contra la base ─────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(linksPago.prefix, linksPago.router);
app.use(errorHandler);
const api = supertest(app);

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const CLAVE_RK = 'rk_' + 'test_EscrituraDeMentiraLinkDescuento';
const CLAVE_LECTURA = 'rk_' + 'test_LecturaDeMentiraLinkDescuento';
let A; let gestora; let curso;

async function ponerClave(projectId, provider, clave) {
  const e = encrypt(clave);
  await integrationsModel.upsert({ projectId, provider, active: true, encrypted_value: e.encrypted, iv: e.iv, auth_tag: e.authTag, config_public: {} });
}
const crear = (cuerpo) => api.post('/api/links-pago').set(como(gestora)).send({ projectId: A, productId: curso, ...cuerpo });
const linkDe = (id) => one('SELECT * FROM payment_links WHERE id = $1', [id]);

/** El alumno paga el link en Checkout (el cargo, con la marca del link). */
async function pagar(link, { email, nombre, telefono, importe, cus = null, pm = null }) {
  const id = `ch_${MARCA}_${++n}`;
  const cargo = {
    id, amount: Math.round(Number(importe) * 100), currency: 'eur', status: 'succeeded', created: Math.floor(Date.now() / 1000),
    customer: cus, payment_method: pm, payment_intent: `pi_${id}`,
    billing_details: { email, name: nombre, phone: telefono },
    metadata: { crm_link_id: String(link.id), crm_project_id: String(link.project_id), crm_user_id: String(link.created_by), crm_entorno: 'local' },
    payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } },
  };
  await servicio.handleWebhookEvent(link.project_id, { id: `evt_${cargo.id}`, type: 'charge.succeeded', data: { object: cargo } });
  return cargo;
}

beforeAll(async () => {
  A = (await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} a`, `${m}-a`, `${MARCA}-k-a`])).id;
  ids.projects.push(A);
  gestora = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', \'gestor\') RETURNING id, role',
    [`${MARCA} gestora`, `gestora@${m}.test`]);
  ids.users.push(gestora.id);
  await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [gestora.id, A]);
  curso = (await one('INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, 1000, \'EUR\') RETURNING id', [A, `${MARCA} máster`])).id;
  await ponerClave(A, 'stripe_links', CLAVE_RK);
  await ponerClave(A, 'stripe', CLAVE_LECTURA);
  await q(`UPDATE projects SET links_pago_cobro_auto = TRUE, links_pago_cobro_auto_reintento_dias = 3,
                 links_pago_descuento_max_pct = 15, links_pago_cuotas_max = 6 WHERE id = $1`, [A]);
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

describe('recorrido 1 · pago único con descuento, contra la base', { timeout: 60_000 }, () => {
  it('Stripe cobra el total; el link guarda el precio y el descuento; la venta se crea por el total, con ellos', async () => {
    const r = await crear({ importe: 900, precio_original: 1000, descuento_tipo: 'pct', descuento_valor: 10 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(de('POST', '/v1/prices')[0].cuerpo.unit_amount).toBe('90000');
    const link = await linkDe(r.body.data.id);
    expect(link).toMatchObject({ modalidad: 'unico', descuento_tipo: 'pct', importe_inicial: null, num_cuotas: null });
    expect([link.importe, link.precio_original, link.descuento_valor, link.descuento_importe, link.descuento_pct].map(Number))
      .toEqual([900, 1000, 10, 100, 10]);
    expect(r.body.data).toMatchObject({ descuento_tipo: 'pct' });
    expect(Number(r.body.data.precio_original)).toBe(1000);

    const email = `unico${Math.random().toString(36).slice(2, 8)}@${m}.test`;
    await pagar(link, { email, nombre: `${MARCA} Alumna Unico`, telefono: '+34611000111', importe: 900 });
    const lead = await one('SELECT id FROM leads WHERE project_id = $1 AND LOWER(email) = $2', [A, email]);
    const venta = await one(
      `SELECT id, importe_total::float8 AS total, subtotal_bruto::float8 AS bruto, descuento_tipo, descuento_valor::float8 AS valor,
              descuento_importe::float8 AS descuento, metodo_pago FROM conversions WHERE lead_id = $1`, [lead.id]);
    expect(venta).toMatchObject({ total: 900, bruto: 1000, descuento_tipo: 'pct', valor: 10, descuento: 100, metodo_pago: 'tarjeta' });
    const pagos = await q('SELECT importe::float8 AS importe FROM conversion_payments WHERE conversion_id = $1', [venta.id]);
    expect(pagos).toEqual([{ importe: 900 }]);
  });

  it('un descuento con céntimos (999 − 10 % = 899,10): se guarda tal cual (QA de staging, 21/11: daba un 500)', async () => {
    const r = await crear({ importe: 899.1, precio_original: 999, descuento_tipo: 'pct', descuento_valor: 10 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(de('POST', '/v1/prices')[0].cuerpo.unit_amount).toBe('89910');
    const link = await linkDe(r.body.data.id);
    expect([link.importe, link.precio_original, link.descuento_importe].map(Number)).toEqual([899.1, 999, 99.9]);
  });

  it('con otro importe y sin descuento: cobra ese importe, sin descuento apuntado', async () => {
    const r = await crear({ importe: 1100 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(de('POST', '/v1/prices')[0].cuerpo.unit_amount).toBe('110000');
    expect(await linkDe(r.body.data.id)).toMatchObject({ descuento_tipo: null, precio_original: null });
  });

  it('un total que no cuadra, un descuento por encima del tope o del precio: 400/403 y nada en Stripe', async () => {
    let r = await crear({ importe: 901, precio_original: 1000, descuento_tipo: 'pct', descuento_valor: 10 });
    expect([r.status, r.body.code]).toEqual([400, 'VALIDATION_ERROR']);
    r = await crear({ importe: 800, precio_original: 1000, descuento_tipo: 'pct', descuento_valor: 20 });
    expect([r.status, r.body.code]).toEqual([403, 'DESCUENTO_MAXIMO']);
    r = await crear({ importe: 1, precio_original: 1000, descuento_tipo: 'monto', descuento_valor: 1200 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('El descuento no puede superar el precio');
    expect(llamadas.filter((l) => l.metodo === 'POST')).toHaveLength(0);
  });
});

describe('recorrido 2 · inicial más cuotas, contra la base', { timeout: 60_000 }, () => {
  it('cobra la inicial; al pagarla, la venta: inicial como cuota 1, el resto en N iguales y el calendario con esas N', async () => {
    // 1000 con 100 € de descuento = 900; inicial 300,01 y 3 cuotas de lo que queda (599,99).
    const r = await crear({
      importe: 900, precio_original: 1000, descuento_tipo: 'monto', descuento_valor: 100,
      modalidad: 'cuotas', num_cuotas: 3, inicial: 300.01,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const link = await linkDe(r.body.data.id);
    expect(link).toMatchObject({ modalidad: 'cuotas', num_cuotas: 4, guarda_tarjeta: true, descuento_tipo: 'monto' });
    expect([link.importe, link.importe_cuota, link.importe_inicial, link.precio_original, link.descuento_importe].map(Number))
      .toEqual([900, 300.01, 300.01, 1000, 100]);
    // Stripe cobra la inicial y guarda la tarjeta, con el consentimiento de las 3 cuotas.
    const precio = de('POST', '/v1/prices')[0].cuerpo;
    expect(precio.unit_amount).toBe('30001');
    expect(precio['product_data[name]']).toMatch(/pago inicial \(luego 3 cuotas al mes\)/);
    const pl = de('POST', '/v1/payment_links')[0].cuerpo;
    expect(pl['payment_intent_data[setup_future_usage]']).toBe('off_session');
    expect(pl['custom_text[submit][message]']).toMatch(/3 cuotas, 599,99 € en total/);

    const email = `inicial${Math.random().toString(36).slice(2, 8)}@${m}.test`;
    const cus = `cus_${MARCA}_inicial`;
    llamadas = [];
    const cargo = await pagar(link, { email, nombre: `${MARCA} Alumna Inicial`, telefono: '+34611000222', importe: 300.01, cus, pm: `pm_${MARCA}_inicial` });
    const fechas = fechasMensuales(new Date(cargo.created * 1000).toISOString().slice(0, 10), 4);

    const lead = await one('SELECT id FROM leads WHERE project_id = $1 AND LOWER(email) = $2', [A, email]);
    const venta = await one(
      `SELECT id, importe_total::float8 AS total, metodo_pago, subtotal_bruto::float8 AS bruto, descuento_tipo,
              descuento_importe::float8 AS descuento, vendedora_id FROM conversions WHERE lead_id = $1`, [lead.id]);
    expect(venta).toMatchObject({ total: 900, metodo_pago: 'fraccionado', bruto: 1000, descuento_tipo: 'monto', descuento: 100, vendedora_id: gestora.id });
    const cuotas = await q(
      `SELECT id, numero, importe_previsto::float8 AS importe, fecha_vencimiento::text AS vence, fecha_cobro IS NOT NULL AS cobrada
         FROM conversion_installments WHERE conversion_id = $1 ORDER BY numero`, [venta.id]);
    expect(cuotas.map((c) => [c.numero, c.importe, c.vence, c.cobrada])).toEqual([
      [1, 300.01, fechas[0], true], [2, 199.99, fechas[1], false], [3, 199.99, fechas[2], false], [4, 200.01, fechas[3], false]]);
    const pagos = await q('SELECT importe::float8 AS importe FROM conversion_payments WHERE conversion_id = $1', [venta.id]);
    expect(pagos).toEqual([{ importe: 300.01 }]);

    // Stripe: un precio por cuota con su importe y un calendario con las tres.
    expect(de('POST', '/v1/prices').map((l) => l.cuerpo.unit_amount)).toEqual(['19999', '19999', '20001']);
    const cal = de('POST', '/v1/subscription_schedules')[0].cuerpo;
    expect(cal.customer).toBe(cus);
    expect([0, 1, 2].map((i) => cal[`phases[${i}][metadata][crm_installment_id]`])).toEqual(cuotas.slice(1).map((c) => String(c.id)));
    expect(cal['phases[3][metadata][crm_installment_id]']).toBeUndefined();
    const enStripe = await q(
      'SELECT installment_id, estado, importe_programado::float8 AS importe FROM cobro_auto_cuotas WHERE conversion_id = $1 ORDER BY installment_id', [venta.id]);
    expect(enStripe.map((c) => [c.installment_id, c.estado, c.importe])).toEqual([
      [cuotas[1].id, 'programada', 199.99], [cuotas[2].id, 'programada', 199.99], [cuotas[3].id, 'programada', 200.01]]);
    expect(await linkDe(link.id)).toMatchObject({ estado: 'pagado', conversion_id: venta.id });
  });

  it('una sola cuota tras la inicial, sí; más que el máximo del campus o una inicial que no es menor que el total, no', async () => {
    let r = await crear({ importe: 1000, modalidad: 'cuotas', num_cuotas: 1, inicial: 400 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(Number(r.body.data.num_cuotas)).toBe(2);
    llamadas = [];
    r = await crear({ importe: 1000, modalidad: 'cuotas', num_cuotas: 7, inicial: 400 });
    expect([r.status, r.body.code]).toEqual([400, 'CUOTAS_MAXIMAS']);
    r = await crear({ importe: 1000, modalidad: 'cuotas', num_cuotas: 3, inicial: 1000 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('La inicial tiene que ser menor que el total');
    expect(de('POST', '/v1/payment_links')).toHaveLength(0);
  });
});
