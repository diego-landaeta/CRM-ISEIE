import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #369 (gemela de CRM#245) · La prueba de «Terminada cuando», de punta a punta y con la base.
 *
 *   «Una prueba automática: un admin con un solo proyecto pide /api/tutores,
 *    /api/sales/resumen y /api/invoices sin proyecto y con el issuerId de otra
 *    empresa, y no recibe nada de fuera.»
 *
 * El arreglo está en `shared/utils/ambito.js` (y `campusPermitidos` en
 * facturas), y ya lo cubren `ambitoPorPersona` (con la base simulada) y las
 * pruebas de cada módulo. Faltaba esta: las TRES rutas que nombra la issue, con
 * los modelos de verdad y datos de dos empresas, para que si cualquiera de las
 * tres deja de recortar —en el controlador o en su consulta— se ponga en rojo.
 *
 * El resumen de ventas cuelga de `/api/ventas` (el prefijo del módulo `sales`).
 *
 *   npx vitest run tests/adminSoloSuEmpresa369.test.js
 *
 * En ISEIE hoy hay una sola empresa, pero el ámbito por empresa (`issuerId`) es
 * el mismo código que en MultiCRM: si entra otra sociedad, tiene que recortar igual.
 *
 * Esta prueba encontró una fuga que en ISEIE seguía abierta: Ventas (resumen,
 * por asesora, por cliente, desglose, países, serie y más vendidos) usaba el
 * `projectId` de la URL tal cual. Un admin veía las ventas de un campus que no
 * es suyo cambiando la URL, y sin campus, las de todos. Ahora pasa por
 * `proyectosDelAmbito`, como en MultiCRM.
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const modulos = await Promise.all(['tutores', 'sales', 'invoices']
  .map((m) => import(`../src/modules/${m}/index.js`).then((x) => x.default)));

const app = express();
app.use(express.json());
for (const m of modulos) app.use(m.prefix, m.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `A369${Date.now().toString(36)}`;
const marca = MARCA.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], issuers: [], leads: [], conversions: [], invoices: [] };

// Dos empresas, un campus en cada una. La admin («Mireia») solo lleva el de la
// primera; el profesor, la venta y la factura de la segunda («Aleix», ICTESS)
// no se le pueden escapar por ningún lado.
let CEDIA; let ICTESS; let CAMPUS_CEDIA; let CAMPUS_ICTESS;
let MIREIA; let SUPER; let TUTOR_CEDIA; let ALEIX; let FACTURA_CEDIA; let FACTURA_ICTESS;
const VENTA_CEDIA = 1234.5;
const VENTA_ICTESS = 7777;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const pedir = (u, ruta) => request.get(ruta).set(como(u));

async function persona(n, role, campus = []) {
  const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${marca}.test`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
  return u;
}

// Una venta cobrada (sin cobro es una proforma y el resumen no la cuenta) y su factura.
async function ventaYFactura(campus, empresa, importe, numero) {
  const l = await one('INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id',
    [campus, `${MARCA} alumno ${numero}`, `alumno${numero}@${marca}.test`]);
  ids.leads.push(l.id);
  const v = await one(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
     VALUES ($1, $2, 'curso', $3, $3, CURRENT_DATE) RETURNING id`, [l.id, campus, importe]);
  ids.conversions.push(v.id);
  await q('INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, $2, CURRENT_DATE)', [v.id, importe]);
  const f = await one(
    `INSERT INTO invoices (project_id, issuer_id, ano, numero, codigo, cliente_nombre, cliente_nif, cliente_direccion,
                           cliente_ciudad, cliente_cp, cliente_pais, items, base_imponible, total, lead_id, conversion_id)
     VALUES ($1, $2, 2026, $3, $4, $5, 'X1234567L', 'Calle 1', 'Madrid', '28001', 'España', '[]'::jsonb, $6, $6, $7, $8)
     RETURNING id`,
    [campus, empresa, numero, `${MARCA}-${numero}`, `${MARCA} cliente ${numero}`, importe, l.id, v.id]);
  ids.invoices.push(f.id);
  return f.id;
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
    return p.id;
  };
  CEDIA = await empresa('cedia');
  ICTESS = await empresa('ictess');
  CAMPUS_CEDIA = await campus('cedia', CEDIA);
  CAMPUS_ICTESS = await campus('ictess', ICTESS);

  MIREIA = await persona('Mireia', 'admin', [CAMPUS_CEDIA]);
  SUPER = await persona('Super', 'superadmin');
  TUTOR_CEDIA = await persona('TutorCedia', 'tutor', [CAMPUS_CEDIA]);
  ALEIX = await persona('Aleix', 'tutor', [CAMPUS_ICTESS]);

  FACTURA_CEDIA = await ventaYFactura(CAMPUS_CEDIA, CEDIA, VENTA_CEDIA, 924501);
  FACTURA_ICTESS = await ventaYFactura(CAMPUS_ICTESS, ICTESS, VENTA_ICTESS, 924502);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM invoices WHERE id = ANY($1::int[])', [ids.invoices]);
  await q('DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])', [ids.conversions]);
  await q('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.conversions]);
  await q('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

const idsDe = (r) => r.body.data.map((x) => Number(x.id));

describe('Tutores: Mireia no ve a Aleix', () => {
  it('sin proyecto («Todos»): el de su campus sí, Aleix no', async () => {
    const r = await pedir(MIREIA, '/api/tutores');
    expect(r.status).toBe(200);
    expect(idsDe(r)).toContain(TUTOR_CEDIA.id);
    expect(idsDe(r)).not.toContain(ALEIX.id);
  });

  it('con el issuerId de la otra empresa: nada', async () => {
    const r = await pedir(MIREIA, `/api/tutores?issuerId=${ICTESS}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  it('el super admin sí lo ve (la prueba no está mirando una lista vacía por otra razón)', async () => {
    expect(idsDe(await pedir(SUPER, `/api/tutores?issuerId=${ICTESS}`))).toContain(ALEIX.id);
  });
});

describe('Resumen de ventas: solo lo de su campus', () => {
  it('sin proyecto: solo su venta', async () => {
    const r = await pedir(MIREIA, '/api/ventas/resumen');
    expect(r.status).toBe(200);
    expect(r.body.data.ventas).toBe(1);
    expect(Number(r.body.data.importe)).toBeCloseTo(VENTA_CEDIA, 2);
  });

  it('con el issuerId de la otra empresa: cero', async () => {
    const r = await pedir(MIREIA, `/api/ventas/resumen?issuerId=${ICTESS}`);
    expect(r.status).toBe(200);
    expect(r.body.data.ventas).toBe(0);
    expect(Number(r.body.data.importe)).toBe(0);
  });

  it('el super admin, con esa empresa, sí la ve', async () => {
    const r = await pedir(SUPER, `/api/ventas/resumen?issuerId=${ICTESS}`);
    expect(r.body.data.ventas).toBe(1);
    expect(Number(r.body.data.importe)).toBeCloseTo(VENTA_ICTESS, 2);
  });
});

describe('Facturas: solo las de su campus', () => {
  it('sin proyecto: la suya, la de ICTESS no', async () => {
    const r = await pedir(MIREIA, '/api/invoices');
    expect(r.status).toBe(200);
    expect(idsDe(r)).toContain(FACTURA_CEDIA);
    expect(idsDe(r)).not.toContain(FACTURA_ICTESS);
  });

  it('con el issuerId de la otra empresa: nada', async () => {
    const r = await pedir(MIREIA, `/api/invoices?issuerId=${ICTESS}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  it('el super admin, con esa empresa, sí la ve', async () => {
    expect(idsDe(await pedir(SUPER, `/api/invoices?issuerId=${ICTESS}`))).toEqual([FACTURA_ICTESS]);
  });
});

/*
 * La serie de Ventas (la gráfica y su comparación) trae tres tramos: el
 * periodo, el anterior y el historial mes a mes. El periodo se recortaba, pero
 * el anterior y el historial se pedían sin la lista de campus: con «Todos», el
 * historial de una admin sumaba los campus de TODAS las empresas.
 */
describe('Serie de ventas: también el historial, solo lo suyo', () => {
  const ventasDelHistorial = (r) => r.body.data.meses.reduce((a, m) => a + m.ventas, 0);

  it('sin proyecto: su venta y nada más, en el periodo y en el historial', async () => {
    const r = await pedir(MIREIA, '/api/ventas/serie');
    expect(r.status).toBe(200);
    expect(r.body.data.totales.ventas).toBe(1);
    expect(ventasDelHistorial(r)).toBe(1);
  });

  it('con el issuerId de la otra empresa: cero también en el historial', async () => {
    const r = await pedir(MIREIA, `/api/ventas/serie?issuerId=${ICTESS}`);
    expect(r.body.data.totales.ventas).toBe(0);
    expect(ventasDelHistorial(r)).toBe(0);
  });

  it('el super admin, con esa empresa, sí la ve', async () => {
    expect(ventasDelHistorial(await pedir(SUPER, `/api/ventas/serie?issuerId=${ICTESS}`))).toBe(1);
  });
});

describe('un campus de la otra empresa, pedido a mano: 403', () => {
  it.each(['/api/tutores', '/api/ventas/resumen', '/api/ventas/serie', '/api/invoices'])('%s', async (ruta) => {
    expect((await pedir(MIREIA, `${ruta}?projectId=${CAMPUS_ICTESS}`)).status).toBe(403);
  });
});
