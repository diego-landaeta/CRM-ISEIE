import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Seguimiento de los links de pago que no se pagan (gemela de CRM#984, #659; Diego, 21/11/2026).
 *
 *   · la migración 322 se pasa dos veces;
 *   · un link «creado» con una sesión de Checkout en Stripe pasa a «abierto» con
 *     la hora de la primera; sin sesiones, sigue igual;
 *   · abierto y sin pagar desde hace más de las horas del campus: aviso a quien
 *     lo creó en la campana, una sola vez;
 *   · recordatorio al alumno a las 24 h y a las 72 h, por correo con la plantilla
 *     y la marca del campus, una vez cada uno y solo dentro de su ventana;
 *   · «Renovar» un caducado: un link nuevo igual, atado al viejo, una sola vez;
 *     lo que no está caducado o es ajeno, no;
 *   · el interruptor: apagado en producción salvo LINKS_PAGO_SEGUIMIENTO_EN_PRODUCCION=1,
 *     y el de WhatsApp apagado en todas partes salvo =1.
 *
 * Stripe y Brevo son de mentira.
 *
 *   npx vitest run tests/linksPagoSeguimiento659.test.js
 */

process.env.LOG_LEVEL = 'silent';
const correos = [];
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendEmail: vi.fn(async (c) => { correos.push(c); return { sent: true }; }),
}));

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const integrationsModel = await import('../src/modules/integrations/integrations.model.js');
const { default: linksPago } = await import('../src/modules/links-pago/index.js');
const seguimiento = await import('../src/modules/links-pago/links-pago.seguimiento.js');
const { armarRecordatorio, avisoGestora, textoRecordatorioWhatsapp } = await import('../src/modules/links-pago/links-pago.seguimiento.emails.js');
const { seguimientoLinksActivo, recordatorioWhatsappActivo } = await import('../src/shared/config/soloEnPruebas.js');

// ─── Stripe de mentira ──────────────────────────────────────────────────────
let preparadas = [];
const llamadas = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = vi.fn(async (url, opciones = {}) => {
  const metodo = (opciones.method || 'GET').toUpperCase();
  const u = new URL(String(url));
  llamadas.push({ metodo, ruta: u.pathname, query: Object.fromEntries(u.searchParams) });
  const r = preparadas.find(([m, trozo]) => m === metodo && (trozo instanceof RegExp ? trozo.test(u.pathname) : u.pathname === trozo));
  if (!r) throw new Error(`Stripe de mentira: sin respuesta para ${metodo} ${u.pathname}`);
  const [, , status, body] = r;
  return { ok: status < 400, status, json: async () => (typeof body === 'function' ? body(u) : body ?? {}) };
});
let n = 0;

const app = express();
app.use(express.json());
app.use(linksPago.prefix, linksPago.router);
app.use(errorHandler);
const api = supertest(app);

const MARCA = `LP984${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], leads: [], products: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const CLAVE_RK = 'rk_' + 'test_EscrituraDeMentira984';

const SQL_322 = fs.readFileSync(path.join(AQUI, '../migrations/322_links_pago_seguimiento.sql'), 'utf8');

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

let A; let B;
const p = {};
const lead = {};
let curso;

/** Un link puesto a mano, con la edad que haga falta. */
async function link({ campus = A, leadId = lead.a, creador = p.gestora, estado = 'creado', horas = 1, caducaEnDias = 5, abiertoHaceHoras = null, importe = 500 } = {}) {
  n += 1;
  return one(
    `INSERT INTO payment_links (project_id, lead_id, product_id, created_by, precio_catalogo, importe, moneda, estado, url,
        stripe_payment_link_id, created_at, caduca_el, abierto_el)
     VALUES ($1, $2, $3, $4, 500, $5, 'EUR', $6, $7, $8, NOW() - make_interval(hours => $9),
             NOW() + make_interval(days => $10), CASE WHEN $11::int IS NULL THEN NULL ELSE NOW() - make_interval(hours => $11::int) END)
     RETURNING *`,
    [campus, leadId, curso, creador.id, importe, estado, `https://buy.stripe.com/test_984_${n}`, `plink_984_${MARCA}_${n}`,
      horas, caducaEnDias, abiertoHaceHoras]);
}

beforeAll(async () => {
  await aplicarMigracion(SQL_322);
  const campus = async (x) => {
    const r = await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${x}`, `${MARCA.toLowerCase()}-${x}`, `${MARCA}-k-${x}`]);
    ids.projects.push(r.id);
    return r.id;
  };
  A = await campus('a');
  B = await campus('b');
  const persona = async (x, role, suyos) => {
    const u = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', $3) RETURNING id, role',
      [`${MARCA} ${x}`, `${x}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  p.gestora = await persona('gestora', 'gestor', [A]);
  p.otra = await persona('otra', 'gestor', [A]);
  p.gestoraB = await persona('gestora-b', 'gestor', [B]);
  const nuevoLead = async (c, nombre, email, responsable) => {
    const l = await one('INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [c, nombre, email, responsable.id]);
    ids.leads.push(l.id);
    return l.id;
  };
  lead.a = await nuevoLead(A, 'Laura Pruebas', `laura@${MARCA.toLowerCase()}.test`, p.gestora);
  lead.sinCorreo = await nuevoLead(A, 'Sin Correo', null, p.gestora);
  curso = (await one('INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, 500, \'EUR\') RETURNING id',
    [A, `${MARCA} Psicopedagogía`])).id;
  ids.products.push(curso);
  const e = encrypt(CLAVE_RK);
  await integrationsModel.upsert({ projectId: A, provider: 'stripe_links', active: true, encrypted_value: e.encrypted, iv: e.iv, auth_tag: e.authTag, config_public: {} });
}, 60_000);

afterAll(async () => {
  const limpiar = [
    ["DELETE FROM admin_notifications WHERE type = 'link_pago_abierto' AND target_user_ids && $1::int[]", ids.users],
    ['UPDATE payment_links SET renovado_de = NULL, renovado_por = NULL WHERE project_id = ANY($1)', ids.projects],
    ['DELETE FROM payment_links WHERE project_id = ANY($1)', ids.projects],
    ['DELETE FROM products WHERE id = ANY($1)', ids.products],
    ['DELETE FROM project_integrations WHERE project_id = ANY($1)', ids.projects],
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

beforeEach(async () => {
  llamadas.length = 0; preparadas = []; correos.length = 0;
  // Cada prueba empieza sin links: los de las demás no cuentan.
  await q('UPDATE payment_links SET renovado_de = NULL, renovado_por = NULL WHERE project_id = ANY($1)', [ids.projects]);
  await q('DELETE FROM payment_links WHERE project_id = ANY($1)', [ids.projects]);
});

// El seguimiento mira los links de toda la base: los vivos que no son de estas
// pruebas se dan por revisados y avisados, para que la vuelta solo vea los de aquí.
async function vueltaDeAqui(paso) {
  const otros = (await q("SELECT id FROM payment_links WHERE estado IN ('creado','abierto') AND NOT (project_id = ANY($1))", [ids.projects])).map((r) => r.id);
  // Los de fuera, «revisados ahora» y con sus avisos puestos, para que la vuelta no los vea.
  if (otros.length) {
    await q(`UPDATE payment_links SET sesiones_revisadas_el = NOW(),
               aviso_gestora_el = COALESCE(aviso_gestora_el, NOW()),
               recordatorio_24h_el = COALESCE(recordatorio_24h_el, NOW()),
               recordatorio_72h_el = COALESCE(recordatorio_72h_el, NOW())
             WHERE id = ANY($1)`, [otros]);
  }
  return paso();
}

describe('la migración 322', () => {
  it('se puede pasar otra vez y deja los valores de serie en el campus', async () => {
    await aplicarMigracion(SQL_322);
    const c = await one('SELECT links_pago_aviso_abierto_horas AS h, links_pago_recordatorios AS r FROM projects WHERE id = $1', [A]);
    expect(c).toEqual({ h: 2, r: true });
    await expect(q('UPDATE projects SET links_pago_aviso_abierto_horas = 0 WHERE id = $1', [A])).rejects.toThrow(/aviso_abierto_rango/);
  });
});

describe('1 · ¿lo ha abierto?', () => {
  it('con una sesión de Checkout pasa a «abierto» con la hora de la primera; sin sesiones, sigue «creado»', async () => {
    const abierto = await link();
    const cerrado = await link();
    const t = Math.floor(Date.now() / 1000) - 3600;
    preparadas = [['GET', '/v1/checkout/sessions', 200, (u) => (
      u.searchParams.get('payment_link') === abierto.stripe_payment_link_id
        ? { data: [{ id: 'cs_1', created: t + 60 }, { id: 'cs_2', created: t }] }
        : { data: [] })]];
    const r = await vueltaDeAqui(() => seguimiento.revisarAperturas());
    expect(r.abiertos).toBe(1);
    const a = await one('SELECT estado, abierto_el, sesiones_revisadas_el FROM payment_links WHERE id = $1', [abierto.id]);
    expect(a.estado).toBe('abierto');
    expect(Math.round(new Date(a.abierto_el).getTime() / 1000)).toBe(t);
    const c = await one('SELECT estado, abierto_el, sesiones_revisadas_el FROM payment_links WHERE id = $1', [cerrado.id]);
    expect(c.estado).toBe('creado');
    expect(c.abierto_el).toBeNull();
    expect(c.sesiones_revisadas_el).not.toBeNull();
    const ev = await q("SELECT tipo FROM payment_link_eventos WHERE link_id = $1 AND tipo = 'abierto'", [abierto.id]);
    expect(ev).toHaveLength(1);
    // Solo lee en Stripe: ningún POST.
    expect(llamadas.every((x) => x.metodo === 'GET')).toBe(true);
  });

  it('si Stripe falla, el link sigue igual y se reintenta', async () => {
    const l = await link();
    preparadas = [['GET', '/v1/checkout/sessions', 500, { error: { message: 'caído' } }]];
    const r = await vueltaDeAqui(() => seguimiento.revisarAperturas());
    expect(r.fallos).toBeGreaterThanOrEqual(1);
    expect((await one('SELECT estado FROM payment_links WHERE id = $1', [l.id])).estado).toBe('creado');
  });
});

describe('2 · el aviso a la gestora', () => {
  it('abierto hace más de las horas del campus: «Laura abrió el link de … y no pagó», una vez', async () => {
    const viejo = await link({ estado: 'abierto', horas: 5, abiertoHaceHoras: 3 });
    const reciente = await link({ estado: 'abierto', horas: 2, abiertoHaceHoras: 1 });
    const r = await vueltaDeAqui(() => seguimiento.avisarGestoras());
    expect(r.avisos).toBe(1);
    const avisos = await q("SELECT title, target_user_ids, link_path, metadata FROM admin_notifications WHERE type = 'link_pago_abierto' AND (metadata->>'payment_link_id')::int = ANY($1)",
      [[viejo.id, reciente.id]]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].title).toBe(`Laura Pruebas abrió el link de ${MARCA} Psicopedagogía y no pagó`);
    expect(avisos[0].target_user_ids).toEqual([p.gestora.id]);
    expect(avisos[0].link_path).toBe(`/leads/${lead.a}`);
    // La segunda vuelta no repite.
    await vueltaDeAqui(() => seguimiento.avisarGestoras());
    expect(await q("SELECT 1 FROM admin_notifications WHERE type = 'link_pago_abierto' AND (metadata->>'payment_link_id')::int = $1", [viejo.id])).toHaveLength(1);
  });

  it('las horas son las del campus', async () => {
    await q('UPDATE projects SET links_pago_aviso_abierto_horas = 6 WHERE id = $1', [A]);
    try {
      await link({ estado: 'abierto', horas: 5, abiertoHaceHoras: 3 });
      expect((await vueltaDeAqui(() => seguimiento.avisarGestoras())).avisos).toBe(0);
    } finally {
      await q('UPDATE projects SET links_pago_aviso_abierto_horas = 2 WHERE id = $1', [A]);
    }
  });
});

describe('3 · los recordatorios al alumno', () => {
  it('a las 24 h, por correo con la marca del campus, una vez', async () => {
    const l = await link({ horas: 25 });
    const r = await vueltaDeAqui(() => seguimiento.recordar());
    expect(r['24h']).toBe(1);
    expect(correos).toHaveLength(1);
    const c = correos[0];
    expect(c.to[0].email).toBe(`laura@${MARCA.toLowerCase()}.test`);
    expect(c.projectId).toBe(A);
    expect(c.clave).toBe(`link-pago-${l.id}-recordatorio-24h`);
    expect(c.htmlContent).toContain(l.url);
    expect(c.htmlContent).toContain('Pagar ahora');
    expect(c.subject).toContain('sigue disponible');
    await vueltaDeAqui(() => seguimiento.recordar());
    expect(correos).toHaveLength(1);
    const ev = await one("SELECT datos FROM payment_link_eventos WHERE link_id = $1 AND tipo = 'recordatorio_24h'", [l.id]);
    expect(ev.datos.correo).toBe('enviado');
  });

  it('a las 72 h, el segundo; un link de hace cinco días no recibe ninguno', async () => {
    const l72 = await link({ horas: 73 });
    await link({ horas: 120 });
    await vueltaDeAqui(() => seguimiento.recordar());
    expect(correos).toHaveLength(1);
    expect(correos[0].clave).toBe(`link-pago-${l72.id}-recordatorio-72h`);
    expect(correos[0].subject).toContain('caduca pronto');
  });

  it('ni pagado, ni a punto de caducar, ni en un campus sin recordatorios; sin correo, se apunta', async () => {
    await link({ horas: 25, estado: 'pagado' });
    await link({ horas: 25, caducaEnDias: 0 });
    const sin = await link({ horas: 25, leadId: lead.sinCorreo });
    await vueltaDeAqui(() => seguimiento.recordar());
    expect(correos).toHaveLength(0);
    const ev = await one("SELECT datos FROM payment_link_eventos WHERE link_id = $1 AND tipo = 'recordatorio_24h'", [sin.id]);
    expect(ev.datos.correo).toBe('sin_correo');

    await q('UPDATE projects SET links_pago_recordatorios = false WHERE id = $1', [A]);
    try {
      await link({ horas: 26 });
      await vueltaDeAqui(() => seguimiento.recordar());
      expect(correos).toHaveLength(0);
    } finally {
      await q('UPDATE projects SET links_pago_recordatorios = true WHERE id = $1', [A]);
    }
  });

  it('los textos: correo con la plantilla, WhatsApp corto y el aviso a la gestora', () => {
    const l = {
      project_id: 1, campus: 'ISEIH', slug: 'iseih', lead_nombre: 'Laura Gómez', producto_nombre: 'Psicopedagogía',
      importe: 900, moneda: 'EUR', modalidad: 'unico', url: 'https://buy.stripe.com/x', caduca_el: '2026-11-28T10:00:00Z',
      abierto_el: '2026-11-21T09:30:00Z',
    };
    const c = armarRecordatorio({ l, cual: '24h' });
    expect(c.htmlContent).toContain('Laura');
    expect(c.htmlContent).toContain('900,00');
    expect(c.textContent).toContain('28/11/2026');
    const w = textoRecordatorioWhatsapp({ l, cual: '72h' });
    expect(w).toContain('Hola Laura');
    expect(w).toContain('https://buy.stripe.com/x');
    expect(avisoGestora(l).title).toBe('Laura Gómez abrió el link de Psicopedagogía y no pagó');
    // En cuotas, lo que se paga con el link es la primera.
    const cu = armarRecordatorio({ l: { ...l, modalidad: 'cuotas', num_cuotas: 3, importe_cuota: 300 }, cual: '24h' });
    expect(cu.htmlContent).toContain('300,00');
    expect(cu.htmlContent).toContain('primera cuota');
  });
});

describe('4 · renovar un caducado', () => {
  const renovar = (quien, id) => api.post(`/api/links-pago/${id}/renovar`).set(como(quien)).send({});

  it('crea uno nuevo igual, con la caducidad de serie, atado al viejo; dos veces, no', async () => {
    const viejo = await link({ estado: 'caducado', horas: 200, caducaEnDias: -1, importe: 450 });
    preparadas = [
      ['POST', '/v1/prices', 200, () => ({ id: `price_984_${++n}` })],
      ['POST', '/v1/payment_links', 200, () => ({ id: `plink_984_nuevo_${n}`, url: `https://buy.stripe.com/test_984_nuevo_${n}` })],
    ];
    const r = await renovar(p.gestora, viejo.id);
    expect(r.status).toBe(201);
    expect(r.body.data.estado).toBe('creado');
    expect(Number(r.body.data.importe)).toBe(450);
    expect(r.body.data.lead_id).toBe(lead.a);
    expect(r.body.data.renovado_de).toBe(viejo.id);
    const v = await one('SELECT estado, renovado_por FROM payment_links WHERE id = $1', [viejo.id]);
    expect(v).toEqual({ estado: 'caducado', renovado_por: r.body.data.id });
    const dias = (new Date(r.body.data.caduca_el) - Date.now()) / 86400000;
    expect(Math.round(dias)).toBe(7);

    const otra = await renovar(p.gestora, viejo.id);
    expect(otra.status).toBe(409);
    expect(otra.body.code).toBe('YA_RENOVADO');
  });

  it('lleva el precio de antes y el descuento del caducado (CRM#982)', async () => {
    const viejo = await link({ estado: 'caducado', importe: 500 });
    await q(`UPDATE payment_links SET precio_original = 600, descuento_tipo = 'monto', descuento_valor = 100, descuento_importe = 100
              WHERE id = $1`, [viejo.id]);
    preparadas = [
      ['POST', '/v1/prices', 200, () => ({ id: `price_984_${++n}` })],
      ['POST', '/v1/payment_links', 200, () => ({ id: `plink_984_desc_${n}`, url: `https://buy.stripe.com/test_984_desc_${n}` })],
    ];
    const r = await renovar(p.gestora, viejo.id);
    expect(r.status).toBe(201);
    const nuevo = await one('SELECT importe, precio_original, descuento_tipo, descuento_valor, descuento_importe FROM payment_links WHERE id = $1', [r.body.data.id]);
    expect(nuevo).toEqual({ importe: '500.00', precio_original: '600.00', descuento_tipo: 'monto', descuento_valor: '100.00', descuento_importe: '100.00' });
  });

  it('uno vivo no se renueva; uno de otra gestora o de otro campus, 404', async () => {
    const vivo = await link();
    expect((await renovar(p.gestora, vivo.id)).body.code).toBe('NO_RENOVABLE');
    const ajeno = await link({ estado: 'caducado', creador: p.gestora });
    expect((await renovar(p.otra, ajeno.id)).status).toBe(404);
    expect((await renovar(p.gestoraB, ajeno.id)).status).toBe(404);
    expect(llamadas).toHaveLength(0);
  });
});

describe('5 · la configuración del campus', () => {
  it('se leen y se guardan las horas del aviso y los recordatorios (quien configura)', async () => {
    const admin = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', \'admin\') RETURNING id, role',
      [`${MARCA} admin`, `admin@${MARCA.toLowerCase()}.test`]);
    ids.users.push(admin.id);
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [admin.id, A]);
    const r = await api.put('/api/links-pago/config').set(como(admin)).send({ projectId: A, aviso_abierto_horas: 4, recordatorios: false });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ aviso_abierto_horas: 4, recordatorios: false });
    const mal = await api.put('/api/links-pago/config').set(como(admin)).send({ projectId: A, aviso_abierto_horas: 100 });
    expect(mal.status).toBe(400);
    await api.put('/api/links-pago/config').set(como(admin)).send({ projectId: A, aviso_abierto_horas: 2, recordatorios: true });
    await q('DELETE FROM user_activity_log WHERE user_id = $1', [admin.id]);
  });
});

describe('6 · los interruptores', () => {
  it('seguimiento: apagado en producción salvo =1; encendido en /staging y en local', () => {
    expect(seguimientoLinksActivo({ NODE_ENV: 'production', LINKS_PAGO_EN_PRODUCCION: '1' })).toBe(false);
    expect(seguimientoLinksActivo({ NODE_ENV: 'production', LINKS_PAGO_EN_PRODUCCION: '1', LINKS_PAGO_SEGUIMIENTO_EN_PRODUCCION: '1' })).toBe(true);
    // Sin los links, nada.
    expect(seguimientoLinksActivo({ NODE_ENV: 'production', LINKS_PAGO_SEGUIMIENTO_EN_PRODUCCION: '1' })).toBe(false);
    expect(seguimientoLinksActivo({ NODE_ENV: 'production', CRM_BASE_URL: 'https://iseie.test/staging' })).toBe(true);
    expect(seguimientoLinksActivo({ NODE_ENV: 'development' })).toBe(true);
  });

  it('WhatsApp: apagado en todas partes salvo =1', () => {
    expect(recordatorioWhatsappActivo({ NODE_ENV: 'development' })).toBe(false);
    expect(recordatorioWhatsappActivo({ NODE_ENV: 'production', CRM_BASE_URL: 'https://iseie.test/staging' })).toBe(false);
    expect(recordatorioWhatsappActivo({ NODE_ENV: 'development', LINKS_PAGO_RECORDATORIO_WHATSAPP: '1' })).toBe(true);
  });
});
