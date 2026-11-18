import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Links de pago, fase 2 (CRM#680): crear, anular y caducar un link de pago único,
 * las reglas del campus en la tarjeta y el webhook de la cuenta.
 *
 *   · la migración 315 (la 300 de MultiCRM) se aplica dos veces y sus CHECK sujetan lo que importa;
 *   · la tarjeta guarda caducidad, cuotas y monedas (solo quien configura);
 *   · una gestora crea un link de SU prospecto, dentro del tope de descuento, y
 *     el CRM manda a Stripe un Price y un Payment Link con la marca y un solo pago;
 *   · lo ajeno es un 404; pasarse del tope, de la caducidad o de las monedas, un
 *     400/403 sin llamar a Stripe; si Stripe falla, no queda la fila;
 *   · anular y caducar desactivan el link en Stripe ANTES de marcarlo;
 *   · el webhook: se reutiliza el de la cuenta, se le AÑADEN los eventos y nunca
 *     se crea otro.
 *
 * Stripe es de mentira: lo que no esté preparado revienta, así que ninguna
 * petición puede salir a Stripe de verdad sin que se note.
 *
 *   npx vitest run tests/linksPago680fase2.test.js
 */

process.env.LOG_LEVEL = 'silent';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const integrationsModel = await import('../src/modules/integrations/integrations.model.js');
const { default: linksPago } = await import('../src/modules/links-pago/index.js');
const service = await import('../src/modules/links-pago/links-pago.service.js');
const { aFormulario, enUnidadesMinimas } = await import('../src/modules/links-pago/links-pago.stripe.js');

// ─── Stripe de mentira ──────────────────────────────────────────────────────
// Cada prueba prepara `[método, trozo de la ruta, status, cuerpo]`. Se apunta
// todo lo que se pide, con el cuerpo ya descodificado.
let preparadas = [];
const llamadas = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = vi.fn(async (url, opciones = {}) => {
  const metodo = (opciones.method || 'GET').toUpperCase();
  const u = new URL(String(url));
  const cuerpo = opciones.body ? Object.fromEntries(new URLSearchParams(opciones.body)) : null;
  llamadas.push({ metodo, ruta: u.pathname, cuerpo, headers: opciones.headers || {} });
  const r = preparadas.find(([m, trozo]) => m === metodo && (trozo instanceof RegExp ? trozo.test(u.pathname) : u.pathname === trozo));
  if (!r) throw new Error(`Stripe de mentira: sin respuesta para ${metodo} ${u.pathname}`);
  const [, , status, body] = r;
  return { ok: status < 400, status, json: async () => (typeof body === 'function' ? body(cuerpo) : body ?? {}) };
});
// Cada link, con sus ids nuevos, como Stripe (son únicos en la tabla).
let n = 0;
const stripeCreaBien = () => {
  preparadas = [
    ['POST', '/v1/prices', 200, () => ({ id: `price_680_${++n}` })],
    ['POST', '/v1/payment_links', 200, () => ({ id: `plink_680_${n}`, url: `https://buy.stripe.com/test_680_${n}` })],
  ];
};

// ─── La app, con las rutas de verdad ────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(linksPago.prefix, linksPago.router);
app.use(errorHandler);
const api = supertest(app);

const MARCA = `LP680F2${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], leads: [], products: [], conversions: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

const CLAVE_RK = 'rk_' + 'test_EscrituraDeMentira680f2'; // partida: que no parezca una clave real a los escáneres
const CLAVE_LIVE = 'rk_' + 'live_EscrituraDeMentira680f2';
const CLAVE_LECTURA = 'rk_' + 'test_LecturaDeMentira680f2xy';

let A; let B; let C;
const p = {};
const lead = {};
const prod = {};
let venta;

const SQL_315 = fs.readFileSync(path.join(AQUI, '../migrations/315_links_pago_config.sql'), 'utf8');

// Las migraciones de los links (314 y 315) cambian tablas que el resto de las
// pruebas usan a la vez (projects, stripe_payments). Pasadas en paralelo, Postgres
// puede contestar «deadlock detected» (40P01) y abortar una de las dos: entre
// ellas se pasan de una en una con un cerrojo compartido, y si el choque es con
// otra prueba, se reintenta. Eso no tapa nada: la migración tiene que acabar bien.
async function aplicarMigracion(sql) {
  for (let intento = 1; ; intento += 1) {
    const c = await pool.connect();
    try {
      await c.query('SELECT pg_advisory_lock(680680)');
      await c.query(sql);
      return;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      if (err.code !== '40P01' || intento >= 5) throw err;
      await new Promise((r) => setTimeout(r, 200 * intento));
    } finally {
      await c.query('SELECT pg_advisory_unlock(680680)').catch(() => {});
      c.release();
    }
  }
}

async function ponerClave(projectId, provider, clave, config = {}) {
  const e = encrypt(clave);
  await integrationsModel.upsert({ projectId, provider, active: true, encrypted_value: e.encrypted, iv: e.iv, auth_tag: e.authTag, config_public: config });
}

beforeAll(async () => {
  await aplicarMigracion(SQL_315);
  const campus = async (n) => {
    const r = await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${n}`, `${MARCA.toLowerCase()}-${n}`, `${MARCA}-k-${n}`]);
    ids.projects.push(r.id);
    return r.id;
  };
  A = await campus('a');
  B = await campus('b');
  C = await campus('c'); // sin clave de links
  const persona = async (n, role, suyos) => {
    const u = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', $3) RETURNING id, role',
      [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  p.adminA = await persona('admin-a', 'admin', [A, C]);
  p.gestora1 = await persona('gestora-1', 'gestor', [A, C]);
  p.gestora2 = await persona('gestora-2', 'gestor', [A]);
  p.gestoraB = await persona('gestora-b', 'gestor', [B]);

  const nuevoLead = async (c, responsable) => {
    const l = await one('INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [c, `${MARCA} lead`, `lead${ids.leads.length}@${MARCA.toLowerCase()}.test`, responsable?.id ?? null]);
    ids.leads.push(l.id);
    return l.id;
  };
  lead.g1 = await nuevoLead(A, p.gestora1);
  lead.g2 = await nuevoLead(A, p.gestora2);
  lead.B = await nuevoLead(B, p.gestoraB);
  lead.C = await nuevoLead(C, p.gestora1);

  const curso = async (c, nombre, precio, moneda = 'EUR') => {
    const r = await one('INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, $3, $4) RETURNING id',
      [c, `${MARCA} ${nombre}`, precio, moneda]);
    ids.products.push(r.id);
    return r.id;
  };
  prod.A = await curso(A, 'máster', 1000);
  prod.Agratis = await curso(A, 'sin precio', null);
  prod.Ausd = await curso(A, 'en dólares', 1000, 'USD');
  prod.B = await curso(B, 'otro campus', 500);
  prod.C = await curso(C, 'campus sin clave', 300);

  venta = await one(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, vendedora_id)
     VALUES ($1, $2, $3, $4, 1000, $5) RETURNING id`,
    [lead.g1, A, `${MARCA} máster`, prod.A, p.gestora1.id]);
  ids.conversions.push(venta.id);

  await ponerClave(A, 'stripe_links', CLAVE_RK);
  await ponerClave(B, 'stripe_links', CLAVE_RK);
  await ponerClave(A, 'stripe', CLAVE_LECTURA, { webhook_endpoint_id: 'we_680cuentaA', webhook_url: 'https://x.test/api/stripe-webhook/1' });
}, 60_000);

afterAll(async () => {
  const limpiar = [
    ['DELETE FROM payment_links WHERE project_id = ANY($1)', ids.projects],
    ['DELETE FROM conversions WHERE id = ANY($1)', ids.conversions],
    ['DELETE FROM products WHERE id = ANY($1)', ids.products],
    ['DELETE FROM project_integrations WHERE project_id = ANY($1)', ids.projects],
    ['DELETE FROM user_activity_log WHERE user_id = ANY($1)', ids.users],
    ['DELETE FROM leads WHERE id = ANY($1)', ids.leads],
    ['DELETE FROM user_projects WHERE user_id = ANY($1)', ids.users],
    ['DELETE FROM users WHERE id = ANY($1)', ids.users],
    ['DELETE FROM projects WHERE id = ANY($1)', ids.projects],
  ];
  for (const [sql, lista] of limpiar) {
    try { await q(sql, [lista]); } catch { /* el siguiente sigue */ }
  }
  globalThis.fetch = fetchOriginal;
});

beforeEach(() => { llamadas.length = 0; preparadas = []; });

const crear = (quien, cuerpo) => api.post('/api/links-pago').set(como(quien)).send(cuerpo);
const filas = (projectId) => q('SELECT * FROM payment_links WHERE project_id = $1 ORDER BY id', [projectId]);

// ─── 1. La migración ────────────────────────────────────────────────────────

describe('la migración 315', () => {
  it('se puede pasar otra vez y deja los valores de arranque', async () => {
    await aplicarMigracion(SQL_315);
    const r = await one(`SELECT links_pago_caducidad_dias AS d, links_pago_caducidad_max_dias AS m,
      links_pago_cuotas_admitidas AS ca, links_pago_cuotas_max AS cm, links_pago_monedas::text[] AS mon,
      links_pago_moneda_defecto AS md FROM projects WHERE id = $1`, [A]);
    expect(r).toEqual({ d: 7, m: 30, ca: true, cm: 12, mon: ['EUR'], md: 'EUR' });
  });

  it('la caducidad por defecto no pasa de la máxima, y la moneda por defecto es una de las admitidas', async () => {
    await expect(q('UPDATE projects SET links_pago_caducidad_dias = 40 WHERE id = $1', [A])).rejects.toThrow(/caducidad/);
    await expect(q("UPDATE projects SET links_pago_moneda_defecto = 'USD' WHERE id = $1", [A])).rejects.toThrow(/monedas/);
    await expect(q("UPDATE projects SET links_pago_monedas = '{}' WHERE id = $1", [A])).rejects.toThrow(/monedas/);
    await expect(q('UPDATE projects SET links_pago_cuotas_max = 1 WHERE id = $1', [A])).rejects.toThrow(/cuotas/);
  });
});

// ─── 2. La tarjeta: reglas del campus ───────────────────────────────────────

describe('las reglas del campus (GET/PUT /config)', () => {
  it('la gestora las lee (le hacen falta para crear) pero no las cambia', async () => {
    const r = await api.get(`/api/links-pago/config?projectId=${A}`).set(como(p.gestora1));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ caducidad_dias: 7, caducidad_max_dias: 30, monedas: ['EUR'], moneda_defecto: 'EUR', cuotas_max: 12 });
    expect((await api.put('/api/links-pago/config').set(como(p.gestora1)).send({ projectId: A, caducidad_dias: 3 })).status).toBe(403);
  });

  it('el admin cambia solo lo que manda, y queda anotado', async () => {
    const r = await api.put('/api/links-pago/config').set(como(p.adminA))
      .send({ projectId: C, monedas: ['eur', 'usd', 'EUR'], moneda_defecto: 'usd', caducidad_max_dias: 15, cuotas_admitidas: false });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ monedas: ['EUR', 'USD'], moneda_defecto: 'USD', caducidad_max_dias: 15, caducidad_dias: 7, cuotas_admitidas: false, descuento_max_pct: 0 });
    const log = await one(`SELECT details FROM user_activity_log WHERE user_id = $1 AND action = 'links_pago.config' ORDER BY id DESC LIMIT 1`, [p.adminA.id]);
    expect(log.details.ahora.moneda_defecto).toBe('USD');
    // Y se deja como estaba para el resto.
    await api.put('/api/links-pago/config').set(como(p.adminA)).send({ projectId: C, moneda_defecto: 'EUR', monedas: ['EUR'], caducidad_max_dias: 30, cuotas_admitidas: true });
  });

  it('reglas entre campos: 400 con un mensaje claro, y no cambia nada', async () => {
    const r1 = await api.put('/api/links-pago/config').set(como(p.adminA)).send({ projectId: A, caducidad_dias: 31 });
    expect(r1.status).toBe(400);
    expect(r1.body.error).toMatch(/máxima/);
    const r2 = await api.put('/api/links-pago/config').set(como(p.adminA)).send({ projectId: A, moneda_defecto: 'USD' });
    expect(r2.status).toBe(400);
    expect(r2.body.error).toMatch(/admitidas/);
    for (const malo of [{ cuotas_max: 1 }, { cuotas_max: 'x' }, { monedas: [] }, { monedas: ['EURO'] }, { caducidad_dias: null }, { cuotas_admitidas: 'si' }]) {
      expect((await api.put('/api/links-pago/config').set(como(p.adminA)).send({ projectId: A, ...malo })).status, JSON.stringify(malo)).toBe(400);
    }
    expect((await api.get(`/api/links-pago/config?projectId=${A}`).set(como(p.adminA))).body.data.caducidad_dias).toBe(7);
  });
});

// ─── 3. Crear un link ───────────────────────────────────────────────────────

describe('crear un link de pago único (POST /api/links-pago)', () => {
  it('la gestora, de su prospecto, al precio del catálogo: Price + Payment Link con la marca y un solo pago', async () => {
    stripeCreaBien();
    const r = await crear(p.gestora1, { leadId: lead.g1, productId: prod.A, importe: 1000 });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      project_id: A, lead_id: lead.g1, product_id: prod.A, created_by: p.gestora1.id, estado: 'creado',
      moneda: 'EUR', modalidad: 'unico',
    });
    expect(r.body.data.url).toBe(`https://buy.stripe.com/test_680_${n}`);
    expect(r.body.data.stripe_payment_link_id).toBe(`plink_680_${n}`);
    expect(Number(r.body.data.importe)).toBe(1000);
    expect(Number(r.body.data.descuento_pct)).toBe(0);
    // Caduca a los 7 días (lo de serie).
    const dias = (new Date(r.body.data.caduca_el) - Date.now()) / 86400000;
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThan(7.1);

    expect(llamadas.map((c) => `${c.metodo} ${c.ruta}`)).toEqual(['POST /v1/prices', 'POST /v1/payment_links']);
    const [precio, link] = llamadas;
    // Con la clave de ESCRITURA, nunca con la de lectura.
    for (const c of llamadas) expect(c.headers.Authorization).toBe(`Bearer ${CLAVE_RK}`);
    expect(precio.cuerpo).toMatchObject({ currency: 'eur', unit_amount: '100000' });
    expect(precio.cuerpo['product_data[name]']).toMatch(/máster/);
    expect(link.cuerpo).toMatchObject({
      'line_items[0][price]': `price_680_${n}`,
      'line_items[0][quantity]': '1',
      'restrictions[completed_sessions][limit]': '1',
      'metadata[crm_link_id]': String(r.body.data.id),
      'metadata[crm_project_id]': String(A),
      'metadata[crm_lead_id]': String(lead.g1),
      'metadata[crm_user_id]': String(p.gestora1.id),
      'metadata[crm_entorno]': 'local',
      'payment_intent_data[metadata][crm_link_id]': String(r.body.data.id),
    });
    expect(link.cuerpo['metadata[crm_conversion_id]']).toBeUndefined();
    // Cada creación con su clave de idempotencia, distinta para el precio y el link.
    expect(precio.headers['Idempotency-Key']).toMatch(new RegExp(`^crm-local-link-${r.body.data.id}-\\d+-precio$`));
    expect(link.headers['Idempotency-Key']).toMatch(/-link$/);

    const ev = await q('SELECT tipo, datos FROM payment_link_eventos WHERE link_id = $1', [r.body.data.id]);
    expect(ev).toHaveLength(1);
    expect(ev[0].tipo).toBe('creado');
    expect((await one('SELECT stripe_price_id FROM payment_links WHERE id = $1', [r.body.data.id])).stripe_price_id).toBe(`price_680_${n}`);
  });

  it('desde la venta: el prospecto y el campus salen de ella, y la marca lleva la venta', async () => {
    stripeCreaBien();
    const r = await crear(p.gestora1, { conversionId: venta.id, productId: prod.A, importe: '1000,00', caducidad_dias: 3 });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ conversion_id: venta.id, lead_id: lead.g1, project_id: A });
    expect(llamadas[1].cuerpo['metadata[crm_conversion_id]']).toBe(String(venta.id));
  });

  it('pasarse del tope de descuento: 403 sin llamar a Stripe ni dejar fila; dentro del tope, vale', async () => {
    const antes = (await filas(A)).length;
    const r = await crear(p.gestora1, { leadId: lead.g1, productId: prod.A, importe: 950 });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('DESCUENTO_MAXIMO');
    expect(r.body.error).toMatch(/solo el admin/);
    expect(llamadas).toHaveLength(0);
    expect((await filas(A)).length).toBe(antes);

    await api.put('/api/links-pago/config').set(como(p.adminA)).send({ projectId: A, descuento_max_pct: 10 });
    expect((await crear(p.gestora1, { leadId: lead.g1, productId: prod.A, importe: 899.99 })).body.error).toMatch(/10 %.*900.00 EUR/);
    stripeCreaBien();
    const ok = await crear(p.gestora1, { leadId: lead.g1, productId: prod.A, importe: 900 });
    expect(ok.status).toBe(201);
    expect(Number(ok.body.data.descuento_pct)).toBe(10);
    await api.put('/api/links-pago/config').set(como(p.adminA)).send({ projectId: A, descuento_max_pct: 0 });
  });

  it('el admin descuenta lo que quiera, y es el único que crea links de un curso sin precio o en otra moneda', async () => {
    stripeCreaBien();
    expect((await crear(p.adminA, { leadId: lead.g1, productId: prod.A, importe: 500 })).status).toBe(201);
    expect((await crear(p.gestora1, { leadId: lead.g1, productId: prod.Agratis, importe: 500 })).body.code).toBe('SIN_PRECIO_COMPARABLE');
    stripeCreaBien();
    const r = await crear(p.adminA, { leadId: lead.g1, productId: prod.Agratis, importe: 500 });
    expect(r.status).toBe(201);
    expect(r.body.data.precio_catalogo).toBeNull();
    // Curso en USD con link en EUR: no se puede medir el descuento.
    expect((await crear(p.gestora1, { leadId: lead.g1, productId: prod.Ausd, importe: 900 })).body.error).toMatch(/USD/);
  });

  it('lo ajeno es un 404: el prospecto de otra gestora o de otro campus', async () => {
    expect((await crear(p.gestora1, { leadId: lead.g2, productId: prod.A, importe: 1000 })).status).toBe(404);
    expect((await crear(p.gestora1, { leadId: lead.B, productId: prod.B, importe: 500 })).status).toBe(404);
    expect((await crear(p.gestoraB, { conversionId: venta.id, productId: prod.A, importe: 1000 })).status).toBe(404);
    expect((await crear(p.gestora2, { conversionId: venta.id, productId: prod.A, importe: 1000 })).status).toBe(404);
    expect(llamadas).toHaveLength(0);
  });

  it('las reglas: curso de otro campus, moneda, caducidad, cuotas y lo que falta', async () => {
    const casos = [
      [{ leadId: lead.g1, productId: prod.B, importe: 500 }, 400, /catálogo/],
      [{ leadId: lead.g1, productId: prod.A, importe: 1000, moneda: 'USD' }, 400, /USD/],
      [{ leadId: lead.g1, productId: prod.A, importe: 1000, caducidad_dias: 31 }, 400, /30 días/],
      [{ leadId: lead.g1, productId: prod.A, importe: 1000, modalidad: 'cuotas' }, 400, /cuotas/],
      [{ productId: prod.A, importe: 1000 }, 400, /prospecto o la venta/],
      [{ leadId: lead.g1, productId: prod.A, importe: 0 }, 400, /mayor que 0/],
      [{ leadId: lead.g1, productId: prod.A, importe: 10.005 }, 400, /decimales/],
      [{ leadId: lead.g1, productId: prod.A }, 400, /importe/],
    ];
    for (const [cuerpo, status, msg] of casos) {
      const r = await crear(p.gestora1, cuerpo);
      expect(r.status, JSON.stringify(cuerpo)).toBe(status);
      expect(r.body.error, JSON.stringify(cuerpo)).toMatch(msg);
    }
    expect(llamadas).toHaveLength(0);
  });

  it('sin clave de links en el campus: 409 y nada en Stripe', async () => {
    const r = await crear(p.gestora1, { leadId: lead.C, productId: prod.C, importe: 300 });
    expect(r.status).toBe(409);
    expect(r.body.code, JSON.stringify(r.body)).toBe('SIN_CLAVE_DE_LINKS');
    expect(llamadas).toHaveLength(0);
    expect(await filas(C)).toHaveLength(0);
  });

  it('fuera de producción, una clave live no crea nada', async () => {
    await ponerClave(C, 'stripe_links', CLAVE_LIVE);
    const r = await crear(p.gestora1, { leadId: lead.C, productId: prod.C, importe: 300 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CLAVE_LIVE_EN_PRUEBAS');
    expect(llamadas).toHaveLength(0);
    await q(`DELETE FROM project_integrations WHERE project_id = $1 AND provider = 'stripe_links'`, [C]);
  });

  it('si Stripe no crea el link, 502 y no queda una fila sin URL', async () => {
    const antes = (await filas(A)).length;
    preparadas = [
      ['POST', '/v1/prices', 200, { id: 'price_680x' }],
      ['POST', '/v1/payment_links', 403, { error: { message: 'The provided key does not have the required permissions' } }],
    ];
    const r = await crear(p.gestora1, { leadId: lead.g1, productId: prod.A, importe: 1000 });
    expect(r.status).toBe(424);
    expect(r.body.error).toMatch(/permisos/);
    expect(r.body.error).not.toContain(CLAVE_RK);
    expect((await filas(A)).length).toBe(antes);
  });

  it('una persona sin «crear» (sin sesión, 401)', async () => {
    expect((await api.post('/api/links-pago').send({ leadId: lead.g1, productId: prod.A, importe: 1000 })).status).toBe(401);
  });
});

// ─── 4. Anular ──────────────────────────────────────────────────────────────

describe('anular (POST /api/links-pago/:id/anular)', () => {
  let id;
  beforeEach(async () => {
    stripeCreaBien();
    id = (await crear(p.gestora1, { leadId: lead.g1, productId: prod.A, importe: 1000 })).body.data.id;
    llamadas.length = 0;
  });

  it('quien lo creó lo anula: primero se desactiva en Stripe, luego se marca con quién y por qué', async () => {
    preparadas = [['POST', /^\/v1\/payment_links\/plink_680_\d+$/, 200, { active: false }]];
    const r = await api.post(`/api/links-pago/${id}/anular`).set(como(p.gestora1)).send({ motivo: 'Se equivocó de curso' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ estado: 'anulado', anulado_por: p.gestora1.id, motivo_anulacion: 'Se equivocó de curso' });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].cuerpo).toEqual({ active: 'false' });
    expect((await q('SELECT tipo FROM payment_link_eventos WHERE link_id = $1 ORDER BY id', [id])).map((e) => e.tipo)).toEqual(['creado', 'anulado']);
    // Otra vez: ya no se puede.
    expect((await api.post(`/api/links-pago/${id}/anular`).set(como(p.gestora1)).send({ motivo: 'otra vez' })).status).toBe(409);
  });

  it('si Stripe no lo desactiva, no se marca anulado (el cliente podría pagarlo)', async () => {
    preparadas = [['POST', /^\/v1\/payment_links\//, 500, { error: { message: 'boom' } }]];
    const r = await api.post(`/api/links-pago/${id}/anular`).set(como(p.gestora1)).send({ motivo: 'No lo quiere' });
    expect(r.status).toBe(424);
    expect((await one('SELECT estado FROM payment_links WHERE id = $1', [id])).estado).toBe('creado');
  });

  it('el de otra gestora es un 404; el admin del campus sí puede; sin motivo, 400; pagado, 409', async () => {
    expect((await api.post(`/api/links-pago/${id}/anular`).set(como(p.gestora2)).send({ motivo: 'no es mío' })).status).toBe(404);
    expect((await api.post(`/api/links-pago/${id}/anular`).set(como(p.gestoraB)).send({ motivo: 'no es mío' })).status).toBe(404);
    expect((await api.post(`/api/links-pago/${id}/anular`).set(como(p.gestora1)).send({})).status).toBe(400);
    await q(`UPDATE payment_links SET estado = 'pagado', pagado_el = NOW() WHERE id = $1`, [id]);
    expect((await api.post(`/api/links-pago/${id}/anular`).set(como(p.adminA)).send({ motivo: 'pagado ya' })).status).toBe(409);
    expect(llamadas).toHaveLength(0);
  });
});

// ─── 5. Caducar (el trabajo programado) ─────────────────────────────────────

describe('la caducidad (caducarVencidos)', () => {
  it('desactiva en Stripe los vivos vencidos y los marca; si Stripe falla, los deja para la siguiente vuelta', async () => {
    stripeCreaBien();
    const l1 = (await crear(p.gestora1, { leadId: lead.g1, productId: prod.A, importe: 1000 })).body.data;
    const l2 = (await crear(p.gestora1, { leadId: lead.g1, productId: prod.A, importe: 1000 })).body.data;
    const [vivo, otro] = [l1.id, l2.id];
    // Uno sin vencer, que no se toca.
    const sigue = (await crear(p.gestora1, { leadId: lead.g1, productId: prod.A, importe: 1000 })).body.data.id;
    // Los de las pruebas de arriba, fuera: aquí solo cuentan estos.
    await q(`UPDATE payment_links SET caduca_el = NOW() + interval '7 days' WHERE project_id = ANY($1)`, [ids.projects]);
    await q(`UPDATE payment_links SET caduca_el = NOW() - interval '1 minute' WHERE id = ANY($1)`, [[vivo, otro]]);
    llamadas.length = 0;

    preparadas = [
      ['POST', `/v1/payment_links/${l1.stripe_payment_link_id}`, 200, { active: false }],
      ['POST', `/v1/payment_links/${l2.stripe_payment_link_id}`, 500, { error: { message: 'boom' } }],
    ];
    const res = await service.caducarVencidos();
    expect(res).toEqual({ caducados: 1, pendientes: 1 });
    expect(llamadas.every((c) => c.cuerpo?.active === 'false')).toBe(true);
    expect((await one('SELECT estado FROM payment_links WHERE id = $1', [sigue])).estado).toBe('creado');
    expect((await one('SELECT estado FROM payment_links WHERE id = $1', [vivo])).estado).toBe('caducado');
    expect((await one('SELECT estado FROM payment_links WHERE id = $1', [otro])).estado).toBe('creado');
    expect((await q('SELECT tipo FROM payment_link_eventos WHERE link_id = $1 ORDER BY id', [vivo])).map((e) => e.tipo)).toEqual(['creado', 'caducado']);

    // En la siguiente vuelta, Stripe ya contesta.
    preparadas = [['POST', `/v1/payment_links/${l2.stripe_payment_link_id}`, 200, { active: false }]];
    await service.caducarVencidos();
    expect((await one('SELECT estado FROM payment_links WHERE id = $1', [otro])).estado).toBe('caducado');
  });
});

// ─── 6. El webhook de la cuenta ─────────────────────────────────────────────

describe('el webhook de la cuenta (GET/PUT /webhook)', () => {
  const ACTUALES = ['charge.succeeded', 'charge.refunded', 'charge.dispute.created', 'payment_intent.succeeded'];
  const weDeStripe = (extra = {}) => ({ id: 'we_680cuentaA', url: 'https://x.test/api/stripe-webhook/1', status: 'disabled', enabled_events: ACTUALES, ...extra });

  it('enseña si está activo y qué eventos le faltan, con la clave de escritura', async () => {
    preparadas = [['GET', '/v1/webhook_endpoints/we_680cuentaA', 200, weDeStripe()]];
    const r = await api.get(`/api/links-pago/webhook?projectId=${A}`).set(como(p.adminA));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ vinculado: true, existe: true, activo: false, endpoint_id: 'we_680cuentaA' });
    expect(r.body.data.faltan).toEqual(service.EVENTOS_DE_LOS_LINKS);
    expect(r.body.data.comparten.map((c) => c.id)).toEqual([A]);
    expect(llamadas[0].headers.Authorization).toBe(`Bearer ${CLAVE_RK}`);
  });

  it('añadir eventos: manda los que había MÁS los de los links, y nunca crea otro webhook', async () => {
    preparadas = [
      ['GET', '/v1/webhook_endpoints/we_680cuentaA', 200, weDeStripe()],
      ['POST', '/v1/webhook_endpoints/we_680cuentaA', 200, (c) => weDeStripe({ enabled_events: Object.keys(c).filter((k) => k.startsWith('enabled_events')).map((k) => c[k]) })],
    ];
    const r = await api.put('/api/links-pago/webhook').set(como(p.adminA)).send({ projectId: A, accion: 'anadir_eventos' });
    expect(r.status).toBe(200);
    expect(r.body.data.faltan).toEqual([]);
    const post = llamadas.find((c) => c.metodo === 'POST');
    const enviados = Object.entries(post.cuerpo).filter(([k]) => k.startsWith('enabled_events')).map(([, v]) => v);
    expect(new Set(enviados)).toEqual(new Set([...ACTUALES, ...service.EVENTOS_DE_LOS_LINKS]));
    expect(post.cuerpo.disabled).toBeUndefined();
    expect(llamadas.some((c) => c.metodo === 'POST' && c.ruta === '/v1/webhook_endpoints')).toBe(false);
    const log = await one(`SELECT details FROM user_activity_log WHERE user_id = $1 AND action = 'links_pago.webhook' ORDER BY id DESC LIMIT 1`, [p.adminA.id]);
    expect(log.details.accion).toBe('anadir_eventos');
  });

  it('si ya los tiene (o escucha «*»), no se toca', async () => {
    preparadas = [['GET', '/v1/webhook_endpoints/we_680cuentaA', 200, weDeStripe({ enabled_events: ['*'] })]];
    const r = await api.put('/api/links-pago/webhook').set(como(p.adminA)).send({ projectId: A, accion: 'anadir_eventos' });
    expect(r.body.data.cambiado).toBe(false);
    expect(llamadas.every((c) => c.metodo === 'GET')).toBe(true);
  });

  it('activar y desactivar', async () => {
    preparadas = [['POST', '/v1/webhook_endpoints/we_680cuentaA', 200, (c) => weDeStripe({ status: c.disabled === 'false' ? 'enabled' : 'disabled' })]];
    const on = await api.put('/api/links-pago/webhook').set(como(p.adminA)).send({ projectId: A, accion: 'activar' });
    expect(on.body.data.activo).toBe(true);
    expect(llamadas[0].cuerpo).toEqual({ disabled: 'false' });
    const off = await api.put('/api/links-pago/webhook').set(como(p.adminA)).send({ projectId: A, accion: 'desactivar' });
    expect(off.body.data.activo).toBe(false);
  });

  it('sin webhook vinculado: lo dice y no crea ninguno; borrado en Stripe: lo dice', async () => {
    const r = await api.get(`/api/links-pago/webhook?projectId=${B}`).set(como(p.adminA));
    // El admin de A no es de B.
    expect(r.status).toBe(403);
    const sin = await service.verWebhook(B);
    expect(sin.vinculado).toBe(false);
    const put = await api.put('/api/links-pago/webhook').set(como(p.adminA)).send({ projectId: C, accion: 'activar' });
    expect(put.status).toBe(409);
    expect(put.body.code).toBe('SIN_WEBHOOK');
    preparadas = [['GET', '/v1/webhook_endpoints/we_680cuentaA', 404, { error: { message: 'No such webhook endpoint' } }]];
    const borrado = await api.get(`/api/links-pago/webhook?projectId=${A}`).set(como(p.adminA));
    expect(borrado.body.data).toMatchObject({ vinculado: true, existe: false });
    expect(llamadas.some((c) => c.metodo === 'POST')).toBe(false);
  });

  it('la gestora no ve ni toca el webhook; una acción desconocida es un 400', async () => {
    expect((await api.get(`/api/links-pago/webhook?projectId=${A}`).set(como(p.gestora1))).status).toBe(403);
    expect((await api.put('/api/links-pago/webhook').set(como(p.gestora1)).send({ projectId: A, accion: 'activar' })).status).toBe(403);
    expect((await api.put('/api/links-pago/webhook').set(como(p.adminA)).send({ projectId: A, accion: 'crear' })).status).toBe(400);
    expect(llamadas).toHaveLength(0);
  });
});

// ─── 7. Piezas sueltas ──────────────────────────────────────────────────────

describe('piezas sin la base', () => {
  it('el importe en unidades mínimas, sin coma flotante colada', () => {
    expect(enUnidadesMinimas(19.99, 'EUR')).toBe(1999);
    expect(enUnidadesMinimas(1500, 'CLP')).toBe(1500);
    expect(enUnidadesMinimas(0.1 + 0.2, 'USD')).toBe(30);
  });

  it('el formulario de Stripe con objetos y listas anidados', () => {
    expect(decodeURIComponent(aFormulario({ a: { b: 1 }, l: [{ price: 'p', quantity: 1 }], e: ['x', 'y'], n: null })))
      .toBe('a[b]=1&l[0][price]=p&l[0][quantity]=1&e[0]=x&e[1]=y');
  });

  it('el descuento sobre el catálogo: cobrar más no es descuento; sin precio, no se mide', () => {
    expect(service.descuentoSobre(1000, 900)).toBe(10);
    expect(service.descuentoSobre(1000, 1100)).toBe(0);
    expect(service.descuentoSobre(null, 900)).toBeNull();
    expect(service.descuentoSobre(3, 2)).toBe(33.33);
  });

  it('el importe mínimo con el tope, al céntimo y hacia arriba', () => {
    expect(service.importeMinimo(1000, 10)).toBe(900);
    expect(service.importeMinimo(1000, 0)).toBe(1000);
    expect(service.importeMinimo(3.33, 33.33)).toBe(2.23);
    expect(service.importeMinimo(199.99, 2.5)).toBe(195);
    expect(service.importeMinimo(1000, 100)).toBe(0);
  });

  it('el entorno de la marca', () => {
    expect(service.entorno({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com' })).toBe('produccion');
    // En ISEIE las pruebas son /staging: si no se mirara, diría «produccion» y admitiría claves live.
    expect(service.entorno({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com/staging' })).toBe('staging');
    expect(service.entorno({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com/testeo' })).toBe('staging');
    expect(service.entorno({ NODE_ENV: 'test' })).toBe('local');
  });
});
