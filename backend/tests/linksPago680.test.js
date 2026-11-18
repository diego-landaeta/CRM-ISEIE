import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Links de pago, fase 1 (CRM#680): tablas, permisos y la clave de escritura.
 *
 *   · la migración 314 (la 250 de MultiCRM) se aplica y se puede pasar otra vez;
 *   · cada rol trae de serie lo que dice la propuesta, y nada más;
 *   · una gestora ve solo sus links; el admin, los de sus campus; tutor y
 *     colaborador, un 403;
 *   · la clave de escritura (`stripe_links`) se guarda cifrada, aparte de la de
 *     lectura, y lo cifrado no vuelve nunca al navegador;
 *   · «Probar conexión» con una clave buena, una mala y una restringida a la que
 *     le falta algo. Stripe es de mentira: no sale ninguna petición de verdad, y
 *     se comprueba que todas son GET de un solo elemento (no se crea nada).
 *
 *   npx vitest run tests/linksPago680.test.js
 */

process.env.LOG_LEVEL = 'silent';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { SYSTEM_ROLE_DEFAULTS } = await import('../src/modules/permissions/permissions.defaults.js');
const { default: linksPago } = await import('../src/modules/links-pago/index.js');
const { default: integraciones } = await import('../src/modules/integrations/index.js');
const { testStripeLinksParaPruebas, proveedorSoportado } = await import('../src/modules/integrations/integrations.controller.js');
const { linksPagoActivos, facturasColaboradorActivas } = await import('../src/shared/config/soloEnPruebas.js');

// ─── Stripe de mentira ──────────────────────────────────────────────────────
// Cada prueba dice qué contesta cada ruta. Lo que no esté preparado revienta:
// así ninguna petición puede salir a Stripe de verdad sin que se note.
const respuestas = new Map();
const fetchOriginal = globalThis.fetch;
const llamadas = [];
globalThis.fetch = vi.fn(async (url, opciones = {}) => {
  llamadas.push({ url: String(url), metodo: (opciones.method || 'GET').toUpperCase(), auth: opciones.headers?.Authorization });
  const clave = [...respuestas.keys()].find((k) => String(url).includes(k));
  if (!clave) throw new Error(`Stripe de mentira: sin respuesta para ${url}`);
  const r = respuestas.get(clave);
  return { ok: r.status < 400, status: r.status, json: async () => r.body ?? { data: [] } };
});
const stripeContesta = (mapa) => { respuestas.clear(); for (const [k, v] of Object.entries(mapa)) respuestas.set(k, { status: v }); };

// ─── La app, con las rutas de verdad ────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(linksPago.prefix, linksPago.router);
app.use(integraciones.prefix, integraciones.router);
app.use(errorHandler);
const api = supertest(app);

const MARCA = `LP680${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], leads: [], links: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

let A; let B;
const p = {};
const link = {};

const SQL_314 = fs.readFileSync(path.join(AQUI, '../migrations/314_links_de_pago.sql'), 'utf8');

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

beforeAll(async () => {
  // La 314 primero: en una base sin ella, todo lo de abajo fallaría a medias y
  // dejaría campus y personas de prueba sin borrar. Se puede pasar dos veces.
  await aplicarMigracion(SQL_314);
  const campus = async (n) => {
    const r = await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${n}`, `${MARCA.toLowerCase()}-${n}`, `${MARCA}-k-${n}`]);
    ids.projects.push(r.id);
    return r.id;
  };
  A = await campus('a');
  B = await campus('b');
  const persona = async (n, role, suyos) => {
    const u = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', $3) RETURNING id, role',
      [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  p.super = await persona('super', 'superadmin', []);
  p.adminA = await persona('admin-a', 'admin', [A]);
  p.gestora1 = await persona('gestora-1', 'gestor', [A]);
  p.gestora2 = await persona('gestora-2', 'gestor', [A]);
  p.gestoraB = await persona('gestora-b', 'gestor', [B]);
  p.tutor = await persona('tutor', 'tutor', [A]);
  p.colaborador = await persona('colaborador', 'colaborador', [A]);

  const lead = async (c) => {
    const l = await one('INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id',
      [c, `${MARCA} lead ${c}`, `lead${c}${ids.leads.length}@${MARCA.toLowerCase()}.test`]);
    ids.leads.push(l.id);
    return l.id;
  };
  const nuevo = async (c, quien, extra = {}) => {
    const r = await one(
      `INSERT INTO payment_links (project_id, lead_id, created_by, importe, precio_catalogo, descuento_pct, estado, url, caduca_el)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + interval '7 days') RETURNING id`,
      [c, await lead(c), quien.id, extra.importe ?? 900, 1000, 10, extra.estado ?? 'creado', 'https://buy.stripe.com/test_x']);
    ids.links.push(r.id);
    return r.id;
  };
  link.g1 = await nuevo(A, p.gestora1);
  link.g2 = await nuevo(A, p.gestora2, { estado: 'pagado' });
  link.gB = await nuevo(B, p.gestoraB);
  await q(`INSERT INTO payment_link_eventos (link_id, tipo, stripe_event_id, datos) VALUES ($1, 'creado', NULL, '{}'), ($1, 'abierto', $2, '{"x":1}')`,
    [link.g1, `evt_${MARCA}`]);
}, 60_000);

afterAll(async () => {
  // Cada borrado por su cuenta: si uno falla (por ejemplo, sin la tabla), los
  // demás siguen y no quedan restos en la base.
  const limpiar = [
    ['DELETE FROM payment_links WHERE project_id = ANY($1)', ids.projects],
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

beforeEach(() => { llamadas.length = 0; respuestas.clear(); });

// ─── 1. La migración ────────────────────────────────────────────────────────
describe('la migración 314', () => {
  const sql = SQL_314;

  it('se puede pasar dos veces más sin error', async () => {
    await aplicarMigracion(sql);
    await aplicarMigracion(sql);
  });

  it('deja las tablas, la columna del cargo y el tope de descuento del campus', async () => {
    const tablas = await q(`SELECT table_name FROM information_schema.tables
                             WHERE table_name IN ('payment_links', 'payment_link_eventos') ORDER BY 1`);
    expect(tablas.map((t) => t.table_name)).toEqual(['payment_link_eventos', 'payment_links']);
    const cols = await q(`SELECT table_name, column_name, column_default, is_nullable FROM information_schema.columns
                           WHERE (table_name = 'stripe_payments' AND column_name = 'payment_link_id')
                              OR (table_name = 'projects' AND column_name = 'links_pago_descuento_max_pct')`);
    expect(cols).toHaveLength(2);
    const tope = cols.find((c) => c.table_name === 'projects');
    expect(tope.is_nullable).toBe('NO');
    expect(tope.column_default).toMatch(/^0/);
    // El campus recién creado no admite descuento: solo el admin.
    expect(Number((await one('SELECT links_pago_descuento_max_pct AS v FROM projects WHERE id = $1', [A])).v)).toBe(0);
  });

  it('no admite un estado que no sea de la lista', async () => {
    await expect(q(`INSERT INTO payment_links (project_id, importe, estado) VALUES ($1, 10, 'pendiente')`, [A]))
      .rejects.toThrow(/payment_links_estado_valido/);
  });

  it('las cuotas tienen que ser coherentes, y una anulación lleva cuándo y por qué', async () => {
    await expect(q(`INSERT INTO payment_links (project_id, importe, modalidad) VALUES ($1, 10, 'cuotas')`, [A]))
      .rejects.toThrow(/payment_links_cuotas_coherentes/);
    await expect(q(`INSERT INTO payment_links (project_id, importe, estado) VALUES ($1, 10, 'anulado')`, [A]))
      .rejects.toThrow(/payment_links_anulacion_completa/);
  });

  it('un aviso de Stripe repetido no se apunta dos veces', async () => {
    await expect(q(`INSERT INTO payment_link_eventos (link_id, tipo, stripe_event_id) VALUES ($1, 'abierto', $2)`,
      [link.g1, `evt_${MARCA}`])).rejects.toThrow(/uq_payment_link_eventos_stripe/);
  });
});

// ─── 2. Los permisos de serie ───────────────────────────────────────────────
describe('los permisos de serie (catálogo)', () => {
  const de = (rol) => ['crear', 'ver_todos', 'configurar'].filter((a) => SYSTEM_ROLE_DEFAULTS[rol]?.[`links_pago.${a}`] === true);

  it('admin, los tres; gestora y soporte, solo crear; el resto, nada', () => {
    expect(de('admin')).toEqual(['crear', 'ver_todos', 'configurar']);
    expect(de('gestor')).toEqual(['crear']);
    expect(de('soporte')).toEqual(['crear']);
    expect(de('project_manager')).toEqual([]);
    expect(de('tutor')).toEqual([]);
    expect(de('colaborador')).toEqual([]);
  });
});

// ─── 3. Quién ve qué link ───────────────────────────────────────────────────
describe('GET /api/links-pago', () => {
  const idsDe = (res) => res.body.data.map((l) => l.id).filter((id) => ids.links.includes(id)).sort();

  it('una gestora ve solo los suyos, aunque pida los de otra', async () => {
    const r = await api.get('/api/links-pago').set(como(p.gestora1));
    expect(r.status).toBe(200);
    expect(idsDe(r)).toEqual([link.g1]);
    expect(r.body.pagination).toMatchObject({ page: 1, limit: 25 });
    const otra = await api.get(`/api/links-pago?createdBy=${p.gestora2.id}`).set(como(p.gestora1));
    expect(idsDe(otra)).toEqual([link.g1]);
    const fuera = await api.get(`/api/links-pago?projectId=${B}`).set(como(p.gestora1));
    expect(fuera.status).toBe(403);
  });

  it('el admin ve los de todas las personas de SUS campus, no los de otro', async () => {
    const r = await api.get('/api/links-pago').set(como(p.adminA));
    expect(r.status).toBe(200);
    expect(idsDe(r)).toEqual([link.g1, link.g2].sort());
    const pagados = await api.get('/api/links-pago?estado=pagado').set(como(p.adminA));
    expect(idsDe(pagados)).toEqual([link.g2]);
    const deUna = await api.get(`/api/links-pago?createdBy=${p.gestora1.id}`).set(como(p.adminA));
    expect(idsDe(deUna)).toEqual([link.g1]);
  });

  it('el superadmin elige campus', async () => {
    const r = await api.get(`/api/links-pago?projectId=${B}`).set(como(p.super));
    expect(idsDe(r)).toEqual([link.gB]);
  });

  it('tutor y colaborador: 403', async () => {
    expect((await api.get('/api/links-pago').set(como(p.tutor))).status).toBe(403);
    expect((await api.get('/api/links-pago').set(como(p.colaborador))).status).toBe(403);
    expect((await api.get(`/api/links-pago/${link.g1}`).set(como(p.tutor))).status).toBe(403);
  });

  it('sin sesión, 401; un filtro con mala forma, 400', async () => {
    expect((await api.get('/api/links-pago')).status).toBe(401);
    expect((await api.get('/api/links-pago?estado=regalado').set(como(p.adminA))).status).toBe(400);
  });
});

describe('GET /api/links-pago/:id', () => {
  it('la gestora abre el suyo, con su historial', async () => {
    const r = await api.get(`/api/links-pago/${link.g1}`).set(como(p.gestora1));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: link.g1, project_id: A, created_by: p.gestora1.id, estado: 'creado' });
    expect(r.body.data.eventos.map((e) => e.tipo)).toEqual(['creado', 'abierto']);
    expect(r.body.data.cobros).toEqual([]);
  });

  it('el de otra gestora, o el de otro campus, es un 404 (no se confirma que exista)', async () => {
    expect((await api.get(`/api/links-pago/${link.g2}`).set(como(p.gestora1))).status).toBe(404);
    expect((await api.get(`/api/links-pago/${link.gB}`).set(como(p.adminA))).status).toBe(404);
    expect((await api.get(`/api/links-pago/${link.g2}`).set(como(p.adminA))).status).toBe(200);
  });
});

// ─── 4. El tope de descuento ────────────────────────────────────────────────
describe('el descuento máximo del campus', () => {
  it('la gestora lo lee pero no lo cambia; el admin lo cambia en su campus', async () => {
    const leer = await api.get(`/api/links-pago/config?projectId=${A}`).set(como(p.gestora1));
    expect(leer.status).toBe(200);
    expect(leer.body.data.descuento_max_pct).toBe(0);
    expect((await api.put('/api/links-pago/config').set(como(p.gestora1)).send({ projectId: A, descuento_max_pct: 50 })).status).toBe(403);

    const r = await api.put('/api/links-pago/config').set(como(p.adminA)).send({ projectId: A, descuento_max_pct: 15.5 });
    expect(r.status).toBe(200);
    expect(r.body.data.descuento_max_pct).toBe(15.5);
    expect(Number((await one('SELECT links_pago_descuento_max_pct AS v FROM projects WHERE id = $1', [A])).v)).toBe(15.5);
  });

  it('fuera de rango, 400; en el campus de otra empresa, 403', async () => {
    expect((await api.put('/api/links-pago/config').set(como(p.adminA)).send({ projectId: A, descuento_max_pct: 150 })).status).toBe(400);
    expect((await api.put('/api/links-pago/config').set(como(p.adminA)).send({ projectId: A, descuento_max_pct: -1 })).status).toBe(400);
    expect((await api.put('/api/links-pago/config').set(como(p.adminA)).send({ projectId: B, descuento_max_pct: 5 })).status).toBe(403);
    expect((await api.put('/api/links-pago/config').set(como(p.adminA)).send({ projectId: 'x', descuento_max_pct: 5 })).status).toBe(400);
  });

  it('dos decimales de verdad, aunque la coma flotante diga otra cosa (2.3, 0.07, 4.35, 1.1)', async () => {
    for (const v of [2.3, 0.07, 4.35, 1.1, '2,5']) {
      const r = await api.put('/api/links-pago/config').set(como(p.adminA)).send({ projectId: A, descuento_max_pct: v });
      expect(r.status, `valor ${v}`).toBe(200);
      expect(r.body.data.descuento_max_pct).toBe(Number(String(v).replace(',', '.')));
    }
    expect((await api.put('/api/links-pago/config').set(como(p.adminA)).send({ projectId: A, descuento_max_pct: 2.345 })).status).toBe(400);
  });

  it('null, vacío, un booleano o nada: 400, no un 0 o un 1 sin avisar', async () => {
    for (const v of [null, '', true, false, 'abc', undefined]) {
      const r = await api.put('/api/links-pago/config').set(como(p.adminA)).send({ projectId: A, descuento_max_pct: v });
      expect(r.status, `valor ${JSON.stringify(v)}`).toBe(400);
    }
    // Y el que había sigue igual.
    expect(Number((await one('SELECT links_pago_descuento_max_pct AS v FROM projects WHERE id = $1', [A])).v)).toBe(2.5);
  });
});

describe('un id fuera de rango', () => {
  it('es un 400, no un 500 de la base', async () => {
    for (const ruta of ['/api/links-pago/2147483648', '/api/links-pago?leadId=2147483648',
      '/api/links-pago?conversionId=99999999999', '/api/links-pago?createdBy=2147483648']) {
      expect((await api.get(ruta).set(como(p.adminA))).status, ruta).toBe(400);
    }
    expect((await api.get('/api/links-pago/2147483647').set(como(p.adminA))).status).toBe(404);
  });
});

// En MultiCRM la misma puerta mira también `supabase` (proyectos IA, que aquí no hay).
// En ISEIE mira `paypal` (#766, PAYPAL_COBROS_ACTIVO) y `stripe_links`: la bandera de uno
// no abre el otro.
describe('una sola puerta para los proveedores aún no aprobados', () => {
  const prod = { NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com' };
  it('en producción, ni paypal ni stripe_links; los de siempre, sí', () => {
    expect(proveedorSoportado('paypal', prod)).toBe(false);
    expect(proveedorSoportado('stripe_links', prod)).toBe(false);
    for (const p of ['stripe', 'brevo', 'moodle', 'supabase']) expect(proveedorSoportado(p, prod), p).toBe(true);
    expect(proveedorSoportado('otro', prod)).toBe(false);
  });
  it('la bandera de uno no abre el otro', () => {
    expect(proveedorSoportado('stripe_links', { ...prod, LINKS_PAGO_EN_PRODUCCION: '1' })).toBe(true);
    expect(proveedorSoportado('paypal', { ...prod, LINKS_PAGO_EN_PRODUCCION: '1' })).toBe(false);
    expect(proveedorSoportado('paypal', { ...prod, PAYPAL_COBROS_ACTIVO: '1' })).toBe(true);
    expect(proveedorSoportado('stripe_links', { ...prod, PAYPAL_COBROS_ACTIVO: '1' })).toBe(false);
  });
  it('en /staging y en local, stripe_links sí', () => {
    for (const env of [{ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com/staging' }, { NODE_ENV: 'development' }]) {
      expect(proveedorSoportado('stripe_links', env)).toBe(true);
    }
  });
});

describe('el interruptor de producción (LINKS_PAGO_EN_PRODUCCION)', () => {
  it('en producción no, salvo con su interruptor; en /staging y en local, sí', () => {
    expect(linksPagoActivos({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com' })).toBe(false);
    expect(linksPagoActivos({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com/staging' })).toBe(true);
    expect(linksPagoActivos({ NODE_ENV: 'development' })).toBe(true);
    expect(linksPagoActivos({ NODE_ENV: 'production', LINKS_PAGO_EN_PRODUCCION: '1' })).toBe(true);
    // Ni el de facturas de colaboradores lo enciende, ni al revés.
    expect(linksPagoActivos({ NODE_ENV: 'production', FACTURAS_COLABORADOR_EN_PRODUCCION: '1' })).toBe(false);
    expect(facturasColaboradorActivas({ NODE_ENV: 'production', LINKS_PAGO_EN_PRODUCCION: '1' })).toBe(false);
  });

  it('apagado, el hueco stripe_links de Integraciones no existe; los demás siguen', async () => {
    const antes = { NODE_ENV: process.env.NODE_ENV, CRM_BASE_URL: process.env.CRM_BASE_URL, LINKS_PAGO_EN_PRODUCCION: process.env.LINKS_PAGO_EN_PRODUCCION };
    try {
      process.env.NODE_ENV = 'production';
      process.env.CRM_BASE_URL = 'https://crm.iseie.com';
      delete process.env.LINKS_PAGO_EN_PRODUCCION;
      for (const r of [
        await api.get(`/api/integrations/stripe_links?projectId=${A}`).set(como(p.adminA)),
        await api.put('/api/integrations').set(como(p.adminA)).send({ projectId: A, provider: 'stripe_links', api_key: CLAVE_RK }),
        await api.post(`/api/integrations/stripe_links/test?projectId=${A}`).set(como(p.adminA)),
        await api.delete(`/api/integrations/stripe_links?projectId=${A}`).set(como(p.adminA)),
      ]) {
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('BAD_PROVIDER');
      }
      expect((await api.get(`/api/integrations/stripe?projectId=${A}`).set(como(p.adminA))).status).toBe(200);
      expect(llamadas).toHaveLength(0);

      process.env.LINKS_PAGO_EN_PRODUCCION = '1';
      expect((await api.get(`/api/integrations/stripe_links?projectId=${A}`).set(como(p.adminA))).status).toBe(200);
    } finally {
      for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
});

// ─── 5. La clave de escritura en Integraciones ──────────────────────────────
const CLAVE_RK = 'rk_' + 'test_ClaveDeMentira680abcdef'; // partida: que no parezca una clave real a los escáneres
const CLAVE_SK = 'sk_' + 'test_ClaveDeMentira680abcdef'; // partida: que no parezca una clave real a los escáneres
const CLAVE_LECTURA = 'rk_' + 'test_LecturaDeMentira680xyz'; // partida: que no parezca una clave real a los escáneres

/** Ni un campo cifrado, ni su iv, ni su etiqueta, ni la clave en claro, a ninguna profundidad. */
function sinNadaCifrado(cuerpo, ...claves) {
  const texto = JSON.stringify(cuerpo);
  expect(texto).not.toMatch(/encrypted|"iv"|_iv"|auth_tag/);
  for (const c of claves) expect(texto).not.toContain(c);
}

describe('la clave de escritura (stripe_links)', () => {
  it('se guarda cifrada, aparte de la de lectura, y no vuelve al navegador', async () => {
    // La de lectura ya estaba, con su webhook: no se puede tocar.
    const lect = await api.put('/api/integrations').set(como(p.adminA))
      .send({ projectId: A, provider: 'stripe', active: true, api_key: CLAVE_LECTURA, webhook_secret: 'whsec_DeMentira680abc' });
    expect(lect.status).toBe(200);
    sinNadaCifrado(lect.body, CLAVE_LECTURA, 'whsec_DeMentira680abc');
    const antes = await one(`SELECT encrypted_value FROM project_integrations WHERE project_id = $1 AND provider = 'stripe'`, [A]);

    const r = await api.put('/api/integrations').set(como(p.adminA))
      .send({ projectId: A, provider: 'stripe_links', active: true, api_key: CLAVE_RK, config_public: { cualquiera: 'cosa' } });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ provider: 'stripe_links', has_secret: true });
    expect(r.body.data.config_public).toEqual({ modo: 'test', restringida: true, permisos: null });
    sinNadaCifrado(r.body, CLAVE_RK);

    const fila = await one(`SELECT encrypted_value, iv, auth_tag FROM project_integrations WHERE project_id = $1 AND provider = 'stripe_links'`, [A]);
    expect(fila.encrypted_value).toBeTruthy();
    expect(fila.encrypted_value).not.toContain(CLAVE_RK);
    const despues = await one(`SELECT encrypted_value FROM project_integrations WHERE project_id = $1 AND provider = 'stripe'`, [A]);
    expect(despues.encrypted_value).toBe(antes.encrypted_value);

    for (const ruta of [`/api/integrations/stripe_links?projectId=${A}`, `/api/integrations/stripe?projectId=${A}`, `/api/integrations?projectId=${A}`]) {
      const g = await api.get(ruta).set(como(p.adminA));
      expect(g.status).toBe(200);
      sinNadaCifrado(g.body, CLAVE_RK, CLAVE_LECTURA, 'whsec_DeMentira680abc');
    }
    // El webhook sigue guardado (solo no sale): la tarjeta de Stripe enseña su vista previa.
    const stripe = await api.get(`/api/integrations/stripe?projectId=${A}`).set(como(p.adminA));
    expect(stripe.body.data.config_public.webhook_secret_preview).toBeTruthy();
  });

  it('una publicable, o un webhook en esta tarjeta, se rechazan', async () => {
    expect((await api.put('/api/integrations').set(como(p.adminA))
      .send({ projectId: A, provider: 'stripe_links', api_key: 'pk_test_NoSirve680abcdef' })).status).toBe(400);
    expect((await api.put('/api/integrations').set(como(p.adminA))
      .send({ projectId: A, provider: 'stripe_links', webhook_secret: 'whsec_x680abcdef' })).status).toBe(400);
  });

  it('la gestora no la ve ni la guarda', async () => {
    expect((await api.get(`/api/integrations/stripe_links?projectId=${A}`).set(como(p.gestora1))).status).toBe(403);
    expect((await api.put('/api/integrations').set(como(p.gestora1))
      .send({ projectId: A, provider: 'stripe_links', api_key: CLAVE_RK })).status).toBe(403);
  });

  it('«Probar conexión» con una restringida que lo lee todo: conectado, y solo con GET de un elemento', async () => {
    stripeContesta({ '/v1/payment_links': 200, '/v1/products': 200, '/v1/prices': 200, '/v1/checkout/sessions': 200 });
    const r = await api.post(`/api/integrations/stripe_links/test?projectId=${A}`).set(como(p.adminA));
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.permisos).toEqual({ payment_links: true, products: true, prices: true, checkout_sessions: true });
    expect(r.body.data.message).toMatch(/restringida/);
    sinNadaCifrado(r.body, CLAVE_RK);
    // Nada que cree, cambie o borre: GET, y de uno en uno.
    expect(llamadas.length).toBe(4);
    for (const c of llamadas) {
      expect(c.metodo).toBe('GET');
      expect(c.url).toMatch(/limit=1$/);
      expect(c.auth).toBe(`Bearer ${CLAVE_RK}`);
    }
    // Se usa la de escritura, no la de lectura.
    expect(llamadas.some((c) => c.auth.includes(CLAVE_LECTURA))).toBe(false);
    const fila = await one(`SELECT last_test_status, active, config_public FROM project_integrations WHERE project_id = $1 AND provider = 'stripe_links'`, [A]);
    expect(fila.last_test_status).toBe('success');
    // Lo probado queda para la tarjeta, y la integración sigue activa.
    expect(fila.active).toBe(true);
    expect(fila.config_public.permisos).toEqual({ payment_links: true, products: true, prices: true, checkout_sessions: true });
    const g = await api.get(`/api/integrations/stripe_links?projectId=${A}`).set(como(p.adminA));
    expect(g.body.data.config_public.permisos.products).toBe(true);
  });

  it('con una clave que Stripe no reconoce: error, y queda apuntado', async () => {
    stripeContesta({ '/v1/payment_links': 401 });
    const r = await api.post(`/api/integrations/stripe_links/test?projectId=${A}`).set(como(p.adminA));
    expect(r.body.success).toBe(false);
    expect(r.body.data.message).toMatch(/401/);
    const fila = await one(`SELECT last_test_status FROM project_integrations WHERE project_id = $1 AND provider = 'stripe_links'`, [A]);
    expect(fila.last_test_status).toBe('error');
  });
});

describe('la prueba de la clave, sin la base', () => {
  it('a una restringida le falta Products: dice cuál y qué darle', async () => {
    stripeContesta({ '/v1/payment_links': 200, '/v1/products': 403, '/v1/prices': 200, '/v1/checkout/sessions': 200 });
    const r = await testStripeLinksParaPruebas(CLAVE_RK);
    expect(r.ok).toBe(false);
    expect(r.permisos.products).toBe(false);
    expect(r.message).toMatch(/Products/);
    expect(r.message).toMatch(/escritura/);
  });

  it('sin permiso de Payment Links: no vale', async () => {
    stripeContesta({ '/v1/payment_links': 403, '/v1/products': 200, '/v1/prices': 200, '/v1/checkout/sessions': 200 });
    const r = await testStripeLinksParaPruebas(CLAVE_RK);
    expect(r.ok).toBe(false);
    expect(r.permisos.payment_links).toBe(false);
  });

  it('la secreta de la cuenta vale, pero se avisa de que es mejor una restringida', async () => {
    stripeContesta({ '/v1/payment_links': 200 });
    const r = await testStripeLinksParaPruebas(CLAVE_SK);
    expect(r.ok).toBe(true);
    expect(r.restringida).toBe(false);
    expect(r.message).toMatch(/mejor una restringida/);
    expect(llamadas).toHaveLength(1);
  });

  it('una clave con otra forma ni se manda a Stripe', async () => {
    const r = await testStripeLinksParaPruebas('pk_live_NoSirve680abcdef');
    expect(r.ok).toBe(false);
    expect(llamadas).toHaveLength(0);
  });
});
