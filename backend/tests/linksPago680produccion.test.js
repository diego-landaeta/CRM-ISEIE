import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Links de pago (#407, gemela de CRM#680) antes de producción (CRM#870):
 *
 *   0. La migración 316 (la 303 de MultiCRM): cada campus admite también las
 *      monedas en que ya cobra.
 *
 *   1. `/auth/me` le dice a la pantalla si el servidor tiene los links
 *      encendidos (`user.funciones.links_pago`). En producción, solo con
 *      LINKS_PAGO_EN_PRODUCCION=1; en /staging y en local, siempre. Antes la
 *      pantalla miraba `SOLO_EN_PRUEBAS` y en producción no salía nunca.
 *
 * Lo de las cuentas de Stripe compartidas (la marca de plataforma de CRM#870) no
 * viene: en ISEIE cada campus tiene su propia cuenta y no hay `filtro_metadata`.
 *
 *   npx vitest run tests/linksPago680produccion.test.js
 */

process.env.LOG_LEVEL = 'silent';
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { default: auth } = await import('../src/modules/auth/index.js');

const app = express();
app.use(express.json());
app.use(auth.prefix, auth.router);
app.use(errorHandler);
const api = supertest(app);

const MARCA = `LP680PR${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], products: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

let D; let F;
let gestora;

beforeAll(async () => {
  const campus = async (n) => {
    const r = await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${n}`, `${MARCA.toLowerCase()}-${n}`, `${MARCA}-k-${n}`]);
    ids.projects.push(r.id);
    return r.id;
  };
  D = await campus('d');
  F = await campus('f');

  gestora = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', \'gestor\') RETURNING id, role',
    [`${MARCA} gestora`, `gestora@${MARCA.toLowerCase()}.test`]);
  ids.users.push(gestora.id);
  for (const c of [D, F]) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [gestora.id, c]);
}, 60_000);

afterAll(async () => {
  const limpiar = [
    ['DELETE FROM stripe_payments WHERE project_id = ANY($1)', ids.projects],
    ['DELETE FROM products WHERE id = ANY($1)', ids.products],
    ['DELETE FROM user_projects WHERE user_id = ANY($1)', ids.users],
    ['DELETE FROM refresh_tokens WHERE user_id = ANY($1)', ids.users],
    ['DELETE FROM users WHERE id = ANY($1)', ids.users],
    ['DELETE FROM projects WHERE id = ANY($1)', ids.projects],
  ];
  for (const [sql, lista] of limpiar) {
    try { await q(sql, [lista]); } catch { /* el siguiente sigue */ }
  }
});

// ─── 0. Las monedas de arranque (migración 316) ─────────────────────────────

describe('la migración 316: cada campus admite las monedas en que ya cobra', () => {
  const AQUI = path.dirname(fileURLToPath(import.meta.url));
  const leerSql = () => fs.readFileSync(path.join(AQUI, '../migrations/316_links_pago_monedas_del_campus.sql'), 'utf8');
  /*
    La 316 recorre TODOS los campus. Pasada tal cual, tocaría los de las otras
    pruebas que corren a la vez (la de la fase 2 tiene un curso en USD y espera
    {EUR}). Así que, en esta conexión y solo en ella, `products` y
    `stripe_payments` se tapan con tablas temporales con las filas de D y F: las
    temporales van antes en la ruta de búsqueda de Postgres, y la migración, que
    no pone esquema, lee esas. `projects` sí es la de verdad.
  */
  async function aplicar() {
    const SQL_316 = leerSql();
    const c = await pool.connect();
    try {
      await c.query('SELECT pg_advisory_lock(680680)');
      await c.query('DROP TABLE IF EXISTS pg_temp.products, pg_temp.stripe_payments');
      await c.query('CREATE TEMP TABLE products AS SELECT * FROM public.products WHERE project_id = ANY($1)', [[D, F]]);
      await c.query('CREATE TEMP TABLE stripe_payments AS SELECT * FROM public.stripe_payments WHERE project_id = ANY($1)', [[D, F]]);
      await c.query(SQL_316);
    } finally {
      await c.query('DROP TABLE IF EXISTS pg_temp.products, pg_temp.stripe_payments').catch(() => {});
      await c.query('SELECT pg_advisory_unlock(680680)').catch(() => {});
      c.release();
    }
  }
  const monedas = (id) => one('SELECT links_pago_monedas::text[] AS m, links_pago_moneda_defecto AS d FROM projects WHERE id = $1', [id]);

  it('añade la del catálogo y la de los cargos de Stripe, deja EUR por defecto, y se puede pasar dos veces', async () => {
    const cursoUsd = await one('INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, 200, \' usd \') RETURNING id', [F, `${MARCA} en dólares`]);
    ids.products.push(cursoUsd.id);
    // Uno sin precio o inactivo no cuenta.
    const sinPrecio = await one('INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, NULL, \'GBP\') RETURNING id', [F, `${MARCA} sin precio`]);
    ids.products.push(sinPrecio.id);
    await q(`INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, metadata, stripe_created_at)
             VALUES ($1, $2, 'charge', 'succeeded', 10, 'EUR', $3, $4)`,
    [F, `ch_${MARCA}_mxn`, JSON.stringify({ original_amount: 200, original_currency: 'MXN' }), new Date().toISOString()]);

    await aplicar();
    expect(await monedas(F)).toEqual({ m: ['EUR', 'MXN', 'USD'], d: 'EUR' });
    // Un campus que solo cobra en euros, como estaba.
    expect(await monedas(D)).toEqual({ m: ['EUR'], d: 'EUR' });

    await aplicar();
    expect((await monedas(F)).m).toEqual(['EUR', 'MXN', 'USD']);
  });
});

// ─── 1. /auth/me dice si el servidor tiene los links ────────────────────────

describe('/auth/me: los links de pago, según el interruptor del servidor', () => {
  const ENV = ['NODE_ENV', 'CRM_BASE_URL', 'LINKS_PAGO_EN_PRODUCCION'];
  async function conEntorno(valores) {
    const antes = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    Object.assign(process.env, valores);
    for (const k of ENV) if (valores[k] === undefined) delete process.env[k];
    try {
      const r = await api.get('/api/auth/me').set(como(gestora));
      expect(r.status).toBe(200);
      return r.body.data.user.funciones;
    } finally {
      for (const k of ENV) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; }
    }
  }

  it('producción sin el interruptor: apagados', async () => {
    expect(await conEntorno({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com' }))
      .toMatchObject({ links_pago: false });
  });

  it('producción con LINKS_PAGO_EN_PRODUCCION=1: encendidos', async () => {
    expect(await conEntorno({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com', LINKS_PAGO_EN_PRODUCCION: '1' }))
      .toMatchObject({ links_pago: true });
  });

  it('/staging y local: encendidos sin tocar nada', async () => {
    expect(await conEntorno({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com/staging' })).toMatchObject({ links_pago: true });
    expect(await conEntorno({ NODE_ENV: 'test' })).toMatchObject({ links_pago: true });
  });
});
