import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM-ISEIE#656 · Conciliación › Cargos de Stripe con «Todos los meses».
 *
 * En el staging de ISEIE, sin `mes`, la lista tardaba 71 s con 924 cargos sin
 * enlazar y Cloudflare cortaba con 504. Casi todo era `ventasDelAlumno`: cruzaba
 * cada cargo con cada venta del campus (924 × 489 = 452.000 parejas) y en cada
 * pareja volvía a normalizar el nombre del alumno (37 s). Ahora cada venta se
 * normaliza una vez y se comparan textos ya preparados: 0,47 s, con las mismas
 * 170 filas (comparado fila a fila en crm_iseie_staging el 23/11).
 *
 * «Hecho cuando: Todos los meses responde en menos de 5 s, con una prueba que lo cubra.»
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs --datos
 *   npx vitest run tests/conciliacionTodosLosMeses656.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { default: modulo } = await import('../src/modules/stripe-payments/index.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `C656${Date.now().toString(36)}`;
const marca = MARCA.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
let CAMPUS; let ADMIN;
const N = 600; // 600 cargos × 600 ventas = 360.000 parejas: con la consulta de antes, decenas de segundos
const c = {};
const v = {};

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

async function alumnaConVenta(nombre, email) {
  const l = await one(`INSERT INTO leads (project_id, nombre, email, status) VALUES ($1, $2, $3, 'convertido') RETURNING id`, [CAMPUS, nombre, email]);
  return one(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
              VALUES ($1, $2, $3, 900, 0, '2026-09-01') RETURNING id`, [l.id, CAMPUS, `${MARCA} Máster`]).then((r) => r.id);
}
const cargo = (nombre, { email = null, cliente = null, conversionId = null, fecha = '2026-10-15' } = {}) => one(
  `INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, customer_email, customer_name, stripe_created_at, conversion_id)
   VALUES ($1, $2, 'charge', 'succeeded', 300, 'EUR', $3, $4, ($5::date + interval '12 hours'), $6) RETURNING id`,
  [CAMPUS, `ch_${MARCA}_${nombre}`, email, cliente, fecha, conversionId]).then((r) => r.id);

beforeAll(async () => {
  const p = await one(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} campus`, `${marca}-campus`, `${MARCA}-k`]);
  ids.projects.push(p.id);
  CAMPUS = p.id;
  ADMIN = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id, role`,
    [`${MARCA} admin`, `admin@${marca}.test`]);
  ids.users.push(ADMIN.id);
  await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [ADMIN.id, CAMPUS]);

  // Relleno: N alumnas con su venta y N cargos de otra gente, repartidos en varios meses.
  await q(
    `WITH l AS (
       INSERT INTO leads (project_id, nombre, email, status)
       SELECT $1, 'Relleno ' || g || ' Apellído', 'relleno' || g || '@' || $2 || '.test', 'convertido'
         FROM generate_series(1, $3::int) g
       RETURNING id)
     INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
     SELECT id, $1, 'Relleno', 500, 0, '2026-06-01' FROM l`,
    [CAMPUS, marca, N]);
  await q(
    `INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, customer_email, customer_name, stripe_created_at)
     SELECT $1, 'ch_' || $2 || '_r' || g, 'charge', 'succeeded', 77, 'EUR', 'otra' || g || '@' || $2 || '.test',
            'Otra Persona ' || g, DATE '2026-01-01' + (g % 300)
       FROM generate_series(1, $3::int) g`,
    [CAMPUS, marca, N]);

  // Las que tienen que seguir encontrándose, como antes.
  v.correo = await alumnaConVenta('Lucía Pérez', `lucia@${marca}.test`);
  v.nombre = await alumnaConVenta('María José Núñez Gómez', null);
  v.apuntada = await alumnaConVenta('Alguien Distinto', `distinto@${marca}.test`);
  c.correo = await cargo('correo', { email: `  LUCIA@${marca}.test `, fecha: '2026-03-02' });
  c.nombre = await cargo('nombre', { cliente: 'maria jose nunez', fecha: '2026-07-20' });
  c.apuntada = await cargo('apuntada', { conversionId: v.apuntada, cliente: 'Nadie', fecha: '2026-10-05' });
}, 120_000);

afterAll(async () => {
  const ventas = 'SELECT id FROM conversions WHERE project_id = ANY($1::int[])';
  for (const [sql, val] of [
    ['DELETE FROM stripe_payments WHERE project_id = ANY($1::int[])', ids.projects],
    [`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`, ids.projects],
    ['DELETE FROM conversions WHERE project_id = ANY($1::int[])', ids.projects],
    ['DELETE FROM lead_status_history WHERE lead_id IN (SELECT id FROM leads WHERE project_id = ANY($1::int[]))', ids.projects],
    ['DELETE FROM leads WHERE project_id = ANY($1::int[])', ids.projects],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', ids.users],
    ['DELETE FROM users WHERE id = ANY($1::int[])', ids.users],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', ids.projects],
  ]) await pool.query(sql, [val]).catch(() => {});
});

describe('#656 · «Todos los meses» con cientos de cargos y de ventas', { timeout: 60_000 }, () => {
  let res; let ms;
  beforeAll(async () => {
    const t = Date.now();
    res = await request.get(`/api/stripe-payments/conciliacion?projectId=${CAMPUS}`).set(como(ADMIN));
    ms = Date.now() - t;
  }, 60_000);

  it('responde en menos de 5 s (antes, decenas de segundos y 504)', () => {
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(ms).toBeLessThan(5000);
    expect(res.body.data.cargos.length).toBe(N + 3);
  });

  const fila = (id) => res.body.data.cargos.find((x) => x.id === id);

  it('sigue encontrando la venta por el correo (sin mirar mayúsculas ni espacios)', () => {
    expect(fila(c.correo).ventas.map((x) => [x.id, x.por])).toEqual([[v.correo, 'correo']]);
    expect(fila(c.correo).sugerencia).toBe('apuntar');
  });

  it('y por el nombre sin tildes, cuando uno empieza por el otro', () => {
    expect(fila(c.nombre).ventas.map((x) => [x.id, x.por])).toEqual([[v.nombre, 'nombre']]);
  });

  it('y la venta que el cargo ya tiene apuntada, aunque el nombre no case', () => {
    expect(fila(c.apuntada).ventas.map((x) => [x.id, x.por])).toEqual([[v.apuntada, 'venta']]);
  });

  it('los cargos de otra gente no se emparejan con ninguna venta', () => {
    const otros = res.body.data.cargos.filter((x) => ![c.correo, c.nombre, c.apuntada].includes(x.id));
    expect(otros.every((x) => x.ventas.length === 0)).toBe(true);
  });
});
