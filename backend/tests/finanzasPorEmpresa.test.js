import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Finanzas por empresa (CRM-ISEIE#73 · diego-landaeta/CRM#157): con una EMPRESA
 * en vez de un campus, Por cobrar y Conversiones (la lista, sus tarjetas, el
 * filtro de cursos y la lista con fechas) suman los campus de esa empresa.
 *
 * Lo que tiene que cumplirse, con la base de verdad:
 *   · con una empresa de dos campus, la cifra es la suma de los dos;
 *   · no entra nada de un tercer campus de OTRA empresa, aunque quien mira
 *     también lleve ese campus (y estar en tres campus no multiplica nada);
 *   · quien no tiene uno de los dos campus no lo ve, y pedirlo es un 403.
 *
 * Antes, en ISEIE, las dos iban con el `projectId` de la dirección sin mirar de
 * quién era y, sin él, con todo el CRM. El 360 ya lo hacía; esta prueba es la
 * misma en los dos repos.
 *
 *   npx vitest run tests/finanzasPorEmpresa.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const modulos = await Promise.all(['accounting', 'conversions']
  .map((m) => import(`../src/modules/${m}/index.js`).then((x) => x.default)));

const app = express();
app.use(express.json());
for (const m of modulos) app.use(m.prefix, m.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `FPE${Date.now().toString(36)}`;
const marca = MARCA.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], issuers: [], leads: [], conversions: [] };

// La empresa con dos campus (A y B) y otra empresa con el suyo (C).
let EMPRESA; let OTRA; let A; let B; let C;
let SUPER; let ADMIN_ABC; let ADMIN_A;
const VENTA = { A: 100, B: 250, C: 1000 };
const VENTA_ID = {};
// Una fecha fija: la lista con fechas pide un periodo.
const DIA = '2026-03-15';
const PERIODO = 'from=2026-03-01&to=2026-03-31';

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const pedir = (u, ruta) => request.get(ruta).set(como(u));

async function persona(n, role, campus = []) {
  const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${marca}.test`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
  return u;
}

// Una venta sin cobrar: entera en Por cobrar.
async function venta(campus, clave) {
  const l = await one('INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id',
    [campus, `${MARCA} alumno ${clave}`, `alumno${clave.toLowerCase()}@${marca}.test`]);
  ids.leads.push(l.id);
  const v = await one(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
     VALUES ($1, $2, $3, $4, 0, $5) RETURNING id`, [l.id, campus, `${MARCA} curso ${clave}`, VENTA[clave], DIA]);
  ids.conversions.push(v.id);
  VENTA_ID[clave] = Number(v.id);
}

beforeAll(async () => {
  const empresa = async (n) => {
    const e = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id',
      [`${MARCA} ${n}`, `B${n}${Date.now().toString().slice(-7)}`]);
    ids.issuers.push(e.id);
    return e.id;
  };
  const campus = async (n, issuer) => {
    const p = await one('INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [`${MARCA} ${n}`, `${marca}-${n}`, `${MARCA}-k-${n}`, issuer]);
    ids.projects.push(p.id);
    return Number(p.id);
  };
  EMPRESA = await empresa('emp');
  OTRA = await empresa('otra');
  A = await campus('a', EMPRESA);
  B = await campus('b', EMPRESA);
  C = await campus('c', OTRA);

  SUPER = await persona('Super', 'superadmin');
  ADMIN_ABC = await persona('AdminAbc', 'admin', [A, B, C]);
  ADMIN_A = await persona('AdminA', 'admin', [A]);

  await venta(A, 'A');
  await venta(B, 'B');
  await venta(C, 'C');
}, 60000);

afterAll(async () => {
  const intenta = (sql, p) => q(sql, p).catch(() => {});
  await intenta('DELETE FROM conversion_installments WHERE conversion_id = ANY($1::int[])', [ids.conversions]);
  await intenta('DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])', [ids.conversions]);
  await intenta('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.conversions]);
  await intenta('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await intenta('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await intenta('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await intenta('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await intenta('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

const campusDe = (filas) => [...new Set(filas.map((f) => Number(f.project_id)))].sort((x, y) => x - y);
const ventasDe = (filas) => filas.map((f) => Number(f.venta_id ?? f.conversion_id ?? f.id)).sort((x, y) => x - y);

describe('Por cobrar con una empresa', () => {
  const cobrar = (u, qs) => pedir(u, `/api/accounting/receivable?${qs}`);

  it('suma sus dos campus y nada del tercero, aunque quien mira también lo lleve', async () => {
    const r = await cobrar(ADMIN_ABC, `issuerId=${EMPRESA}`);
    expect(r.status).toBe(200);
    expect(campusDe(r.body.data.items)).toEqual([A, B].sort((x, y) => x - y));
    expect(r.body.data.resumen.total_pendiente).toBeCloseTo(VENTA.A + VENTA.B, 2);
  });

  it('el super admin, la misma suma', async () => {
    const r = await cobrar(SUPER, `issuerId=${EMPRESA}`);
    expect(r.status).toBe(200);
    expect(r.body.data.resumen.total_pendiente).toBeCloseTo(VENTA.A + VENTA.B, 2);
  });

  it('quien solo lleva uno de los dos campus ve solo el suyo', async () => {
    const r = await cobrar(ADMIN_A, `issuerId=${EMPRESA}`);
    expect(r.status).toBe(200);
    expect(campusDe(r.body.data.items)).toEqual([A]);
    expect(r.body.data.resumen.total_pendiente).toBeCloseTo(VENTA.A, 2);
  });

  it('y pedir el otro campus por su id es un 403', async () => {
    const r = await cobrar(ADMIN_A, `projectId=${B}`);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain(`curso B`);
  });

  it('sin pedir nada, sus campus: nada de los demás', async () => {
    const r = await cobrar(ADMIN_A, '');
    expect(r.status).toBe(200);
    expect(campusDe(r.body.data.items)).toEqual([A]);
  });
});

describe('Conversiones con una empresa', () => {
  it('la lista y sus tarjetas: las dos ventas de la empresa, y la suma de las dos', async () => {
    const r = await pedir(ADMIN_ABC, `/api/conversions?issuerId=${EMPRESA}&limit=50`);
    expect(r.status).toBe(200);
    expect(ventasDe(r.body.data)).toEqual([VENTA_ID.A, VENTA_ID.B].sort((x, y) => x - y));
    expect(r.body.pagination.total).toBe(2);
    expect(Number(r.body.totales.importe)).toBeCloseTo(VENTA.A + VENTA.B, 2);
  });

  it('el super admin, lo mismo', async () => {
    const r = await pedir(SUPER, `/api/conversions?issuerId=${EMPRESA}&limit=50`);
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(2);
    expect(Number(r.body.totales.importe)).toBeCloseTo(VENTA.A + VENTA.B, 2);
  });

  it('con el periodo puesto, «Por proyecto» reparte la misma suma entre sus dos campus', async () => {
    const r = await pedir(ADMIN_ABC, `/api/conversions?issuerId=${EMPRESA}&${PERIODO}&limit=50`);
    expect(r.status).toBe(200);
    const porProyecto = r.body.totales.porProyecto || [];
    expect(campusDe(porProyecto)).toEqual([A, B].sort((x, y) => x - y));
    const suma = porProyecto.reduce((s, p) => s + Number(p.ventas.importe), 0);
    expect(suma).toBeCloseTo(VENTA.A + VENTA.B, 2);
  });

  it('quien solo lleva uno de los dos campus: su venta y su importe', async () => {
    const r = await pedir(ADMIN_A, `/api/conversions?issuerId=${EMPRESA}&limit=50`);
    expect(r.status).toBe(200);
    expect(ventasDe(r.body.data)).toEqual([VENTA_ID.A]);
    expect(Number(r.body.totales.importe)).toBeCloseTo(VENTA.A, 2);
  });

  it('un campus ajeno por su id: 403', async () => {
    expect((await pedir(ADMIN_A, `/api/conversions?projectId=${C}`)).status).toBe(403);
    expect((await pedir(ADMIN_A, `/api/conversions/productos?projectId=${B}`)).status).toBe(403);
  });

  it('sin pedir nada, solo sus campus', async () => {
    const r = await pedir(ADMIN_A, '/api/conversions?limit=100');
    expect(r.status).toBe(200);
    expect(campusDe(r.body.data)).toEqual([A]);
  });

  it('el filtro de cursos: los de la empresa, no el del tercer campus', async () => {
    const r = await pedir(ADMIN_ABC, `/api/conversions/productos?issuerId=${EMPRESA}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual(expect.arrayContaining([`${MARCA} curso A`, `${MARCA} curso B`]));
    expect(r.body.data).not.toContain(`${MARCA} curso C`);
  });

  it('la lista con fechas: las ventas de los dos campus y ninguna del tercero', async () => {
    const r = await pedir(ADMIN_ABC, `/api/conversions/filas?issuerId=${EMPRESA}&${PERIODO}`);
    expect(r.status).toBe(200);
    expect(ventasDe(r.body.data)).toEqual([VENTA_ID.A, VENTA_ID.B].sort((x, y) => x - y));
    const solo = await pedir(ADMIN_A, `/api/conversions/filas?issuerId=${EMPRESA}&${PERIODO}`);
    expect(ventasDe(solo.body.data)).toEqual([VENTA_ID.A]);
  });

  it('las cuotas del periodo aceptan la empresa (y un campus ajeno es 403)', async () => {
    expect((await pedir(ADMIN_ABC, `/api/conversions/cuotas?issuerId=${EMPRESA}&${PERIODO}`)).status).toBe(200);
    expect((await pedir(ADMIN_A, `/api/conversions/cuotas?projectId=${B}&${PERIODO}`)).status).toBe(403);
  });
});
