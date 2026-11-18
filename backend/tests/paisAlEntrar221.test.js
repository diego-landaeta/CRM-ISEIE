import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool from '../src/shared/config/db.js';
import informes from '../src/modules/reports/index.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';
import { rellenarPaisOrigen } from '../src/modules/leads/pais.relleno.js';

/**
 * #221 de punta a punta, contra la base: el prospecto entra por el webhook del
 * CRM o por Make, sale con su país, y los filtros de Prospectos, Ventas e
 * Informes lo encuentran. La regla sola está en paisPorSubdominio221.test.js.
 *
 * Un campus y un superadmin propios de la prueba: la base de ISEIE (y la de la
 * CI) no trae los campus de ejemplo de MultiCRM.
 */

const request = supertest(app);
const MARCA = `pais221-${Date.now().toString(36)}`;
const DOMINIO = 'test-pais221.com';
const MAKE_SLUG = `mk_${MARCA}`;
const MAKE_SECRET = 'msk_pais221_prueba';
let apiKey;
let projectId;
let userId;
let auth;
let n = 0;

beforeAll(async () => {
  const { rows: [p] } = await pool.query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, paises_por_subdominio)
     VALUES ($1, $1, $2, $3) RETURNING id, webhook_api_key`,
    [MARCA, `${MARCA}-key`, JSON.stringify({ cl: 'CL', mx: 'MX' })]);
  ({ id: projectId, webhook_api_key: apiKey } = p);
  const { rows: [u] } = await pool.query(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ('Prueba 221', $1, 'x', 'superadmin') RETURNING id`,
    [`super@${DOMINIO}`]);
  userId = u.id;
  await pool.query('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [userId, projectId]);
  auth = { Authorization: `Bearer ${jwt.sign({ userId, role: 'superadmin' }, process.env.JWT_SECRET, { expiresIn: '10m' })}` };
  // Un webhook de Make con mapeo guardado y SIN landing_url: el caso de casi todos.
  await pool.query(
    `INSERT INTO make_webhooks (project_id, slug, label, secret, mode, field_mapping)
     VALUES ($1, $2, 'PRUEBA #221', $3, 'active', $4)`,
    [projectId, MAKE_SLUG, MAKE_SECRET, JSON.stringify({ email: 'email', nombre: 'full_name', telefono: 'phone_complete' })]);
});

afterAll(async () => {
  const ids = `(SELECT id FROM leads WHERE email LIKE '%@${DOMINIO}')`;
  for (const t of ['lead_utms', 'lead_interactions', 'lead_reminders', 'lead_status_history']) {
    await pool.query(`DELETE FROM ${t} WHERE lead_id IN ${ids}`).catch(() => {});
  }
  await pool.query(`DELETE FROM make_webhook_deliveries WHERE webhook_id IN (SELECT id FROM make_webhooks WHERE slug = $1)`, [MAKE_SLUG]).catch(() => {});
  await pool.query('DELETE FROM make_webhooks WHERE slug = $1', [MAKE_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM leads WHERE email LIKE '%@${DOMINIO}'`).catch(() => {});
  await pool.query('DELETE FROM user_projects WHERE user_id = $1', [userId]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
  await pool.query('DELETE FROM projects WHERE id = $1', [projectId]).catch(() => {});
  await pool.end();
});

const paisDe = async (leadId) => (await pool.query('SELECT pais_origen, landing_url FROM leads WHERE id = $1', [leadId])).rows[0];

/** Alta por el webhook del CRM con lo que se pase; devuelve lo guardado. */
async function entra(extra) {
  n += 1;
  const res = await request.post(`/api/leads/webhooks/${MARCA}`).set('X-API-Key', apiKey).send({
    nombre: `País ${n}`, email: `pais${n}-${Date.now()}@${DOMINIO}`, telefono: `+3460009${String(1000 + n)}`, ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { leadId: res.body.data.lead_id, ...(await paisDe(res.body.data.lead_id)) };
}

describe('al entrar, con su dirección', () => {
  it('cl. → CL', async () => {
    expect((await entra({ landing_url: 'https://cl.fonoaprende.com/curso/?utm_source=fb' })).pais_origen).toBe('CL');
  });

  it('con la página en page_url, como la manda Elementor → MX, y se guarda la dirección', async () => {
    const r = await entra({ page_url: 'https://mx.fonoaprende.com/curso/' });
    expect(r.pais_origen).toBe('MX');
    expect(r.landing_url).toBe('https://mx.fonoaprende.com/curso/');
  });

  it('dominio raíz, www. o un prefijo sin configurar → sin país', async () => {
    expect((await entra({ landing_url: 'https://fonoaprende.com/curso/' })).pais_origen).toBeNull();
    expect((await entra({ landing_url: 'https://www.fonoaprende.com/curso/' })).pais_origen).toBeNull();
    expect((await entra({ landing_url: 'https://pe.fonoaprende.com/curso/' })).pais_origen).toBeNull();
  });

  it('sin dirección → sin país, y el alta sigue igual', async () => {
    expect((await entra({})).pais_origen).toBeNull();
  });
});

describe('al entrar por Make', () => {
  it('el mapeo no tiene landing_url pero el envío trae page_url → se usa, y entra con país', async () => {
    const res = await request.post(`/api/webhooks/make/${MAKE_SLUG}`).set('X-Make-Secret', MAKE_SECRET).send({
      full_name: 'Make País', email: `make-${Date.now()}@${DOMINIO}`, phone_complete: '+56900000001',
      page_url: 'https://cl.fonoaprende.com/curso/',
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const r = await paisDe(res.body.data.lead_id);
    expect(r).toMatchObject({ pais_origen: 'CL', landing_url: 'https://cl.fonoaprende.com/curso/' });
  });
});

describe('los filtros', () => {
  it('Prospectos: paisEntrada=CL solo trae los de Chile; sin_pais, los que no tienen', async () => {
    const cl = await request.get(`/api/leads?projectId=${projectId}&paisEntrada=CL&limit=100`).set(auth);
    expect(cl.status, JSON.stringify(cl.body)).toBe(200);
    expect(cl.body.data.length).toBeGreaterThan(0);
    expect(cl.body.data.every((l) => l.pais_origen === 'CL')).toBe(true);

    const sin = await request.get(`/api/leads?projectId=${projectId}&paisEntrada=sin_pais&limit=100`).set(auth);
    expect(sin.body.data.length).toBeGreaterThan(0);
    expect(sin.body.data.every((l) => l.pais_origen === null)).toBe(true);

    const mal = await request.get(`/api/leads?projectId=${projectId}&paisEntrada=Chile`).set(auth);
    expect(mal.status).toBe(400);
  });

  it('Informes: por campus y país, y las descargas filtradas por país', async () => {
    // Informes va en su propio bundle, que la instalación por defecto puede no
    // registrar: se monta aparte, como en baremoTasaCierre.test.js.
    const informesApp = express();
    informesApp.use(express.json());
    informesApp.use(informes.prefix, informes.router);
    informesApp.use(errorHandler);
    const req = supertest(informesApp);
    // «Hoy» en hora de Madrid, como cuenta el informe: en UTC, entre las 23:00 y las 00:00 caía en otro día.
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
    const r = await req.get(`/api/informes/paises-entrada?projectId=${projectId}&from=${hoy}&to=${hoy}`).set(auth);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const chile = r.body.data.find((f) => f.pais === 'CL' && f.project_id === projectId);
    expect(chile?.leads).toBeGreaterThanOrEqual(2);

    const d = await req.get(`/api/informes/prospectos?projectId=${projectId}&from=${hoy}&to=${hoy}&paisEntrada=MX`).set(auth);
    expect(d.status).toBe(200);
    expect(d.body.data.length).toBeGreaterThan(0);
    expect(d.body.data.every((f) => f.pais_entrada === 'MX')).toBe(true);
  });

  it('Ventas: el resumen acepta el filtro', async () => {
    const r = await request.get(`/api/ventas/resumen?projectId=${projectId}&paisEntrada=CL`).set(auth);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(typeof r.body.data.ventas).toBe('number');
  });
});

describe('Configuración del campus', () => {
  it('la tabla se guarda limpia y se devuelve con el campus (quien tiene projects.edit)', async () => {
    const p = await request.patch(`/api/projects/${projectId}`).set(auth).send({ paises_por_subdominio: { CL: 'cl', mx: 'MX' } });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const g = await request.get(`/api/projects/${projectId}`).set(auth);
    expect(g.body.data.paises_por_subdominio).toEqual({ cl: 'CL', mx: 'MX' });
    const mal = await request.patch(`/api/projects/${projectId}`).set(auth).send({ paises_por_subdominio: { www: 'ES' } });
    expect(mal.status).toBe(400);
  });
});

describe('el guion de reparación, en simulación', () => {
  it('encuentra al que entró sin país y NO escribe nada', async () => {
    // Uno de antes: con su dirección de Chile pero sin país (como los que ya estaban).
    const { rows: [l] } = await pool.query(
      `INSERT INTO leads (project_id, nombre, email, landing_url) VALUES ($1, 'Antiguo', $2, 'https://cl.fonoaprende.com/viejo/') RETURNING id`,
      [projectId, `antiguo-${Date.now()}@${DOMINIO}`]);
    const r = await rellenarPaisOrigen(pool, { aplicar: false, campus: projectId });
    expect(r.aplicado).toBe(false);
    expect(r.cambios).toContainEqual(expect.objectContaining({ lead_id: l.id, pais: 'CL', fuente: 'ficha' }));
    expect((await paisDe(l.id)).pais_origen).toBeNull();
  });
});
