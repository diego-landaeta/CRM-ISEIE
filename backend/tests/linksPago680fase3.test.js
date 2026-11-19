import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Links de pago, fase 3 (#407, gemela de CRM#680 y CRM#872): el cobro del link, a su venta. Contra la base
 * local de verdad y con Stripe de mentira.
 *
 *   · un cargo con la marca del CRM va a la venta del link sin mirar el correo;
 *     si el link salió de un prospecto, se crea la venta a nombre de quien lo
 *     creó (o se usa la de ese curso que ya tenga la ficha);
 *   · el link pasa a «pagado», el cargo apunta a él, queda en su historial y se
 *     avisa a quien lo creó; si el cargo vuelve a entrar, nada se repite;
 *   · la marca de otro campus o de otro entorno no se asocia (ni por el correo);
 *   · con los links apagados (producción sin LINKS_PAGO_EN_PRODUCCION), todo
 *     como antes;
 *   · `checkout.session.completed` apunta la sesión, trae el cargo y lo cobra
 *     por el mismo camino, una vez; `expired` y los intentos fallidos quedan en
 *     el historial y dejan el link «abierto»;
 *   · desde una venta, el tope de descuento se mide contra lo pendiente;
 *   · la venta que se crea desde el prospecto lleva el IVA dentro del importe del
 *     link (en ISEIE, sin decirlo, el 21 % se sumaría encima).
 *
 * Lo de las cuentas de Stripe compartidas (la marca de plataforma) no viene: en
 * ISEIE cada campus tiene su propia cuenta.
 *
 *   npx vitest run tests/linksPago680fase3.test.js
 */

process.env.LOG_LEVEL = 'silent';
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const integrationsModel = await import('../src/modules/integrations/integrations.model.js');
const { default: linksPago } = await import('../src/modules/links-pago/index.js');
const servicio = await import('../src/modules/stripe-payments/stripe-payments.service.js');
const { marcaDe } = await import('../src/modules/links-pago/links-pago.cobro.js');

// ─── Stripe de mentira ──────────────────────────────────────────────────────
// Lo que no esté preparado revienta: nada sale a Stripe de verdad sin que se note.
let preparadas = [];
const llamadas = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = vi.fn(async (url, opciones = {}) => {
  const metodo = (opciones.method || 'GET').toUpperCase();
  const u = new URL(String(url));
  const cuerpo = opciones.body ? Object.fromEntries(new URLSearchParams(opciones.body)) : null;
  llamadas.push({ metodo, ruta: u.pathname, query: Object.fromEntries(u.searchParams), cuerpo });
  const r = preparadas.find(([m, ruta]) => m === metodo && u.pathname === ruta);
  if (!r) throw new Error(`Stripe de mentira: sin respuesta para ${metodo} ${u.pathname}`);
  const [, , status, body] = r;
  const datos = typeof body === 'function' ? body(cuerpo) : body ?? {};
  return { ok: status < 400, status, json: async () => datos, text: async () => JSON.stringify(datos) };
});
let n = 0;
const stripeCreaBien = () => {
  preparadas = [
    ['POST', '/v1/prices', 200, () => ({ id: `price_f3_${++n}` })],
    ['POST', '/v1/payment_links', 200, () => ({ id: `plink_f3_${MARCA}_${n}`, url: `https://buy.stripe.com/test_f3_${n}` })],
  ];
};

const app = express();
app.use(express.json());
app.use(linksPago.prefix, linksPago.router);
app.use(errorHandler);
const api = supertest(app);

const MARCA = `LP680F3${Date.now().toString(36)}`;
const m = MARCA.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const CLAVE_RK = 'rk_' + 'test_EscrituraDeMentira680f3';
const CLAVE_LECTURA = 'rk_' + 'test_LecturaDeMentira680f3xy';

let A; let B;
const p = {};
const prod = {};

async function ponerClave(projectId, provider, clave, config = {}) {
  const e = encrypt(clave);
  await integrationsModel.upsert({ projectId, provider, active: true, encrypted_value: e.encrypted, iv: e.iv, auth_tag: e.authTag, config_public: config });
}
async function nuevoLead(projectId, responsable, { email = null, status = 'nuevo' } = {}) {
  return (await one('INSERT INTO leads (project_id, nombre, email, responsable_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [projectId, `${MARCA} lead`, email, responsable?.id ?? null, status])).id;
}
async function nuevaVenta(projectId, leadId, { total = 1000, producto = null, vendedora = null } = {}) {
  return (await one(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado,
                              fecha_conversion, vendedora_id)
     VALUES ($1, $2, $3, $4, $5, 0, CURRENT_DATE - 5, $6) RETURNING id`,
    [leadId, projectId, `${MARCA} venta`, producto, total, vendedora?.id ?? null])).id;
}
/** Un link ya creado (como lo deja la fase 2), sin pasar por Stripe. */
async function nuevoLink(projectId, { leadId = null, conversionId = null, productId = null, creador, importe = 1000, estado = 'creado' }) {
  const l = await one(
    `INSERT INTO payment_links (project_id, lead_id, conversion_id, product_id, created_by, precio_catalogo, importe, moneda,
                                estado, url, stripe_payment_link_id, caduca_el,
                                anulado_el, motivo_anulacion)
     VALUES ($1, $2, $3, $4, $5, $6, $6, 'EUR', $7::varchar, 'https://buy.stripe.com/x', $8, NOW() + interval '7 days',
             CASE WHEN $7::varchar = 'anulado' THEN NOW() END, CASE WHEN $7::varchar = 'anulado' THEN 'prueba' END)
     RETURNING id`,
    [projectId, leadId, conversionId, productId, creador.id, importe, estado, `plink_${MARCA}_${Math.random().toString(36).slice(2, 10)}`]);
  return one('SELECT * FROM payment_links WHERE id = $1', [l.id]);
}
const marcaDelLink = (link, extra = {}) => ({
  crm_link_id: String(link.id), crm_project_id: String(link.project_id),
  crm_lead_id: link.lead_id ? String(link.lead_id) : '', crm_user_id: String(link.created_by),
  crm_entorno: 'local', ...extra,
});
let nCargo = 0;
// Cada cargo con su id: el correo del pagador no es el de la ficha salvo que se diga.
function cargoDe(euros, { metadata = {}, email = null, status = 'succeeded' } = {}) {
  const k = ++nCargo;
  return {
    id: `ch_${MARCA}_${k}`, amount: Math.round(euros * 100), currency: 'eur', status, created: Math.floor(Date.now() / 1000),
    billing_details: { email: email || `pagador${k}@otro.test`, name: `${MARCA} Pagador` }, metadata,
    payment_method_details: { type: 'card' },
  };
}
const aviso = (cargo, type = 'charge.succeeded') => ({ id: `evt_${cargo.id}_${type}`, type, data: { object: cargo } });
const filaCargo = (projectId, stripeId) => one(
  'SELECT id, conversion_id, conversion_payment_id, lead_id, link_method, payment_link_id FROM stripe_payments WHERE project_id = $1 AND stripe_id = $2',
  [projectId, stripeId]);
const cobrosDe = (conversionId) => q('SELECT id, importe, notas FROM conversion_payments WHERE conversion_id = $1 ORDER BY id', [conversionId]);
const eventosDe = (linkId) => q('SELECT tipo, stripe_event_id, datos FROM payment_link_eventos WHERE link_id = $1 ORDER BY id', [linkId]);
const linkDe = (id) => one('SELECT * FROM payment_links WHERE id = $1', [id]);

beforeAll(async () => {
  const campus = async (x) => {
    const r = await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${x}`, `${m}-${x}`, `${MARCA}-k-${x}`]);
    ids.projects.push(r.id);
    return r.id;
  };
  A = await campus('a');
  B = await campus('b');
  const persona = async (x, role, suyos) => {
    const u = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', $3) RETURNING id, role',
      [`${MARCA} ${x}`, `${x}@${m}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  p.admin = await persona('admin', 'admin', [A]);
  p.gestora = await persona('gestora', 'gestor', [A]);
  p.otra = await persona('otra', 'gestor', [A]);
  const curso = async (c, nombre, precio) => (await one(
    'INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, $3, \'EUR\') RETURNING id', [c, `${MARCA} ${nombre}`, precio])).id;
  prod.A = await curso(A, 'máster', 1000);
  prod.A2 = await curso(A, 'experto', 600);

  await ponerClave(A, 'stripe_links', CLAVE_RK);
  await ponerClave(A, 'stripe', CLAVE_LECTURA);
}, 60_000);

afterAll(async () => {
  // El campus se lleva en cascada fichas, ventas, cobros, cargos, links e integraciones.
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

beforeEach(() => { llamadas.length = 0; preparadas = []; });

// ─── 1. La marca ────────────────────────────────────────────────────────────

describe('la marca del CRM en la metadata', () => {
  it('se lee el link, el campus y el entorno; lo que no es un número no es marca', () => {
    expect(marcaDe({ crm_link_id: '12', crm_project_id: '3', crm_entorno: 'staging' })).toEqual({ linkId: 12, projectId: 3, entorno: 'staging' });
    expect(marcaDe({ crm_link_id: '12; DROP' })).toBeNull();
    expect(marcaDe({ order_id: '55' })).toBeNull();
    expect(marcaDe(null)).toBeNull();
  });
});

// ─── 2. El cargo del link, a su venta ───────────────────────────────────────

describe('el cobro de un link, a su venta', { timeout: 60_000 }, () => {
  it('link desde un prospecto: se crea la venta a nombre de quien creó el link, con su curso, y el cobro dentro', async () => {
    // El correo del pago no es el de la ficha: con el correo no se habría asociado.
    const lead = await nuevoLead(A, p.otra, { email: `ficha@${m}.test` });
    const link = await nuevoLink(A, { leadId: lead, productId: prod.A, creador: p.gestora, importe: 900 });
    const ch = cargoDe(900, { metadata: marcaDelLink(link) });
    await servicio.handleWebhookEvent(A, aviso(ch));

    const sp = await filaCargo(A, ch.id);
    expect(sp.link_method).toBe('auto_link_pago');
    expect(sp.payment_link_id).toBe(link.id);
    expect(sp.lead_id).toBe(lead);
    const venta = await one('SELECT * FROM conversions WHERE id = $1', [sp.conversion_id]);
    expect(venta).toMatchObject({ lead_id: lead, project_id: A, vendedora_id: p.gestora.id, producto_contratado_id: prod.A });
    expect(Number(venta.importe_total)).toBe(900);
    // ISEIE: lo cobrado por el link ya es el precio final, IVA dentro; sin esto la
    // venta saldría por 1.089 € (el 21 % encima).
    expect(venta.iva_incluido).toBe(true);
    const cobros = await cobrosDe(venta.id);
    expect(cobros).toHaveLength(1);
    expect(Number(cobros[0].importe)).toBe(900);
    expect(cobros[0].id).toBe(sp.conversion_payment_id);
    expect(cobros[0].notas).toContain(`link de pago n.º ${link.id}`);

    const l = await linkDe(link.id);
    expect(l.estado).toBe('pagado');
    expect(l.pagado_el).not.toBeNull();
    expect(l.conversion_id).toBe(venta.id);
    const ev = await eventosDe(link.id);
    expect(ev.map((e) => e.tipo)).toEqual(['pagado']);
    expect(ev[0].datos).toMatchObject({ stripe_id: ch.id, conversion_id: venta.id, conversion_payment_id: cobros[0].id });
    expect((await one('SELECT status FROM leads WHERE id = $1', [lead])).status).toBe('convertido');

    // Se avisa a quien creó el link (no a la responsable de la ficha).
    const avisoCampana = await one(
      `SELECT target_user_ids, title FROM admin_notifications WHERE metadata->>'stripe_id' = $1`, [ch.id]);
    expect(avisoCampana.target_user_ids).toEqual([p.gestora.id]);
    expect(avisoCampana.title).toMatch(/Link de pago cobrado/);

    // El mismo cargo vuelve a entrar (el sondeo, otro aviso): nada se repite.
    await servicio.handleWebhookEvent(A, aviso(ch));
    expect(await cobrosDe(venta.id)).toHaveLength(1);
    expect(await eventosDe(link.id)).toHaveLength(1);
    expect((await q('SELECT id FROM conversions WHERE lead_id = $1', [lead]))).toHaveLength(1);
  });

  it('link desde una venta: el cobro va a esa venta, sin crear otra', async () => {
    const lead = await nuevoLead(A, p.gestora, { email: `venta@${m}.test` });
    const venta = await nuevaVenta(A, lead, { total: 1000, producto: prod.A, vendedora: p.otra });
    const link = await nuevoLink(A, { leadId: lead, conversionId: venta, productId: prod.A, creador: p.gestora, importe: 400 });
    const ch = cargoDe(400, { metadata: marcaDelLink(link, { crm_conversion_id: String(venta) }) });
    await servicio.handleWebhookEvent(A, aviso(ch));

    expect((await filaCargo(A, ch.id)).conversion_id).toBe(venta);
    expect((await cobrosDe(venta)).map((c) => Number(c.importe))).toEqual([400]);
    expect((await q('SELECT id FROM conversions WHERE lead_id = $1', [lead]))).toHaveLength(1);
    // La venta sigue siendo de quien la hizo.
    expect((await one('SELECT vendedora_id FROM conversions WHERE id = $1', [venta])).vendedora_id).toBe(p.otra.id);
    expect((await linkDe(link.id)).estado).toBe('pagado');
  });

  it('desde un prospecto que ya tiene la venta de ese curso (registrada a mano mientras): va a esa venta', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const link = await nuevoLink(A, { leadId: lead, productId: prod.A2, creador: p.gestora, importe: 600 });
    const aMano = await nuevaVenta(A, lead, { total: 600, producto: prod.A2, vendedora: p.gestora });
    const ch = cargoDe(600, { metadata: marcaDelLink(link) });
    await servicio.handleWebhookEvent(A, aviso(ch));
    expect((await filaCargo(A, ch.id)).conversion_id).toBe(aMano);
    expect((await q('SELECT id FROM conversions WHERE lead_id = $1', [lead]))).toHaveLength(1);
    expect((await linkDe(link.id)).conversion_id).toBe(aMano);
  });

  it('y si la asesora ya apuntó ese cobro a mano, se engancha a él sin sumar otra vez', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const venta = await nuevaVenta(A, lead, { total: 1000, producto: prod.A });
    await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha, notas) VALUES ($1, 250, CURRENT_DATE, 'a mano')`, [venta]);
    const link = await nuevoLink(A, { leadId: lead, conversionId: venta, productId: prod.A, creador: p.gestora, importe: 250 });
    const ch = cargoDe(250, { metadata: marcaDelLink(link) });
    await servicio.handleWebhookEvent(A, aviso(ch));
    const sp = await filaCargo(A, ch.id);
    expect(sp.link_method).toBe('auto_dedup');
    expect(await cobrosDe(venta)).toHaveLength(1);
    expect((await linkDe(link.id)).estado).toBe('pagado');
  });

  it('un link caducado que el cliente llegó a pagar: pagado igual (el dinero entró), y se dice', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const link = await nuevoLink(A, { leadId: lead, productId: prod.A, creador: p.gestora, importe: 1000, estado: 'caducado' });
    const ch = cargoDe(1000, { metadata: marcaDelLink(link) });
    await servicio.handleWebhookEvent(A, aviso(ch));
    expect((await linkDe(link.id)).estado).toBe('pagado');
    expect((await eventosDe(link.id))[0].datos.estaba).toBe('caducado');
  });

  it('un intento fallido: queda en el historial, el link pasa a «abierto» y no se cobra nada', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const link = await nuevoLink(A, { leadId: lead, productId: prod.A, creador: p.gestora });
    const ch = cargoDe(1000, { metadata: marcaDelLink(link), status: 'failed' });
    await servicio.handleWebhookEvent(A, aviso(ch, 'charge.failed'));
    await servicio.handleWebhookEvent(A, aviso(ch, 'charge.failed'));
    const sp = await filaCargo(A, ch.id);
    expect(sp.payment_link_id).toBe(link.id);
    expect(sp.conversion_payment_id).toBeNull();
    expect((await eventosDe(link.id)).map((e) => e.tipo)).toEqual(['intento_fallido']);
    expect((await linkDe(link.id)).estado).toBe('abierto');
    expect((await q('SELECT id FROM conversions WHERE lead_id = $1', [lead]))).toHaveLength(0);
  });
});

// ─── 3. Marcas que no son de aquí, y los links apagados ─────────────────────

describe('la marca solo vale en su campus y su entorno', { timeout: 60_000 }, () => {
  it('marca de otro entorno (/staging y local comparten la cuenta de test): no se asocia, ni por el correo', async () => {
    const email = `entorno@${m}.test`;
    const lead = await nuevoLead(A, p.gestora, { email, status: 'convertido' });
    const venta = await nuevaVenta(A, lead);
    const link = await nuevoLink(A, { leadId: lead, conversionId: venta, productId: prod.A, creador: p.gestora });
    const ch = cargoDe(1000, { email, metadata: marcaDelLink(link, { crm_entorno: 'staging' }) });
    await servicio.handleWebhookEvent(A, aviso(ch));
    const sp = await filaCargo(A, ch.id);
    expect(sp.conversion_id).toBeNull();
    expect(sp.payment_link_id).toBeNull();
    expect(await cobrosDe(venta)).toHaveLength(0);
    expect((await linkDe(link.id)).estado).toBe('creado');
  });

  it('marca de otro campus: no se asocia', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const link = await nuevoLink(A, { leadId: lead, productId: prod.A, creador: p.gestora });
    const ch = cargoDe(1000, { metadata: marcaDelLink(link) });
    await servicio.handleWebhookEvent(B, aviso(ch));
    expect((await filaCargo(B, ch.id)).conversion_id).toBeNull();
    expect((await linkDe(link.id)).estado).toBe('creado');
  });

  it('un link que aquí no existe: no se asocia', async () => {
    const ch = cargoDe(10, { metadata: { crm_link_id: '999999999', crm_project_id: String(A), crm_entorno: 'local' } });
    await servicio.handleWebhookEvent(A, aviso(ch));
    expect((await filaCargo(A, ch.id)).conversion_id).toBeNull();
  });

  it('con los links apagados (producción sin LINKS_PAGO_EN_PRODUCCION), la marca no cuenta: todo como antes', async () => {
    const email = `apagado@${m}.test`;
    const lead = await nuevoLead(A, p.gestora, { email, status: 'convertido' });
    const venta = await nuevaVenta(A, lead);
    const link = await nuevoLink(A, { leadId: lead, productId: prod.A, creador: p.gestora });
    const ch = cargoDe(1000, { email, metadata: marcaDelLink(link) });
    const antes = { NODE_ENV: process.env.NODE_ENV, L: process.env.LINKS_PAGO_EN_PRODUCCION, U: process.env.CRM_BASE_URL };
    process.env.NODE_ENV = 'production';
    delete process.env.LINKS_PAGO_EN_PRODUCCION;
    delete process.env.CRM_BASE_URL;
    try {
      await servicio.handleWebhookEvent(A, aviso(ch));
    } finally {
      process.env.NODE_ENV = antes.NODE_ENV;
      if (antes.L !== undefined) process.env.LINKS_PAGO_EN_PRODUCCION = antes.L;
      if (antes.U !== undefined) process.env.CRM_BASE_URL = antes.U;
    }
    const sp = await filaCargo(A, ch.id);
    // Por el correo, como siempre: a la venta de la ficha, sin tocar el link.
    expect(sp.link_method).toBe('auto_email');
    expect(sp.conversion_id).toBe(venta);
    expect(sp.payment_link_id).toBeNull();
    expect((await linkDe(link.id)).estado).toBe('creado');
  });
});

// ─── 4. El aviso checkout.session.* ─────────────────────────────────────────

describe('los avisos de la sesión de Checkout', { timeout: 60_000 }, () => {
  const sesion = (link, type, extra = {}) => ({
    id: `evt_${MARCA}_${type}_${link.id}`,
    type,
    data: { object: {
      id: `cs_test_${MARCA}_${link.id}`, object: 'checkout.session', payment_link: link.stripe_payment_link_id,
      payment_intent: `pi_${MARCA}_${link.id}`, customer: `cus_${MARCA}`, payment_status: 'paid',
      amount_total: Math.round(Number(link.importe) * 100), currency: 'eur', metadata: marcaDelLink(link), ...extra,
    } },
  });

  it('completed: apunta la sesión, trae el cargo con la clave de lectura y lo cobra una sola vez', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const link = await nuevoLink(A, { leadId: lead, productId: prod.A, creador: p.gestora, importe: 1000 });
    const ch = { ...cargoDe(1000, { metadata: marcaDelLink(link) }), payment_intent: `pi_${MARCA}_${link.id}` };
    preparadas = [
      ['GET', '/v1/charges', 200, { data: [ch], has_more: false }],
      // Lo que ya hacía cualquier cargo asociado (#747): de qué suscripción viene. Este, de ninguna.
      ['GET', `/v1/charges/${ch.id}`, 200, { ...ch, invoice: null }],
    ];
    const ev = sesion(link, 'checkout.session.completed');
    const r = await servicio.handleWebhookEvent(A, ev);
    expect(r.processed).toBe('checkout.session.completed');
    // Solo lecturas, y el cargo se busca por el pago de la sesión.
    expect(llamadas.every((c) => c.metodo === 'GET')).toBe(true);
    expect(llamadas[0]).toMatchObject({ ruta: '/v1/charges', query: { payment_intent: `pi_${MARCA}_${link.id}` } });

    const l = await linkDe(link.id);
    expect(l).toMatchObject({
      estado: 'pagado', stripe_checkout_session_id: `cs_test_${MARCA}_${link.id}`,
      stripe_payment_intent_id: `pi_${MARCA}_${link.id}`, stripe_customer_id: `cus_${MARCA}`,
    });
    const venta = l.conversion_id;
    expect(await cobrosDe(venta)).toHaveLength(1);

    // Stripe reintenta el aviso y llega también el del cargo: ni otro cobro ni otro apunte.
    await servicio.handleWebhookEvent(A, ev);
    await servicio.handleWebhookEvent(A, aviso(ch));
    expect(await cobrosDe(venta)).toHaveLength(1);
    const tipos = (await eventosDe(link.id)).map((e) => e.tipo);
    expect(tipos.filter((t) => t === 'checkout_completado')).toHaveLength(1);
    expect(tipos.filter((t) => t === 'pagado')).toHaveLength(1);
  });

  it('expired: queda en el historial y el link pasa a «abierto»; no se pide nada a Stripe', async () => {
    const link = await nuevoLink(A, { leadId: await nuevoLead(A, p.gestora), productId: prod.A, creador: p.gestora });
    await servicio.handleWebhookEvent(A, sesion(link, 'checkout.session.expired', { payment_status: 'unpaid', payment_intent: null }));
    expect(llamadas).toHaveLength(0);
    expect((await linkDe(link.id)).estado).toBe('abierto');
    expect((await eventosDe(link.id)).map((e) => e.tipo)).toEqual(['sesion_caducada']);
  });

  it('un checkout sin la marca del CRM (la web, una plataforma) no se toca', async () => {
    const r = await servicio.handleWebhookEvent(A, { id: `evt_${MARCA}_web`, type: 'checkout.session.completed',
      data: { object: { id: 'cs_web', payment_status: 'paid', payment_intent: 'pi_web', metadata: { order_id: '1' } } } });
    expect(r.skipped).toMatch(/sin marca/);
    expect(llamadas).toHaveLength(0);
  });
});

// ─── 5. Crear: el tope contra lo pendiente ──────────────────────────────────

describe('crear un link desde una venta: el tope se mide contra lo pendiente', { timeout: 60_000 }, () => {
  const crear = (quien, cuerpo) => api.post('/api/links-pago').set(como(quien)).send(cuerpo);

  it('venta a medio pagar: lo pendiente no es un descuento; por debajo de lo pendiente, sí', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const venta = await nuevaVenta(A, lead, { total: 1000, producto: prod.A, vendedora: p.gestora });
    await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 600, CURRENT_DATE - 3)`, [venta]);

    stripeCreaBien();
    const ok = await crear(p.gestora, { conversionId: venta, productId: prod.A, importe: 400 });
    expect(ok.status).toBe(201);
    expect(Number(ok.body.data.descuento_pct)).toBe(0);
    const creado = (await eventosDe(ok.body.data.id))[0].datos;
    expect(creado).toMatchObject({ descuento_sobre: 'pendiente', pendiente: 400 });

    const r = await crear(p.gestora, { conversionId: venta, productId: prod.A, importe: 360 });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('DESCUENTO_MAXIMO');
    expect(r.body.error).toMatch(/pendiente de la venta \(400\.00 EUR\)/);

    await api.put('/api/links-pago/config').set(como(p.admin)).send({ projectId: A, descuento_max_pct: 10 });
    stripeCreaBien();
    const conTope = await crear(p.gestora, { conversionId: venta, productId: prod.A, importe: 360 });
    expect(conTope.status).toBe(201);
    expect(Number(conTope.body.data.descuento_pct)).toBe(10);
    await api.put('/api/links-pago/config').set(como(p.admin)).send({ projectId: A, descuento_max_pct: 0 });
  });

  it('venta sin nada pendiente: solo el admin', async () => {
    const lead = await nuevoLead(A, p.gestora);
    const venta = await nuevaVenta(A, lead, { total: 500, producto: prod.A, vendedora: p.gestora });
    await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 500, CURRENT_DATE)`, [venta]);
    const r = await crear(p.gestora, { conversionId: venta, productId: prod.A, importe: 100 });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SIN_PRECIO_COMPARABLE');
    expect(r.body.error).toMatch(/nada pendiente/);
    stripeCreaBien();
    expect((await crear(p.admin, { conversionId: venta, productId: prod.A, importe: 100 })).status).toBe(201);
  });

  it('desde un prospecto, el tope sigue siendo el catálogo', async () => {
    const lead = await nuevoLead(A, p.gestora);
    expect((await crear(p.gestora, { leadId: lead, productId: prod.A, importe: 999 })).body.code).toBe('DESCUENTO_MAXIMO');
  });

  it('el link y su cargo solo llevan la marca del CRM', async () => {
    const lead = await nuevoLead(A, p.gestora);
    stripeCreaBien();
    expect((await crear(p.gestora, { leadId: lead, productId: prod.A, importe: 1000 })).status).toBe(201);
    const link = llamadas.find((c) => c.ruta === '/v1/payment_links').cuerpo;
    expect(Object.keys(link).filter((k) => k.startsWith('payment_intent_data[metadata]')).every((k) => /\[crm_/.test(k))).toBe(true);
  });
});
