import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * STRIPE PRESTADO (migración 332). «ICTESS US e Instituto Naval usarán
 * momentáneamente el Stripe de ICTESS» (Diego, 24/11/2026). Contra la base
 * local de verdad y con Stripe de mentira.
 *
 *   · la base solo deja declararlo entre campus de la misma empresa, sin
 *     cadenas ni a uno mismo;
 *   · las claves del campus que la toma prestada son las del dueño (nunca la
 *     del `.env`);
 *   · un link creado desde el campus prestado se crea con la clave de links del
 *     dueño y lleva la marca del campus que vende;
 *   · el aviso llega por la ruta del dueño y, con la marca del prestado, se
 *     procesa como el prestado (su venta, su link), no como «ajeno»;
 *   · la sincronización de la cuenta es una (la del dueño): cada cargo, a UN
 *     campus; sincronizar desde el prestado es sincronizar la del dueño; un
 *     cargo que el dueño ya tenía sin asociar pasa al prestado;
 *   · la API dice `stripe_prestado_de` y la salud «Usa el Stripe de …».
 *
 * ISEIE tiene una sola empresa y un solo campus: el código es el mismo que en
 * el 360 (CRM) por paridad y es inerte mientras nadie lo declare.
 *
 *   npx vitest run tests/stripePrestado.test.js
 */

process.env.LOG_LEVEL = 'silent';
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const integrationsModel = await import('../src/modules/integrations/integrations.model.js');
const { default: linksPago } = await import('../src/modules/links-pago/index.js');
const { default: integraciones } = await import('../src/modules/integrations/index.js');
const servicio = await import('../src/modules/stripe-payments/stripe-payments.service.js');
const { claveDeStripe } = await import('../src/modules/stripe-payments/suscripciones.service.js');
const links = await import('../src/modules/links-pago/links-pago.service.js');
const prestado = await import('../src/modules/stripe-payments/stripe-prestado.js');
const { conStripePrestado } = await import('../src/modules/integrations/salud.service.js');

// ─── Stripe de mentira ──────────────────────────────────────────────────────
let preparadas = [];
const llamadas = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = vi.fn(async (url, opciones = {}) => {
  const metodo = (opciones.method || 'GET').toUpperCase();
  const u = new URL(String(url));
  const cuerpo = opciones.body ? Object.fromEntries(new URLSearchParams(opciones.body)) : null;
  llamadas.push({ metodo, ruta: u.pathname, cuerpo, headers: opciones.headers || {} });
  const r = preparadas.find(([m, ruta]) => m === metodo && u.pathname === ruta);
  if (!r) throw new Error(`Stripe de mentira: sin respuesta para ${metodo} ${u.pathname}`);
  const [, , status, body] = r;
  const datos = typeof body === 'function' ? body(cuerpo) : body ?? {};
  return { ok: status < 400, status, json: async () => datos, text: async () => JSON.stringify(datos) };
});

const app = express();
app.use(express.json());
app.use(linksPago.prefix, linksPago.router);
app.use(integraciones.prefix, integraciones.router);
app.use(errorHandler);
const api = supertest(app);

const MARCA = `SPRE${Date.now().toString(36)}`;
const m = MARCA.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], issuers: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
// Partidas: que no parezcan claves reales a los escáneres.
const CLAVE_LINKS = 'rk_' + 'test_LinksDelDuenoPrestado332';
const CLAVE_LECTURA = 'rk_' + 'test_LecturaDelDuenoPrestado332';

let DUENO; let US; let NAVAL; let OTRA; let SOLO;
const p = {};
const prod = {};

async function ponerClave(projectId, provider, clave, config = {}) {
  const e = encrypt(clave);
  await integrationsModel.upsert({ projectId, provider, active: true, encrypted_value: e.encrypted, iv: e.iv, auth_tag: e.authTag, config_public: config });
}
let nCargo = 0;
function cargoDe(euros, { metadata = {}, email = null, customer = null } = {}) {
  const k = ++nCargo;
  return {
    id: `ch_${MARCA}_${k}`, amount: Math.round(euros * 100), currency: 'eur', status: 'succeeded',
    created: Math.floor(Date.now() / 1000) + k, customer,
    billing_details: { email: email || `pagador${k}@${m}.test`, name: `${MARCA} Pagador` }, metadata,
    payment_method_details: { type: 'card' }, balance_transaction: { amount: Math.round(euros * 100), fee: 0, net: Math.round(euros * 100) },
  };
}
const aviso = (cargo) => ({ id: `evt_${cargo.id}`, type: 'charge.succeeded', data: { object: cargo } });
const filasDelCargo = (stripeId) => q('SELECT project_id, conversion_id, payment_link_id, link_method FROM stripe_payments WHERE stripe_id = $1', [stripeId]);

beforeAll(async () => {
  const empresa = async (x) => {
    const e = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} ${x}`, `B${x}${Date.now().toString().slice(-7)}`]);
    ids.issuers.push(e.id);
    return e.id;
  };
  const E1 = await empresa('1');
  const E2 = await empresa('2');
  const campus = async (x, sociedad) => {
    const r = await one('INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [`${MARCA} ${x}`, `${m}-${x}`, `${MARCA}-k-${x}`, sociedad]);
    ids.projects.push(r.id);
    return r.id;
  };
  DUENO = await campus('ictess', E1);
  US = await campus('us', E1);
  NAVAL = await campus('naval', E1);
  SOLO = await campus('solo', E1); // misma empresa, sin préstamo: no le toca nada de la cuenta del dueño
  OTRA = await campus('otra', E2); // otra empresa: no puede tomarla prestada

  const persona = async (x, role, suyos) => {
    const u = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', $3) RETURNING id, role',
      [`${MARCA} ${x}`, `${x}@${m}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  p.gestoraUS = await persona('gestora-us', 'gestor', [US]);
  p.super = await persona('super', 'superadmin', []);
  prod.US = (await one('INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, 800, \'EUR\') RETURNING id',
    [US, `${MARCA} curso US`])).id;

  await ponerClave(DUENO, 'stripe_links', CLAVE_LINKS);
  await ponerClave(DUENO, 'stripe', CLAVE_LECTURA, { webhook_endpoint_id: 'we_prestado332' });
  await q('UPDATE projects SET stripe_prestado_de = $1 WHERE id = ANY($2::int[])', [DUENO, [US, NAVAL]]);
}, 60_000);

afterAll(async () => {
  for (const [sql, lista] of [
    ['UPDATE projects SET stripe_prestado_de = NULL WHERE id = ANY($1)', ids.projects],
    ['DELETE FROM payment_links WHERE project_id = ANY($1)', ids.projects],
    ['DELETE FROM projects WHERE id = ANY($1)', ids.projects],
    ['DELETE FROM invoice_issuers WHERE id = ANY($1)', ids.issuers],
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

// ─── 1. La declaración ──────────────────────────────────────────────────────

describe('declarar el préstamo (migración 332)', () => {
  it('solo entre campus de la misma empresa, sin cadenas ni a uno mismo', async () => {
    await expect(q('UPDATE projects SET stripe_prestado_de = $1 WHERE id = $2', [DUENO, OTRA])).rejects.toThrow(/misma empresa/);
    await expect(q('UPDATE projects SET stripe_prestado_de = $1 WHERE id = $1', [SOLO])).rejects.toThrow();
    // El que la toma prestada no puede prestarla, y el dueño no puede tomar otra.
    await expect(q('UPDATE projects SET stripe_prestado_de = $1 WHERE id = $2', [US, SOLO])).rejects.toThrow(/ya usa la cuenta de otro/);
    await expect(q('UPDATE projects SET stripe_prestado_de = $1 WHERE id = $2', [SOLO, DUENO])).rejects.toThrow(/otros campus usan/);
  });

  it('quién es quién: dueño, los que la usan y su nombre', async () => {
    expect(await prestado.prestadoDe(US)).toEqual({ id: DUENO, nombre: `${MARCA} ictess` });
    expect(await prestado.prestadoDe(DUENO)).toBeNull();
    expect(await prestado.prestadoDe(SOLO)).toBeNull();
    expect(await prestado.duenoDeLaCuenta(NAVAL)).toBe(DUENO);
    expect(await prestado.duenoDeLaCuenta(SOLO)).toBe(SOLO);
    expect(await prestado.quienesLaUsan(DUENO)).toEqual([US, NAVAL].sort((a, b) => a - b));
    expect(await prestado.quienesLaUsan(SOLO)).toEqual([]);
  });

  it('a qué campus va algo de la cuenta: la marca manda; luego el cliente; si no, el dueño', () => {
    const lista = [US, NAVAL];
    expect(prestado.elegirCampus(DUENO, lista, { metadata: { crm_project_id: String(US) } })).toBe(US);
    expect(prestado.elegirCampus(DUENO, lista, { metadata: { crm_project_id: String(DUENO) } })).toBe(DUENO);
    // La marca de un campus que NO la toma prestada no saca el cargo del dueño.
    expect(prestado.elegirCampus(DUENO, lista, { metadata: { crm_project_id: String(SOLO) } })).toBe(DUENO);
    expect(prestado.elegirCampus(DUENO, lista, { metadata: {}, campusDelCliente: NAVAL })).toBe(NAVAL);
    expect(prestado.elegirCampus(DUENO, lista, { metadata: {} })).toBe(DUENO);
    expect(prestado.elegirCampus(DUENO, [], { metadata: { crm_project_id: String(US) } })).toBe(DUENO);
  });
});

// ─── 2. Las claves ──────────────────────────────────────────────────────────

describe('las claves del campus prestado son las del dueño', () => {
  it('lectura, escritura de links y la de suscripciones; un campus sin Stripe ni préstamo, ninguna de la cuenta', async () => {
    const env = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_' + 'test_DelPunteoEnv332';
    try {
      expect(await servicio.getStripeKey(US)).toBe(CLAVE_LECTURA);
      expect(await links.claveDeEscritura(NAVAL)).toBe(CLAVE_LINKS);
      expect(await claveDeStripe(US, { escritura: true })).toBe(CLAVE_LINKS);
      expect(await links.idDelWebhook(US)).toBe('we_prestado332');
      // Sin préstamo, como siempre (la del .env de reserva).
      expect(await links.claveDeEscritura(SOLO)).toBeNull();
      expect(await servicio.getStripeKey(SOLO)).toBe(process.env.STRIPE_SECRET_KEY);
    } finally {
      if (env === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = env;
    }
  });

  it('el webhook de la cuenta no se cambia desde el campus prestado', async () => {
    await expect(links.cambiarWebhook(US, 'activar')).rejects.toMatchObject({ code: 'STRIPE_PRESTADO' });
  });
});

// ─── 3. Crear el link desde el campus prestado ──────────────────────────────

let linkUS;
describe('un link desde el campus prestado', () => {
  it('se crea con la clave de links del dueño y lleva la marca del campus que vende', async () => {
    let n = 0;
    preparadas = [
      ['POST', '/v1/prices', 200, () => ({ id: `price_${MARCA}_${++n}` })],
      ['POST', '/v1/payment_links', 200, () => ({ id: `plink_${MARCA}_${n}`, url: `https://buy.stripe.com/test_${MARCA}_${n}` })],
    ];
    const r = await api.post('/api/links-pago').set(como(p.gestoraUS)).send({ projectId: US, productId: prod.US, importe: 800 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ project_id: US, product_id: prod.US });
    expect(llamadas.map((c) => `${c.metodo} ${c.ruta}`)).toEqual(['POST /v1/prices', 'POST /v1/payment_links']);
    for (const c of llamadas) expect(c.headers.Authorization).toBe(`Bearer ${CLAVE_LINKS}`);
    expect(llamadas[1].cuerpo).toMatchObject({
      'metadata[crm_project_id]': String(US),
      'metadata[crm_link_id]': String(r.body.data.id),
      'payment_intent_data[metadata][crm_project_id]': String(US),
    });
    linkUS = await one('SELECT * FROM payment_links WHERE id = $1', [r.body.data.id]);
  });
});

// ─── 4. El aviso, por la ruta del dueño ─────────────────────────────────────

describe('el aviso de Stripe llega por la ruta del dueño', { timeout: 60_000 }, () => {
  it('con la marca del campus prestado se procesa como él: su cargo, su venta, su link', async () => {
    expect(linkUS).toBeTruthy();
    const ch = cargoDe(800, { metadata: {
      crm_link_id: String(linkUS.id), crm_project_id: String(US), crm_user_id: String(p.gestoraUS.id), crm_entorno: 'local',
    } });
    const r = await servicio.handleWebhookEvent(DUENO, aviso(ch));
    expect(r).toMatchObject({ processed: 'charge.succeeded' });

    const filas = await filasDelCargo(ch.id);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ project_id: US, payment_link_id: linkUS.id, link_method: 'auto_link_pago' });
    const venta = await one('SELECT project_id, vendedora_id, producto_contratado_id FROM conversions WHERE id = $1', [filas[0].conversion_id]);
    expect(venta).toMatchObject({ project_id: US, vendedora_id: p.gestoraUS.id, producto_contratado_id: prod.US });
    expect((await one('SELECT estado FROM payment_links WHERE id = $1', [linkUS.id])).estado).toBe('pagado');

    // Otra vez el mismo aviso: nada se repite y sigue en un solo campus.
    await servicio.handleWebhookEvent(DUENO, aviso(ch));
    expect(await filasDelCargo(ch.id)).toHaveLength(1);
    expect(await q('SELECT id FROM conversion_payments WHERE conversion_id = $1', [filas[0].conversion_id])).toHaveLength(1);
  });

  it('sin marca, o con la de un campus que no la toma prestada, se queda en el dueño', async () => {
    const sinMarca = cargoDe(50);
    const deOtro = cargoDe(60, { metadata: { crm_project_id: String(SOLO) } });
    await servicio.handleWebhookEvent(DUENO, aviso(sinMarca));
    await servicio.handleWebhookEvent(DUENO, aviso(deOtro));
    expect((await filasDelCargo(sinMarca.id)).map((f) => f.project_id)).toEqual([DUENO]);
    expect((await filasDelCargo(deOtro.id)).map((f) => f.project_id)).toEqual([DUENO]);
  });

  it('una cuota de cobro automático sin marca va al campus de su cliente de Stripe', async () => {
    const lead = (await one('INSERT INTO leads (project_id, nombre, email, status) VALUES ($1, $2, $3, \'convertido\') RETURNING id',
      [NAVAL, `${MARCA} alumna naval`, `naval@${m}.test`])).id;
    const conv = (await one(
      `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
       VALUES ($1, $2, $3, 900, 0, CURRENT_DATE) RETURNING id`, [lead, NAVAL, `${MARCA} venta naval`])).id;
    await q(`INSERT INTO conversion_cobro_auto (conversion_id, project_id, stripe_customer_id)
             VALUES ($1, $2, $3)`, [conv, NAVAL, `cus_${MARCA}`]);
    const ch = cargoDe(300, { customer: `cus_${MARCA}` });
    expect(await prestado.campusDelEvento(DUENO, aviso(ch))).toBe(NAVAL);
  });
});

// ─── 5. La sincronización: una cuenta, cada cargo a un solo campus ──────────

describe('la sincronización de la cuenta', { timeout: 60_000 }, () => {
  it('cada cargo, a UN campus: el de su marca si la toma prestada; si no, el dueño', async () => {
    const deUS = cargoDe(120, { metadata: { crm_project_id: String(US) } });
    const deNaval = cargoDe(130, { metadata: { crm_project_id: String(NAVAL) } });
    const delDueno = cargoDe(140);
    // Ya estaba en el dueño sin asociar (entró antes de declarar el préstamo): pasa a Naval.
    const viejo = cargoDe(150, { metadata: { crm_project_id: String(NAVAL) } });
    await q(`INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, metadata, stripe_created_at)
             VALUES ($1, $2, 'charge', 'succeeded', 150, 'EUR', $3, NOW())`, [DUENO, viejo.id, JSON.stringify(viejo.metadata)]);
    preparadas = [['GET', '/v1/charges', 200, { data: [deUS, deNaval, delDueno, viejo], has_more: false }]];

    const r = await servicio.syncStripePayments(DUENO, { fullHistory: true });
    expect(r.imported).toBe(4);
    for (const c of llamadas) expect(c.headers.Authorization).toBe(`Bearer ${CLAVE_LECTURA}`);
    expect((await filasDelCargo(deUS.id)).map((f) => f.project_id)).toEqual([US]);
    expect((await filasDelCargo(deNaval.id)).map((f) => f.project_id)).toEqual([NAVAL]);
    expect((await filasDelCargo(delDueno.id)).map((f) => f.project_id)).toEqual([DUENO]);
    expect((await filasDelCargo(viejo.id)).map((f) => f.project_id)).toEqual([NAVAL]);

    // «Sincronizar» desde el campus prestado es sincronizar la del dueño: lo mismo, sin copias.
    llamadas.length = 0;
    await servicio.syncStripePayments(US, { fullHistory: true });
    expect(llamadas.length).toBeGreaterThan(0);
    for (const c of llamadas) expect(c.headers.Authorization).toBe(`Bearer ${CLAVE_LECTURA}`);
    for (const ch of [deUS, deNaval, delDueno, viejo]) expect(await filasDelCargo(ch.id)).toHaveLength(1);
    // Ningún cargo de la cuenta en el campus que no la toma prestada.
    expect(await q('SELECT id FROM stripe_payments WHERE project_id = $1', [SOLO])).toHaveLength(0);
    // Ni una vuelta propia para los prestados.
    const conVuelta = (await (await import('../src/modules/stripe-payments/stripe-payments.model.js')).listProjectsWithStripe()).map(Number);
    expect(conVuelta).toContain(DUENO);
    expect(conVuelta).not.toContain(US);
  });

  it('un cargo que el dueño ya tiene asociado se queda en el dueño (nunca en dos)', async () => {
    const ch = cargoDe(170, { metadata: { crm_project_id: String(US) } });
    const lead = (await one('INSERT INTO leads (project_id, nombre) VALUES ($1, $2) RETURNING id', [DUENO, `${MARCA} ficha dueño`])).id;
    await q(`INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, metadata, stripe_created_at, lead_id)
             VALUES ($1, $2, 'charge', 'succeeded', 170, 'EUR', $3, NOW(), $4)`, [DUENO, ch.id, JSON.stringify(ch.metadata), lead]);
    await servicio.handleWebhookEvent(DUENO, aviso(ch));
    expect((await filasDelCargo(ch.id)).map((f) => f.project_id)).toEqual([DUENO]);
  });
});

// ─── 6. La API ──────────────────────────────────────────────────────────────

describe('la API dice de quién es el Stripe', () => {
  it('GET /integrations/stripe y /stripe_links del prestado: stripe_prestado_de, sin claves del dueño', async () => {
    for (const provider of ['stripe', 'stripe_links']) {
      const r = await api.get(`/api/integrations/${provider}?projectId=${US}`).set(como(p.super));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data).toMatchObject({ project_id: US, provider, has_secret: false, secret_preview: null,
        stripe_prestado_de: { id: DUENO, nombre: `${MARCA} ictess` } });
    }
    const delDueno = await api.get(`/api/integrations/stripe?projectId=${DUENO}`).set(como(p.super));
    expect(delDueno.body.data).toMatchObject({ has_secret: true, stripe_prestado_de: null });
    const sinNada = await api.get(`/api/integrations/stripe?projectId=${SOLO}`).set(como(p.super));
    expect(sinNada.body.data).toBeNull();
  });

  it('no se le puede poner una clave propia mientras use la del dueño', async () => {
    const r = await api.put('/api/integrations').set(como(p.super))
      .send({ projectId: US, provider: 'stripe_links', active: true, api_key: 'rk_' + 'test_PropiaNoVale332' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('STRIPE_PRESTADO');
  });

  it('links de pago: la configuración lo dice y el aviso «conectar Stripe» no sale', async () => {
    const r = await api.get(`/api/links-pago/config?projectId=${US}`).set(como(p.gestoraUS));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.stripe_prestado_de).toEqual({ id: DUENO, nombre: `${MARCA} ictess` });
    expect(r.body.data.aviso_clave).toBeNull();
  });

  it('la salud: «Usa el Stripe de …» con el estado de la cuenta del dueño', () => {
    const filas = conStripePrestado([
      { id: DUENO, casillas: { stripe: { estado: 'caida', resumen: 'La sincronización de cobros falla' } }, peor: 'caida' },
      { id: US, casillas: { stripe: { estado: 'sin_configurar', resumen: 'Sin clave de Stripe' } }, peor: 'bien',
        stripe_prestado_de: { id: DUENO, nombre: 'ICTESS' } },
      { id: NAVAL, casillas: { stripe: { estado: 'sin_configurar', resumen: 'Sin clave de Stripe' } }, peor: 'bien',
        stripe_prestado_de: { id: 999999, nombre: 'Fuera de la lista' } },
    ]);
    expect(filas[1].casillas.stripe).toMatchObject({ estado: 'caida', resumen: 'Usa el Stripe de ICTESS' });
    expect(filas[1].peor).toBe('caida');
    expect(filas[2].casillas.stripe).toMatchObject({ estado: 'bien', resumen: 'Usa el Stripe de Fuera de la lista' });
  });
});
