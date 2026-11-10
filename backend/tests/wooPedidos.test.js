import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/**
 * Los pedidos de WooCommerce (#14), contra la base de verdad y con WooCommerce
 * simulado (`fetch`).
 *
 * Lo que se defiende:
 *   · se traen y se guardan; volver a traerlos NO duplica, actualiza;
 *   · la sincronización es incremental (pide lo modificado desde la última vez) y
 *     si falla NO avanza: no se pierde ningún pedido;
 *   · un pedido se enlaza al prospecto con ese correo del MISMO campus, y no crea una venta;
 *   · el aviso de WooCommerce entra por firma: sin firma, con firma falsa o de otro
 *     campus es un 401, igual para los tres casos;
 *   · solo admin, y un admin solo de sus campus; las claves nunca salen en un error.
 *
 *   npx vitest run tests/wooPedidos.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: wcModulo } = await import('../src/modules/woocommerce/index.js');
const { default: wcWebhook } = await import('../src/modules/woocommerce/wc.webhook.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { mapearPedido, firmaValida, sincronizarPedidos } = await import('../src/modules/woocommerce/wc.orders.js');

const app = express();
app.use('/api/woocommerce/webhook', wcWebhook);
app.use(express.json());
app.use(wcModulo.prefix, wcModulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `WOO${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], leads: [] };
let P; let OTRO; let ADMIN; let GESTORA; let LEAD_ANA; let LEAD_OTRO;
const jwtDe = (u) => jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' });
const como = (u) => ({ Authorization: `Bearer ${jwtDe(u)}` });
const CLAVE = 'ck_clave_de_prueba';
const SECRETA = 'cs_secreta_de_prueba';

const pedido = (id, extra = {}) => ({
  id, number: String(id), status: 'completed', total: '120.50', currency: 'EUR',
  billing: { email: 'Ana@Cliente.test', first_name: 'Ana', last_name: 'Pérez' },
  line_items: [{ id: id * 10, product_id: 77, name: 'Máster en Coaching', sku: 'MC-1', quantity: 1, total: '120.50' }],
  date_created_gmt: '2026-10-10T09:00:00', date_modified_gmt: '2026-10-10T09:30:00', ...extra,
});

/** WooCommerce simulado: devuelve las páginas que se le den y apunta qué se pidió. */
function wooDevuelve(...paginas) {
  const pedidas = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    pedidas.push(String(url));
    const n = Number(new URL(url).searchParams.get('page'));
    const cuerpo = paginas[n - 1] ?? [];
    return { ok: true, status: 200, json: async () => cuerpo };
  }));
  return pedidas;
}

beforeAll(async () => {
  const proy = async (clave) => {
    const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${clave}`, `${MARCA.toLowerCase()}-${clave}`, `${MARCA}-key-${clave}`]);
    ids.projects.push(p.id);
    await q(`INSERT INTO wc_credentials (project_id, store_url, consumer_key, consumer_secret, active, sync_orders) VALUES ($1, 'https://tienda.example.org', $2, $3, true, true)`,
      [p.id, CLAVE, SECRETA]);
    return p.id;
  };
  P = await proy('a'); OTRO = await proy('b');
  const persona = async (nombre, role, campus) => {
    const [u] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
      [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of campus) await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, c]);
    return u;
  };
  ADMIN = await persona('ADMIN', 'admin', [P]);
  GESTORA = await persona('GESTORA', 'gestor', [P]);
  const lead = async (nombre, email, proyecto) => {
    const [l] = await q(`INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id`, [proyecto, `${MARCA} ${nombre}`, email]);
    ids.leads.push(l.id);
    return l.id;
  };
  LEAD_ANA = await lead('Ana', 'ana@cliente.test', P);
  LEAD_OTRO = await lead('Ana de otro campus', 'ana@cliente.test', OTRO);
}, 60000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await q(`DELETE FROM woocommerce_orders WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM wc_credentials WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

beforeEach(async () => {
  await q(`DELETE FROM woocommerce_orders WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`UPDATE wc_credentials SET orders_last_sync_at = NULL, webhook_secret = NULL WHERE project_id = ANY($1::int[])`, [ids.projects]);
});

const filas = (proyecto = P) => q(`SELECT * FROM woocommerce_orders WHERE project_id = $1 ORDER BY wc_order_id`, [proyecto]);
const sincronizar = (u, qs = '') => request.post(`/api/woocommerce/sync/orders?projectId=${P}${qs}`).set(como(u));

describe('mapear un pedido', () => {
  it('correo en minúsculas, nombre, líneas y fechas en UTC', () => {
    const m = mapearPedido(pedido(5));
    expect(m).toMatchObject({ wc_order_id: 5, numero: '5', status: 'completed', total: 120.5, currency: 'EUR', customer_email: 'ana@cliente.test', customer_name: 'Ana Pérez' });
    expect(m.line_items).toEqual([{ id: 50, product_id: 77, name: 'Máster en Coaching', sku: 'MC-1', quantity: 1, total: 120.5 }]);
    expect(m.wc_created_at).toBe('2026-10-10T09:00:00.000Z');
  });

  it('un pedido de invitado sin nombre ni correo no revienta', () => {
    expect(mapearPedido({ id: 9, status: 'pending', total: '10' })).toMatchObject({ customer_email: null, customer_name: null, line_items: [] });
  });
});

describe('sincronizar a mano', () => {
  it('trae los pedidos, los guarda y enlaza al prospecto del MISMO campus', async () => {
    wooDevuelve([pedido(1), pedido(2, { billing: { email: 'invitado@x.test', first_name: 'Inv' } })]);
    const r = await sincronizar(ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ total: 2, nuevos: 2, actualizados: 0, enlazados: 1 });
    const f = await filas();
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ lead_id: LEAD_ANA, status: 'completed' });
    expect(f[1].lead_id).toBeNull();
    // Y no es un prospecto de otro campus aunque tenga el mismo correo.
    expect(f[0].lead_id).not.toBe(LEAD_OTRO);
  });

  it('NO crea ninguna venta', async () => {
    const antes = (await q(`SELECT count(*)::int AS n FROM conversions WHERE lead_id = $1`, [LEAD_ANA]))[0].n;
    wooDevuelve([pedido(1)]);
    await sincronizar(ADMIN);
    expect((await q(`SELECT count(*)::int AS n FROM conversions WHERE lead_id = $1`, [LEAD_ANA]))[0].n).toBe(antes);
  });

  it('volver a traerlos no duplica: actualiza el estado', async () => {
    wooDevuelve([pedido(1)]);
    await sincronizar(ADMIN);
    wooDevuelve([pedido(1, { status: 'refunded', total: '0.00' })]);
    const r = await sincronizar(ADMIN);
    expect(r.body.data).toMatchObject({ nuevos: 0, actualizados: 1 });
    const f = await filas();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ status: 'refunded' });
    expect(Number(f[0].total)).toBe(0);
  });

  it('es incremental: la segunda vuelta pide solo lo modificado desde la primera', async () => {
    const primera = wooDevuelve([pedido(1)]);
    await sincronizar(ADMIN);
    expect(primera[0]).not.toContain('modified_after');
    const [{ orders_last_sync_at: marca }] = await q(`SELECT orders_last_sync_at FROM wc_credentials WHERE project_id = $1`, [P]);
    expect(marca).toBeTruthy();
    const segunda = wooDevuelve([]);
    await sincronizar(ADMIN);
    expect(new URL(segunda[0]).searchParams.get('modified_after')).toBe(new Date(marca).toISOString());
    // Y con `completa=true` pide todo otra vez.
    const entera = wooDevuelve([]);
    await sincronizar(ADMIN, '&completa=true');
    expect(entera[0]).not.toContain('modified_after');
  });

  it('pagina: pide la siguiente mientras la página venga llena', async () => {
    const llena = Array.from({ length: 100 }, (_, i) => pedido(1000 + i));
    const pedidas = wooDevuelve(llena, [pedido(2000), pedido(2001)]);
    const r = await sincronizar(ADMIN);
    expect(r.body.data.total).toBe(102);
    expect(pedidas).toHaveLength(2);
    expect((await filas()).length).toBe(102);
  });

  it('si WooCommerce falla, NO avanza la marca y no se pierde nada; y no enseña las claves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    const r = await sincronizar(ADMIN);
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('WC_ERROR');
    expect(JSON.stringify(r.body)).not.toContain(CLAVE);
    expect(JSON.stringify(r.body)).not.toContain(SECRETA);
    expect((await q(`SELECT orders_last_sync_at FROM wc_credentials WHERE project_id = $1`, [P]))[0].orders_last_sync_at).toBeNull();
  });

  it('si WooCommerce no responde (caída), 502 y no un 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed'); }));
    expect((await sincronizar(ADMIN)).status).toBe(502);
  });

  it('quién puede: una gestora no (403); un campus ajeno, 403; sin campus, 400; sin credenciales, 404', async () => {
    expect((await sincronizar(GESTORA)).status).toBe(403);
    expect((await request.post(`/api/woocommerce/sync/orders?projectId=${OTRO}`).set(como(ADMIN))).status).toBe(403);
    expect((await request.post('/api/woocommerce/sync/orders').set(como(ADMIN))).status).toBe(400);
    await q(`DELETE FROM wc_credentials WHERE project_id = $1`, [P]);
    expect((await sincronizar(ADMIN)).status).toBe(404);
    await q(`INSERT INTO wc_credentials (project_id, store_url, consumer_key, consumer_secret, active, sync_orders) VALUES ($1, 'https://tienda.example.org', $2, $3, true, true)`, [P, CLAVE, SECRETA]);
  });
});

describe('listar', () => {
  beforeEach(async () => {
    wooDevuelve([pedido(1), pedido(2, { status: 'processing', billing: { email: 'otra@x.test', first_name: 'Otra', last_name: 'Persona' } }), pedido(3, { status: 'completed', billing: { email: 'sin@lead.test' } })]);
    await sincronizar(ADMIN);
  });

  it('con su campus, paginación, total y el prospecto enlazado', async () => {
    const r = await request.get(`/api/woocommerce/orders?projectId=${P}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.data.total).toBe(3);
    expect(r.body.data.pedidos.find((p) => p.wc_order_id === 1)).toMatchObject({ lead_id: LEAD_ANA, lead_nombre: `${MARCA} Ana`, total: 120.5, campus: `${MARCA} a` });
  });

  it('filtros: estado, texto y «sin enlazar»', async () => {
    const get = async (qs) => (await request.get(`/api/woocommerce/orders?projectId=${P}${qs}`).set(como(ADMIN))).body.data.pedidos.map((p) => p.wc_order_id).sort();
    expect(await get('&status=processing')).toEqual([2]);
    expect(await get('&q=otra%40x')).toEqual([2]);
    expect(await get('&sinEnlazar=true')).toEqual([2, 3]);
    expect((await request.get(`/api/woocommerce/orders?projectId=${P}&limit=2&page=2`).set(como(ADMIN))).body.data.pedidos).toHaveLength(1);
  });

  it('un admin solo ve los de SUS campus: sin projectId, los suyos; uno ajeno, 403', async () => {
    await q(`INSERT INTO woocommerce_orders (project_id, wc_order_id, status) VALUES ($1, 999, 'completed')`, [OTRO]);
    const todos = await request.get('/api/woocommerce/orders').set(como(ADMIN));
    expect(todos.body.data.pedidos.every((p) => p.project_id === P)).toBe(true);
    expect((await request.get(`/api/woocommerce/orders?projectId=${OTRO}`).set(como(ADMIN))).status).toBe(403);
    expect((await request.get(`/api/woocommerce/orders?projectId=${P}`).set(como(GESTORA))).status).toBe(403);
  });
});

describe('el aviso de WooCommerce (webhook)', () => {
  const firmar = (cuerpo, secreto) => crypto.createHmac('sha256', secreto).update(cuerpo).digest('base64');
  const enviar = (proyecto, cuerpo, firma) => {
    const r = request.post(`/api/woocommerce/webhook/${proyecto}`).set('Content-Type', 'application/json');
    return (firma ? r.set('X-WC-Webhook-Signature', firma) : r).send(cuerpo);
  };
  let SECRETO;
  beforeEach(async () => {
    SECRETO = (await request.post(`/api/woocommerce/webhook-secret?projectId=${P}`).set(como(ADMIN))).body.data.secreto;
  });

  it('crear el secreto: se enseña una vez, con la ruta, y solo un admin de ese campus', async () => {
    const r = await request.post(`/api/woocommerce/webhook-secret?projectId=${P}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ ruta: `/api/woocommerce/webhook/${P}` });
    expect(r.body.data.secreto).toMatch(/^[0-9a-f]{48}$/);
    expect((await request.post(`/api/woocommerce/webhook-secret?projectId=${OTRO}`).set(como(ADMIN))).status).toBe(403);
    expect((await request.post(`/api/woocommerce/webhook-secret?projectId=${P}`).set(como(GESTORA))).status).toBe(403);
    // Y no sale en las credenciales (que enseñan ****).
    const c = await request.get(`/api/woocommerce/credentials?projectId=${P}`).set(como(ADMIN));
    expect(JSON.stringify(c.body)).not.toContain(r.body.data.secreto);
  });

  it('con la firma buena guarda el pedido y lo enlaza', async () => {
    const cuerpo = JSON.stringify(pedido(42, { status: 'processing' }));
    const r = await enviar(P, cuerpo, firmar(cuerpo, SECRETO));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ guardado: true, nuevo: true, enlazado: true });
    expect((await filas())[0]).toMatchObject({ wc_order_id: '42', status: 'processing', lead_id: LEAD_ANA });
  });

  it('el mismo aviso dos veces no duplica', async () => {
    const cuerpo = JSON.stringify(pedido(42));
    await enviar(P, cuerpo, firmar(cuerpo, SECRETO));
    const r = await enviar(P, cuerpo, firmar(cuerpo, SECRETO));
    expect(r.body.data.nuevo).toBe(false);
    expect(await filas()).toHaveLength(1);
  });

  it('sin firma, con firma falsa, con el secreto de otro campus o con el cuerpo cambiado: 401, y no se guarda nada', async () => {
    const cuerpo = JSON.stringify(pedido(43));
    expect((await enviar(P, cuerpo, null)).status).toBe(401);
    expect((await enviar(P, cuerpo, firmar(cuerpo, 'otro-secreto'))).status).toBe(401);
    expect((await enviar(P, cuerpo, 'no-es-base64-de-una-firma')).status).toBe(401);
    expect((await enviar(P, JSON.stringify(pedido(44)), firmar(cuerpo, SECRETO))).status).toBe(401);
    const secretoOtro = (await request.post(`/api/woocommerce/webhook-secret?projectId=${P}`).set(como(ADMIN))).body.data.secreto;
    expect((await enviar(OTRO, cuerpo, firmar(cuerpo, secretoOtro))).status).toBe(401);
    expect(await filas()).toHaveLength(0);
  });

  it('un campus sin secreto, o que no existe, da el mismo 401 (no se enseña cuál es)', async () => {
    const cuerpo = JSON.stringify(pedido(45));
    const sinSecreto = await enviar(OTRO, cuerpo, firmar(cuerpo, 'x'));
    const noExiste = await enviar(2147483000, cuerpo, firmar(cuerpo, 'x'));
    expect(sinSecreto.status).toBe(401);
    expect(noExiste.status).toBe(401);
    expect(sinSecreto.body).toEqual(noExiste.body);
  });

  it('el «ping» con el que WooCommerce crea el aviso se acepta sin guardar nada', async () => {
    const cuerpo = 'webhook_id=17';
    const r = await request.post(`/api/woocommerce/webhook/${P}`).set('Content-Type', 'application/x-www-form-urlencoded')
      .set('X-WC-Webhook-Signature', firmar(cuerpo, SECRETO)).send(cuerpo);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ guardado: false });
    expect(await filas()).toHaveLength(0);
  });

  it('firma válida pero un cuerpo que no es un pedido: 400', async () => {
    const cuerpo = 'esto no es json';
    expect((await enviar(P, cuerpo, firmar(cuerpo, SECRETO))).status).toBe(400);
  });

  it('firmaValida: compara en tiempo constante y rechaza lo que no cuadra', () => {
    const c = Buffer.from('hola');
    const buena = crypto.createHmac('sha256', 's').update(c).digest('base64');
    expect(firmaValida(c, buena, 's')).toBe(true);
    expect(firmaValida(c, buena, 'otro')).toBe(false);
    expect(firmaValida(c, '', 's')).toBe(false);
    expect(firmaValida('texto', buena, 's')).toBe(false);
    expect(firmaValida(c, buena, null)).toBe(false);
  });
});

describe('el interruptor', () => {
  it('se enciende y se apaga por campus, solo un admin de él', async () => {
    const put = (u, proyecto, v) => request.put(`/api/woocommerce/orders-config?projectId=${proyecto}`).set(como(u)).send({ sync_orders: v });
    expect((await put(ADMIN, P, false)).status).toBe(200);
    expect((await q(`SELECT sync_orders FROM wc_credentials WHERE project_id = $1`, [P]))[0].sync_orders).toBe(false);
    expect((await put(ADMIN, P, true)).body.data.sync_orders).toBe(true);
    expect((await put(ADMIN, OTRO, true)).status).toBe(403);
    expect((await put(GESTORA, P, true)).status).toBe(403);
    expect((await request.put(`/api/woocommerce/orders-config?projectId=${P}`).set(como(ADMIN)).send({ sync_orders: 'si' })).status).toBe(400);
  });

  it('sincronizarPedidos (lo que llama el scheduler) usa la marca de la tienda', async () => {
    wooDevuelve([pedido(1)]);
    const creds = (await q(`SELECT * FROM wc_credentials WHERE project_id = $1`, [P]))[0];
    const r = await sincronizarPedidos(creds);
    expect(r).toMatchObject({ total: 1, nuevos: 1 });
    expect((await q(`SELECT orders_last_sync_at FROM wc_credentials WHERE project_id = $1`, [P]))[0].orders_last_sync_at).toBeTruthy();
  });
});
