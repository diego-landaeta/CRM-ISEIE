import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Links de pago: la moneda de cada campus y los códigos promocionales (CRM-ISEIE#661, gemela de CRM#986).
 *
 * Diego, 21/11/2026: «El link sale en la moneda del campus (MXN, COP, CLP…), con
 * el precio del curso en esa moneda cuando lo haya» y «códigos promocionales de
 * Stripe en el link, con fecha límite, para campañas. El descuento aplicado se
 * guarda en la venta».
 *
 *   · lo puro: la moneda que se propone, las monedas sin decimales (CLP), las
 *     cuotas siempre en euros, el fin del día en Madrid, qué links admiten
 *     códigos, las reglas de un código, lo que se manda a Stripe y el descuento
 *     que va a la venta (en euros y en otra moneda);
 *   · contra la base, con un Stripe de mentira: el campus enciende los códigos,
 *     el admin crea uno (cupón y código con su fecha límite), el link lo admite,
 *     y al pagarlo con el código la venta se crea por lo que pagó, con el precio
 *     de antes, el descuento y el código en las notas; un link en MXN sale en
 *     MXN con el precio del curso y su venta lleva el descuento en euros.
 *
 *   npx vitest run tests/linksMonedaCodigos661.test.js
 */

process.env.LOG_LEVEL = 'silent';
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const integrationsModel = await import('../src/modules/integrations/integrations.model.js');
const { default: linksPago } = await import('../src/modules/links-pago/index.js');
const servicio = await import('../src/modules/stripe-payments/stripe-payments.service.js');
const { crearSchema, codigoBodySchema } = await import('../src/modules/links-pago/links-pago.validation.js');
const { comprobarReglas, monedaPropuesta } = await import('../src/modules/links-pago/links-pago.service.js');
const stripe = await import('../src/modules/links-pago/links-pago.stripe.js');
const codigos = await import('../src/modules/links-pago/links-pago.codigos.js');

// ─── Stripe de mentira ──────────────────────────────────────────────────────
let llamadas = [];
let respuestas = [];
const fetchOriginal = globalThis.fetch;
const cuerpoDe = (b) => Object.fromEntries(new URLSearchParams(String(b || '')));
globalThis.fetch = vi.fn(async (url, opciones = {}) => {
  const metodo = (opciones.method || 'GET').toUpperCase();
  const u = new URL(String(url));
  const llamada = {
    metodo, ruta: u.pathname, query: Object.fromEntries(u.searchParams), cuerpo: cuerpoDe(opciones.body), headers: opciones.headers || {},
  };
  llamadas.push(llamada);
  const r = respuestas.find(([m, ruta]) => m === metodo && (typeof ruta === 'string' ? u.pathname === ruta : ruta.test(u.pathname)));
  if (!r) throw new Error(`Stripe de mentira: sin respuesta para ${metodo} ${u.pathname}`);
  const [, , status, body] = r;
  const datos = typeof body === 'function' ? body(llamada) : body ?? {};
  return { ok: status < 400, status, json: async () => datos, text: async () => JSON.stringify(datos) };
});
const de = (metodo, ruta) => llamadas.filter((l) => l.metodo === metodo && (typeof ruta === 'string' ? l.ruta === ruta : ruta.test(l.ruta)));
let n = 0;
const MARCA = `MC${Date.now().toString(36)}`;
const m = MARCA.toLowerCase();
// La sesión de Checkout del pago: sin código, o con uno (descuento en unidades mínimas).
let sesion = { data: [] };
const BASICAS = () => [
  ['GET', '/v1/subscription_schedules', 200, { data: [] }],
  ['GET', '/v1/invoices', 200, { data: [] }],
  ['POST', '/v1/prices', 200, () => ({ id: `price_mc_${MARCA}_${++n}` })],
  ['POST', '/v1/payment_links', 200, () => ({ id: `plink_mc_${MARCA}_${++n}`, url: `https://buy.stripe.com/test_mc_${n}` })],
  ['POST', /^\/v1\/payment_links\/[^/]+$/, 200, { id: 'plink', active: false }],
  ['POST', '/v1/coupons', 200, () => ({ id: `cupon_${MARCA}_${++n}` })],
  ['DELETE', /^\/v1\/coupons\/[^/]+$/, 200, { deleted: true }],
  ['POST', '/v1/promotion_codes', 200, (l) => ({ id: `promo_${MARCA}_${++n}`, code: l.cuerpo.code })],
  ['POST', /^\/v1\/promotion_codes\/[^/]+$/, 200, { active: false }],
  ['GET', '/v1/checkout/sessions', 200, () => sesion],
];

// ─── Lo puro ────────────────────────────────────────────────────────────────

describe('la moneda del link', () => {
  const cfg = {
    monedas: ['MXN', 'EUR', 'USD'], moneda_defecto: 'MXN', caducidad_dias: 7, caducidad_max_dias: 30,
    descuento_max_pct: 0, cuotas_admitidas: true, cuotas_max: 6,
  };
  it('la del curso si tiene precio en una moneda del campus; si no, la del campus; desde una venta, euros', () => {
    expect(monedaPropuesta({ cfg, prod: { precio: 20000, moneda: 'mxn' } })).toBe('MXN');
    // El curso con precio en EUR: el link sale con su precio, en EUR.
    expect(monedaPropuesta({ cfg, prod: { precio: 1000, moneda: 'EUR' } })).toBe('EUR');
    // Sin precio, o con precio en una moneda que el campus no admite: la del campus.
    expect(monedaPropuesta({ cfg, prod: { precio: null, moneda: 'EUR' } })).toBe('MXN');
    expect(monedaPropuesta({ cfg, prod: { precio: 900000, moneda: 'COP' } })).toBe('MXN');
    expect(monedaPropuesta({ cfg, prod: { precio: 20000, moneda: 'MXN' }, desdeVenta: true })).toBe('EUR');
    expect(monedaPropuesta({ cfg: { ...cfg, monedas: ['MXN'] }, prod: {}, desdeVenta: true })).toBe('MXN');
  });
  it('sin moneda pedida, el link sale en la propuesta y con el precio del curso en ella', () => {
    expect(comprobarReglas({ cfg, prod: { precio: '20000', moneda: 'MXN' }, importe: 20000, esAdmin: false }))
      .toMatchObject({ moneda: 'MXN', precioCatalogo: 20000, descuentoPct: 0 });
    // Pedir otra moneda distinta a la del precio: sin precio con que comparar, solo el admin.
    expect(() => comprobarReglas({ cfg, prod: { precio: '20000', moneda: 'MXN' }, importe: 1000, moneda: 'USD', esAdmin: false }))
      .toThrow(/El precio del catálogo está en MXN: un link en USD lo tiene que crear un admin/);
  });
  it('en CLP (sin decimales en Stripe) el importe va entero', () => {
    const clp = { ...cfg, monedas: ['CLP', 'EUR'], moneda_defecto: 'CLP' };
    expect(comprobarReglas({ cfg: clp, prod: { precio: 900000, moneda: 'CLP' }, importe: 900000, esAdmin: false }))
      .toMatchObject({ moneda: 'CLP', precioCatalogo: 900000 });
    expect(() => comprobarReglas({ cfg: clp, prod: { precio: 900000, moneda: 'CLP' }, importe: 900000.5, esAdmin: true }))
      .toThrow(/En CLP el importe va sin decimales/);
    expect(stripe.enUnidadesMinimas(900000, 'CLP')).toBe(900000);
    expect(stripe.deUnidadesMinimas(900000, 'CLP')).toBe(900000);
    expect(stripe.deUnidadesMinimas(12345, 'MXN')).toBe(123.45);
  });
  it('las cuotas, siempre en euros aunque el campus sea de otra moneda; sin euros admitidos, no hay cuotas', () => {
    const r = comprobarReglas({
      cfg, prod: { precio: 1000, moneda: 'EUR' }, importe: 1000, modalidad: 'cuotas', numCuotas: 3, esAdmin: false,
    });
    expect(r.moneda).toBe('EUR');
    expect(() => comprobarReglas({
      cfg, prod: { precio: 20000, moneda: 'MXN' }, importe: 20000, moneda: 'MXN', modalidad: 'cuotas', numCuotas: 3, esAdmin: true,
    })).toThrow(/Los links en cuotas van en euros/);
    expect(() => comprobarReglas({
      cfg: { ...cfg, monedas: ['MXN'] }, prod: { precio: 20000, moneda: 'MXN' }, importe: 20000, modalidad: 'cuotas', numCuotas: 3, esAdmin: true,
    })).toThrow(/no cobra en EUR/);
  });
});

describe('qué links admiten códigos promocionales', () => {
  const si = { codigos_promo: true };
  const no = { codigos_promo: false };
  it('sin decirlo, lo que diga el campus, solo en pago único y sin venta', () => {
    expect(codigos.codigosDelLink({ cfg: si, enCuotas: false, desdeVenta: false })).toBe(true);
    expect(codigos.codigosDelLink({ cfg: no, enCuotas: false, desdeVenta: false })).toBe(false);
    expect(codigos.codigosDelLink({ cfg: si, enCuotas: true, desdeVenta: false })).toBe(false);
    expect(codigos.codigosDelLink({ cfg: si, enCuotas: false, desdeVenta: true })).toBe(false);
    expect(codigos.codigosDelLink({ pedido: false, cfg: si, enCuotas: false, desdeVenta: false })).toBe(false);
  });
  it('pedirlos donde no caben es un 400 que dice por qué', () => {
    expect(() => codigos.codigosDelLink({ pedido: true, cfg: no })).toThrow(/no admite códigos promocionales/);
    expect(() => codigos.codigosDelLink({ pedido: true, cfg: si, enCuotas: true })).toThrow(/solo en pago único/);
    expect(() => codigos.codigosDelLink({ pedido: true, cfg: si, desdeVenta: true })).toThrow(/Desde una venta/);
  });
  it('al pagarse, solo se mira el código en los de pago único que lo admitían', () => {
    expect(codigos.admiteCodigos({ codigos_promo: true, modalidad: 'unico' })).toBe(true);
    expect(codigos.admiteCodigos({ codigos_promo: true, modalidad: 'cuotas' })).toBe(false);
    expect(codigos.admiteCodigos({ codigos_promo: true, modalidad: 'unico', installment_id: 5 })).toBe(false);
    expect(codigos.admiteCodigos({ codigos_promo: false, modalidad: 'unico' })).toBe(false);
  });
});

describe('un código de campaña', () => {
  const cfg = { codigos_promo: true, monedas: ['EUR', 'CLP'], moneda_defecto: 'EUR' };
  const hoy = '2026-11-23';
  it('la fecha límite: el último segundo de ese día en Madrid (invierno y verano)', () => {
    expect(codigos.finDelDiaEnMadrid('2026-11-30')).toBe(Date.UTC(2026, 10, 30, 22, 59, 59) / 1000);
    expect(codigos.finDelDiaEnMadrid('2027-07-15')).toBe(Date.UTC(2027, 6, 15, 21, 59, 59) / 1000);
  });
  it('las reglas: campus con códigos, fecha de hoy a un año, moneda del campus, sin decimales en CLP', () => {
    expect(codigos.comprobarCodigo({ cfg, codigo: 'black20', tipo: 'pct', valor: 20, caducaEl: '2026-11-30', hoy }))
      .toEqual({ codigo: 'BLACK20', tipo: 'pct', valor: 20, moneda: null, caducaEl: '2026-11-30' });
    expect(codigos.comprobarCodigo({ cfg, codigo: 'MENOS50', tipo: 'monto', valor: 50, caducaEl: hoy, hoy }))
      .toMatchObject({ moneda: 'EUR' });
    expect(() => codigos.comprobarCodigo({ cfg: { ...cfg, codigos_promo: false }, codigo: 'X20', tipo: 'pct', valor: 20, caducaEl: '2026-11-30', hoy }))
      .toThrow(/no admite códigos/);
    expect(() => codigos.comprobarCodigo({ cfg, codigo: 'X20', tipo: 'pct', valor: 20, caducaEl: '2026-11-22', hoy }))
      .toThrow(/anterior a hoy/);
    expect(() => codigos.comprobarCodigo({ cfg, codigo: 'X20', tipo: 'pct', valor: 20, caducaEl: '2027-11-25', hoy }))
      .toThrow(/un año/);
    expect(() => codigos.comprobarCodigo({ cfg, codigo: 'X20', tipo: 'monto', valor: 20, moneda: 'USD', caducaEl: '2026-11-30', hoy }))
      .toThrow(/no cobra en USD/);
    expect(() => codigos.comprobarCodigo({ cfg, codigo: 'X20', tipo: 'monto', valor: 20.5, moneda: 'CLP', caducaEl: '2026-11-30', hoy }))
      .toThrow(/sin decimales/);
  });
  it('Zod: código de 3 a 40 sin espacios, % hasta 100, fecha obligatoria, moneda solo en importe', () => {
    const ok = (b) => codigoBodySchema.safeParse({ projectId: 1, tipo: 'pct', valor: 10, caduca_el: '2026-11-30', codigo: 'BF-2026', ...b });
    expect(ok({}).success).toBe(true);
    expect(ok({ codigo: ' bf_26 ' }).data.codigo).toBe('BF_26');
    expect(ok({ codigo: 'BF 26' }).success).toBe(false);
    expect(ok({ codigo: 'AB' }).success).toBe(false);
    expect(ok({ valor: 101 }).error.errors[0].message).toBe('El descuento no puede pasar del 100 %');
    expect(ok({ caduca_el: undefined }).success).toBe(false);
    expect(ok({ caduca_el: '2026-02-30' }).success).toBe(false);
    expect(ok({ moneda: 'EUR' }).error.errors[0].message).toBe('La moneda solo va con un descuento en importe');
    expect(ok({ tipo: 'monto', valor: 50, moneda: 'eur' }).data.moneda).toBe('EUR');
    expect(crearSchema.safeParse({ projectId: 1, productId: 2, importe: 10, codigos_promo: 'si' }).success).toBe(false);
  });
});

describe('lo que se manda a Stripe', () => {
  beforeEach(() => { llamadas = []; respuestas = BASICAS(); });
  it('el link con códigos lleva allow_promotion_codes; sin ellos, no', async () => {
    await stripe.crearLink('rk_test_x', { priceId: 'price_1', metadata: { crm_link_id: '1' }, codigosPromo: true });
    await stripe.crearLink('rk_test_x', { priceId: 'price_1', metadata: { crm_link_id: '1' } });
    const [con, sin] = de('POST', '/v1/payment_links');
    expect(con.cuerpo.allow_promotion_codes).toBe('true');
    expect(sin.cuerpo.allow_promotion_codes).toBeUndefined();
  });
  it('el cupón, una vez y hasta la fecha límite; el código, con versión fija de la API, su fecha y sus usos', async () => {
    await stripe.crearCupon('rk_test_x', { tipo: 'pct', valor: 20, nombre: 'Black Friday', hasta: 1800000000, metadata: { a: '1' } });
    await stripe.crearCupon('rk_test_x', { tipo: 'monto', valor: 5000, moneda: 'CLP', nombre: 'CL', hasta: 1800000000 });
    const [pct, clp] = de('POST', '/v1/coupons');
    expect(pct.cuerpo).toMatchObject({ percent_off: '20', duration: 'once', redeem_by: '1800000000', name: 'Black Friday' });
    expect(clp.cuerpo).toMatchObject({ amount_off: '5000', currency: 'clp' });
    expect(pct.headers['Stripe-Version']).toBeUndefined();
    await stripe.crearCodigoPromocional('rk_test_x', { cuponId: 'cupon_1', codigo: 'BF20', hasta: 1800000000, maxUsos: 100 });
    const [cod] = de('POST', '/v1/promotion_codes');
    expect(cod.cuerpo).toMatchObject({ coupon: 'cupon_1', code: 'BF20', expires_at: '1800000000', max_redemptions: '100' });
    expect(cod.headers['Stripe-Version']).toBe(stripe.VERSION_CODIGOS);
  });
});

describe('el descuento que va a la venta', () => {
  it('en euros sin código, el del link tal cual (como hasta ahora)', () => {
    expect(codigos.descuentoParaLaVenta(
      { moneda: 'EUR', importe: 900, precio_original: 1000, descuento_tipo: 'pct', descuento_valor: 10, descuento_importe: 100 },
      { importeVenta: 900 },
    )).toEqual({ subtotal: 1000, tipo: 'pct', valor: 10, importe: 100 });
    expect(codigos.descuentoParaLaVenta({ moneda: 'EUR', importe: 900 }, { importeVenta: 900 })).toBeNull();
  });
  it('en euros con código: el del link más el del código, en €; el precio de antes menos eso es el total', () => {
    // 1000 − 10 % = 900 el link; el código quita 90 más: paga 810.
    const link = {
      moneda: 'EUR', importe: 810, importe_del_link: 900, precio_original: 1000, descuento_tipo: 'pct', descuento_valor: 10,
      descuento_importe: 100, promo: { codigo: 'BF10', descuento: 90 },
    };
    expect(codigos.descuentoParaLaVenta(link, { importeVenta: 810 })).toEqual({ subtotal: 1000, tipo: 'monto', valor: 190, importe: 190 });
  });
  it('en otra moneda, el descuento pasa a euros con el cambio del propio cobro', () => {
    // 20.000 MXN − 2.000 del código = 18.000 MXN pagados, que entraron como 900 €.
    const link = { moneda: 'MXN', importe: 20000, importe_del_link: 20000, promo: { codigo: 'MX10', descuento: 2000 } };
    expect(codigos.descuentoParaLaVenta(link, { importeVenta: 900 })).toEqual({ subtotal: 1000, tipo: 'monto', valor: 100, importe: 100 });
    // Sin código pero con el descuento del link (CRM#982), también en euros.
    const sinCodigo = { moneda: 'MXN', importe: 18000, precio_original: 20000, descuento_tipo: 'monto', descuento_valor: 2000, descuento_importe: 2000 };
    expect(codigos.descuentoParaLaVenta(sinCodigo, { importeVenta: 900 })).toEqual({ subtotal: 1000, tipo: 'monto', valor: 100, importe: 100 });
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
const CLAVE_RK = 'rk_' + 'test_EscrituraDeMentiraMonedaCodigos';
const CLAVE_LECTURA = 'rk_' + 'test_LecturaDeMentiraMonedaCodigos';
let A; let MX; let admin; let gestora; let curso; let cursoMx; let leadA;

async function ponerClave(projectId, provider, clave) {
  const e = encrypt(clave);
  await integrationsModel.upsert({ projectId, provider, active: true, encrypted_value: e.encrypted, iv: e.iv, auth_tag: e.authTag, config_public: {} });
}
const linkDe = (id) => one('SELECT * FROM payment_links WHERE id = $1', [id]);
const enMadrid = (dias = 0) => {
  const d = new Date(Date.now() + dias * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d);
};

/** El alumno paga el link en Checkout: el cargo con la marca del link, en su moneda. */
async function pagar(link, { email, nombre, importe, moneda = 'eur', euros = null }) {
  const id = `ch_${MARCA}_${++n}`;
  const cargo = {
    id, amount: stripe.enUnidadesMinimas(importe, moneda), currency: moneda, status: 'succeeded', created: Math.floor(Date.now() / 1000),
    payment_intent: `pi_${id}`,
    billing_details: { email, name: nombre, phone: '+34611000333' },
    metadata: { crm_link_id: String(link.id), crm_project_id: String(link.project_id), crm_user_id: String(link.created_by), crm_entorno: 'local' },
    payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } },
    ...(euros != null ? { balance_transaction: { amount: Math.round(euros * 100), fee: 0, net: Math.round(euros * 100), exchange_rate: 0.05 } } : {}),
  };
  await servicio.handleWebhookEvent(link.project_id, { id: `evt_${cargo.id}`, type: 'charge.succeeded', data: { object: cargo } });
  return cargo;
}

describe('contra la base', () => {
beforeAll(async () => {
  const campus = async (sufijo) => {
    const p = (await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${sufijo}`, `${m}-${sufijo}`, `${MARCA}-k-${sufijo}`])).id;
    ids.projects.push(p);
    await ponerClave(p, 'stripe_links', CLAVE_RK);
    await ponerClave(p, 'stripe', CLAVE_LECTURA);
    return p;
  };
  A = await campus('a');
  MX = await campus('mx');
  const usuario = async (nombre, role) => {
    const u = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', $3) RETURNING id, role',
      [`${MARCA} ${nombre}`, `${nombre}@${m}.test`, role]);
    ids.users.push(u.id);
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2), ($1, $3)', [u.id, A, MX]);
    return u;
  };
  admin = await usuario('admin', 'admin');
  gestora = await usuario('gestora', 'gestor');
  curso = (await one('INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, 1000, \'EUR\') RETURNING id', [A, `${MARCA} máster`])).id;
  cursoMx = (await one('INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, 20000, \'MXN\') RETURNING id', [MX, `${MARCA} diplomado`])).id;
  leadA = (await one('INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [A, `${MARCA} Prospecto`, `prospecto@${m}.test`, gestora.id])).id;
  // El campus de México: cobra en MXN por defecto (y admite EUR, para las cuotas).
  await q(`UPDATE projects SET links_pago_monedas = ARRAY['EUR','MXN']::varchar(3)[], links_pago_moneda_defecto = 'MXN' WHERE id = $1`, [MX]);
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

beforeEach(() => { llamadas = []; respuestas = BASICAS(); sesion = { data: [] }; });

describe('los códigos de campaña, contra la base', { timeout: 60_000 }, () => {
  it('sin encender en el campus no se crean; encendidos, el admin crea uno con su fecha límite (cupón + código)', async () => {
    const cuerpo = { projectId: A, codigo: 'bf20', tipo: 'pct', valor: 20, caduca_el: enMadrid(7), campana: 'Black Friday', max_usos: 50 };
    let r = await api.post('/api/links-pago/codigos').set(como(admin)).send(cuerpo);
    expect([r.status, r.body.code]).toEqual([400, 'CODIGOS_NO_ADMITIDOS']);
    expect(llamadas).toHaveLength(0);

    r = await api.put('/api/links-pago/config').set(como(admin)).send({ projectId: A, codigos_promo: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.codigos_promo).toBe(true);

    // La gestora no crea códigos.
    expect((await api.post('/api/links-pago/codigos').set(como(gestora)).send(cuerpo)).status).toBe(403);

    r = await api.post('/api/links-pago/codigos').set(como(admin)).send(cuerpo);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ codigo: 'BF20', tipo: 'pct', valor: 20, estado: 'vigente', max_usos: 50, caduca_el: enMadrid(7) });
    const hasta = String(codigos.finDelDiaEnMadrid(enMadrid(7)));
    expect(de('POST', '/v1/coupons')[0].cuerpo).toMatchObject({ percent_off: '20', duration: 'once', redeem_by: hasta });
    expect(de('POST', '/v1/promotion_codes')[0].cuerpo).toMatchObject({ code: 'BF20', expires_at: hasta, max_redemptions: '50' });

    // El mismo código vivo otra vez: 409 y nada nuevo en Stripe.
    llamadas = [];
    r = await api.post('/api/links-pago/codigos').set(como(admin)).send(cuerpo);
    expect([r.status, r.body.code]).toEqual([409, 'CODIGO_REPETIDO']);
    expect(llamadas).toHaveLength(0);

    // La gestora ve los vigentes; el admin, todos.
    const g = await api.get(`/api/links-pago/codigos?projectId=${A}`).set(como(gestora));
    expect(g.status).toBe(200);
    expect(g.body.data.map((c) => c.codigo)).toContain('BF20');
  });

  it('si Stripe no crea el código, el cupón se borra y no queda fila', async () => {
    respuestas = [['POST', '/v1/promotion_codes', 400, { error: { message: 'An active promotion code with `code: OTRO10` already exists.' } }], ...BASICAS()];
    const r = await api.post('/api/links-pago/codigos').set(como(admin))
      .send({ projectId: A, codigo: 'OTRO10', tipo: 'monto', valor: 10, caduca_el: enMadrid(3) });
    expect([r.status, r.body.code]).toEqual([424, 'STRIPE_ERROR']);
    expect(r.body.error).toMatch(/already exists/);
    expect(de('DELETE', /^\/v1\/coupons\//)).toHaveLength(1);
    expect(await one('SELECT id FROM links_pago_codigos WHERE project_id = $1 AND codigo = $2', [A, 'OTRO10'])).toBeUndefined();
  });

  it('desactivar un código lo apaga en Stripe y deja de salirle a la gestora', async () => {
    const c = await one('SELECT id, stripe_promotion_code_id FROM links_pago_codigos WHERE project_id = $1 AND codigo = $2', [A, 'BF20']);
    const r = await api.post(`/api/links-pago/codigos/${c.id}/desactivar`).set(como(admin)).send({ projectId: A });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.estado).toBe('desactivado');
    expect(de('POST', `/v1/promotion_codes/${c.stripe_promotion_code_id}`)[0].cuerpo).toEqual({ active: 'false' });
    const g = await api.get(`/api/links-pago/codigos?projectId=${A}`).set(como(gestora));
    expect(g.body.data.map((x) => x.codigo)).not.toContain('BF20');
  });
});

describe('el link con códigos y su venta, contra la base', { timeout: 60_000 }, () => {
  it('el link de pago único admite códigos; desde una venta o en cuotas, no', async () => {
    let r = await api.post('/api/links-pago').set(como(gestora)).send({ leadId: leadA, productId: curso, importe: 1000 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.codigos_promo).toBe(true);
    expect(de('POST', '/v1/payment_links')[0].cuerpo.allow_promotion_codes).toBe('true');

    llamadas = [];
    r = await api.post('/api/links-pago').set(como(gestora)).send({ leadId: leadA, productId: curso, importe: 1000, codigos_promo: false });
    expect(r.body.data.codigos_promo).toBe(false);
    expect(de('POST', '/v1/payment_links')[0].cuerpo.allow_promotion_codes).toBeUndefined();

    r = await api.post('/api/links-pago').set(como(gestora))
      .send({ leadId: leadA, productId: curso, importe: 1000, modalidad: 'cuotas', num_cuotas: 2, inicial: 400, codigos_promo: true });
    expect([r.status, r.body.code]).toEqual([400, 'CODIGOS_NO_ADMITIDOS']);
  });

  it('pagado con un código: la venta se crea por lo que pagó, con el precio de antes, el descuento y el código', async () => {
    const r = await api.post('/api/links-pago').set(como(gestora))
      .send({ projectId: A, productId: curso, importe: 1000 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const link = await linkDe(r.body.data.id);
    // El alumno escribe BF20 en Checkout: 200 € menos.
    sesion = { data: [{ id: 'cs_1', currency: 'eur', amount_total: 80000, total_details: { amount_discount: 20000 },
      discounts: [{ promotion_code: { id: 'promo_x', code: 'BF20' } }] }] };
    const email = `codigo${Math.random().toString(36).slice(2, 8)}@${m}.test`;
    await pagar(link, { email, nombre: `${MARCA} Alumna Codigo`, importe: 800 });
    expect(de('GET', '/v1/checkout/sessions')[0].query.payment_intent).toMatch(/^pi_ch_/);

    const lead = await one('SELECT id FROM leads WHERE project_id = $1 AND LOWER(email) = $2', [A, email]);
    const venta = await one(
      `SELECT id, importe_total::float8 AS total, subtotal_bruto::float8 AS bruto, descuento_tipo,
              descuento_importe::float8 AS descuento, notas_pago AS notas FROM conversions WHERE lead_id = $1`, [lead.id]);
    expect(venta).toMatchObject({ total: 800, bruto: 1000, descuento_tipo: 'monto', descuento: 200 });
    expect(venta.notas).toMatch(/Código promocional BF20: 200\.00 EUR de descuento/);
    const pagos = await q('SELECT importe::float8 AS importe FROM conversion_payments WHERE conversion_id = $1', [venta.id]);
    expect(pagos).toEqual([{ importe: 800 }]);
    const ahora = await linkDe(link.id);
    expect(ahora).toMatchObject({ estado: 'pagado', promo_codigo: 'BF20' });
    expect(Number(ahora.promo_descuento)).toBe(200);
    const ev = await q("SELECT datos FROM payment_link_eventos WHERE link_id = $1 AND tipo = 'codigo_promocional'", [link.id]);
    expect(ev).toHaveLength(1);
    expect(ev[0].datos).toMatchObject({ codigo: 'BF20', descuento: 200, moneda: 'EUR' });
  });

  it('pagado sin código: la venta, por el total del link y sin descuento', async () => {
    const r = await api.post('/api/links-pago').set(como(gestora)).send({ projectId: A, productId: curso, importe: 1000 });
    const link = await linkDe(r.body.data.id);
    sesion = { data: [{ id: 'cs_2', currency: 'eur', amount_total: 100000, total_details: { amount_discount: 0 }, discounts: [] }] };
    const email = `sincodigo${Math.random().toString(36).slice(2, 8)}@${m}.test`;
    await pagar(link, { email, nombre: `${MARCA} Alumna Sin Codigo`, importe: 1000 });
    const lead = await one('SELECT id FROM leads WHERE project_id = $1 AND LOWER(email) = $2', [A, email]);
    const venta = await one('SELECT importe_total::float8 AS total, descuento_tipo FROM conversions WHERE lead_id = $1', [lead.id]);
    expect(venta).toEqual({ total: 1000, descuento_tipo: 'none' });
    expect(await linkDe(link.id)).toMatchObject({ promo_codigo: null, promo_descuento: null });
  });
});

describe('la moneda del campus, contra la base', { timeout: 60_000 }, () => {
  it('en el campus de México el link sale en MXN con el precio del curso; pagado con código, la venta en euros con su descuento', async () => {
    await q('UPDATE projects SET links_pago_codigos_promo = TRUE WHERE id = $1', [MX]);
    const r = await api.post('/api/links-pago').set(como(gestora)).send({ projectId: MX, productId: cursoMx, importe: 20000 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ moneda: 'MXN', codigos_promo: true });
    expect(Number(r.body.data.precio_catalogo)).toBe(20000);
    expect(de('POST', '/v1/prices')[0].cuerpo).toMatchObject({ currency: 'mxn', unit_amount: '2000000' });

    const link = await linkDe(r.body.data.id);
    // Paga 18.000 MXN con un código de 2.000 MXN; entran 900 € en la cuenta.
    sesion = { data: [{ id: 'cs_3', currency: 'mxn', amount_total: 1800000, total_details: { amount_discount: 200000 },
      discounts: [{ promotion_code: { id: 'promo_mx', code: 'MX10' } }] }] };
    const email = `mx${Math.random().toString(36).slice(2, 8)}@${m}.test`;
    await pagar(link, { email, nombre: `${MARCA} Alumna MX`, importe: 18000, moneda: 'mxn', euros: 900 });
    const lead = await one('SELECT id FROM leads WHERE project_id = $1 AND LOWER(email) = $2', [MX, email]);
    const venta = await one(
      `SELECT importe_total::float8 AS total, subtotal_bruto::float8 AS bruto, descuento_tipo, descuento_importe::float8 AS descuento
         FROM conversions WHERE lead_id = $1`, [lead.id]);
    expect(venta).toEqual({ total: 900, bruto: 1000, descuento_tipo: 'monto', descuento: 100 });
    const ahora = await linkDe(link.id);
    expect(ahora.promo_codigo).toBe('MX10');
    expect(Number(ahora.promo_descuento)).toBe(2000);
  });

  it('un cargo en CLP guarda el importe original en pesos, no dividido entre 100', async () => {
    await q(`UPDATE projects SET links_pago_monedas = ARRAY['EUR','MXN','CLP']::varchar(3)[] WHERE id = $1`, [MX]);
    const r = await api.post('/api/links-pago').set(como(admin)).send({ projectId: MX, productId: cursoMx, importe: 900000, moneda: 'CLP' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(de('POST', '/v1/prices')[0].cuerpo).toMatchObject({ currency: 'clp', unit_amount: '900000' });
    const link = await linkDe(r.body.data.id);
    const cargo = await pagar(link, { email: `clp@${m}.test`, nombre: `${MARCA} Alumna CLP`, importe: 900000, moneda: 'clp', euros: 850 });
    const sp = await one('SELECT amount::float8 AS amount, metadata FROM stripe_payments WHERE stripe_id = $1', [cargo.id]);
    expect(sp.amount).toBe(850);
    expect(Number(sp.metadata.original_amount)).toBe(900000);
    expect(sp.metadata.original_currency).toBe('CLP');
  });
});
});
