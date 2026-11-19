import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool from '../src/shared/config/db.js';

/**
 * CRM#898 (gemela CRM-ISEIE#574) · Que no se creen ventas repetidas del mismo
 * alumno y programa.
 *
 * Casos reales del 18/11: alumnos con dos a cuatro ventas del mismo programa
 * en el mismo campus, porque la gestora creaba una venta nueva para la segunda
 * cuota, o porque una carga desde facturas creó prospectos sin correo con el
 * mismo nombre y una venta por factura.
 *
 *   · la segunda venta del mismo alumno y programa da 409 VENTA_YA_EXISTE, con
 *     la venta que existe, su total, lo cobrado y lo pendiente;
 *   · con `forzar` entra y queda quién lo forzó;
 *   · el mismo nombre con y sin tildes, o uno que empieza por el otro, es el
 *     mismo alumno; otro programa no es repetida;
 *   · «Posibles repetidas» saca el grupo, y no la que se creó forzando.
 *
 * Contra Postgres de verdad: lo que se compara son nombres normalizados en SQL.
 */

const request = supertest(app);
const MARCA = `VR${Date.now().toString(36)}`;
const FECHA = '2026-03-11';
let PROYECTO;
let superId;
let token;
let producto;
let otroProducto;
let lead;

const auth = () => ({ Authorization: `Bearer ${token}` });
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);

const venta = (extra) => request.post('/api/ventas').set(auth()).send({
  project_id: PROYECTO,
  producto_interes_id: producto,
  importe_total: 900,
  importe_pagado: 300,
  metodo_pago: 'transferencia',
  fecha_pago: FECHA,
  ...extra,
});

beforeAll(async () => {
  [{ id: PROYECTO }] = await q(
    'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $2) RETURNING id',
    [MARCA, MARCA.toLowerCase()]);
  [{ id: superId }] = await q(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', 'superadmin', TRUE) RETURNING id`,
    [MARCA, `${MARCA.toLowerCase()}@prueba.test`]);
  token = jwt.sign({ userId: superId, role: 'superadmin' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  [{ id: producto }] = await q(
    `INSERT INTO products (project_id, nombre, precio, active) VALUES ($1, $2, 900, TRUE) RETURNING id`,
    [PROYECTO, `Diplomado ${MARCA}`]);
  [{ id: otroProducto }] = await q(
    `INSERT INTO products (project_id, nombre, precio, active) VALUES ($1, $2, 500, TRUE) RETURNING id`,
    [PROYECTO, `Curso ${MARCA}`]);
  [lead] = await q(
    `INSERT INTO leads (project_id, nombre, email, status, responsable_id, created_at, fecha_solicitud)
     VALUES ($1, 'José Pérez Gómez', $2, 'en_seguimiento', $3, '2026-03-01 09:00', '2026-03-01 09:00')
     RETURNING id`, [PROYECTO, `jose-${MARCA.toLowerCase()}@prueba.test`, superId]);
});

afterAll(async () => {
  if (PROYECTO) {
    const ventas = `SELECT id FROM conversions WHERE project_id = ${Number(PROYECTO)}`;
    await q(`DELETE FROM invoices WHERE project_id = $1`, [PROYECTO]).catch(() => {});
    await q(`DELETE FROM commissions WHERE conversion_id IN (${ventas})`).catch(() => {});
    await q(`DELETE FROM conversion_installments WHERE conversion_id IN (${ventas})`).catch(() => {});
    await q(`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`).catch(() => {});
    await q(`DELETE FROM conversion_items WHERE conversion_id IN (${ventas})`).catch(() => {});
    await q('DELETE FROM conversions WHERE project_id = $1', [PROYECTO]).catch(() => {});
    await q('DELETE FROM lead_status_history WHERE lead_id IN (SELECT id FROM leads WHERE project_id = $1)', [PROYECTO]).catch(() => {});
    await q('DELETE FROM leads WHERE project_id = $1', [PROYECTO]).catch(() => {});
    await q('DELETE FROM products WHERE project_id = $1', [PROYECTO]).catch(() => {});
  }
  if (superId) {
    await q('DELETE FROM user_activity_log WHERE user_id = $1', [superId]).catch(() => {});
    await q('DELETE FROM users WHERE id = $1', [superId]).catch(() => {});
  }
  if (PROYECTO) await q('DELETE FROM projects WHERE id = $1', [PROYECTO]).catch(() => {});
  await pool.end();
});

describe('alta de una venta que el alumno ya tiene', () => {
  let primera;

  it('la primera venta entra', async () => {
    const r = await venta({ lead_id: lead.id });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    primera = r.body.data.conversion_id;
  });

  it('la segunda del mismo alumno y programa da 409 con la venta que existe, su total y lo pendiente', async () => {
    const antes = (await q('SELECT count(*)::int AS n FROM conversions WHERE project_id = $1', [PROYECTO]))[0].n;
    const r = await venta({ lead_id: lead.id, importe_total: 300, importe_pagado: 300 });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.code).toBe('VENTA_YA_EXISTE');
    // El total es el guardado (en ISEIE el 21 % va encima si no se dice otra
    // cosa); lo cobrado, el pago inicial; lo pendiente, la diferencia.
    const [{ total }] = await q('SELECT importe_total::float8 AS total FROM conversions WHERE id = $1', [primera]);
    expect(r.body.data.venta).toMatchObject({ id: primera, lead_id: lead.id, total, cobrado: 300, motivo: 'mismo_prospecto' });
    expect(r.body.data.venta.pendiente).toBeCloseTo(total - 300, 2);
    expect(r.body.error).toMatch(/ya tiene una venta de este programa/);
    // Y no deja nada creado.
    const despues = (await q('SELECT count(*)::int AS n FROM conversions WHERE project_id = $1', [PROYECTO]))[0].n;
    expect(despues).toBe(antes);
  });

  it('desde la ficha (POST /api/conversions) también da 409', async () => {
    const r = await request.post('/api/conversions').set(auth()).send({
      lead_id: lead.id, project_id: PROYECTO, producto_contratado: `Diplomado ${MARCA}`,
      producto_contratado_id: producto, importe_total: 300, fecha_conversion: FECHA,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.code).toBe('VENTA_YA_EXISTE');
    expect(r.body.data.venta.id).toBe(primera);
  });

  it('un cliente «nuevo» con el mismo nombre sin tildes ni mayúsculas, y otro correo, es el mismo alumno', async () => {
    const r = await venta({ nombre: 'JOSE PEREZ GOMEZ', email: `otro-${MARCA.toLowerCase()}@prueba.test` });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.data.venta).toMatchObject({ id: primera, motivo: 'mismo_nombre' });
    // No se ha quedado una ficha suelta por el camino.
    const fichas = await q('SELECT id FROM leads WHERE project_id = $1', [PROYECTO]);
    expect(fichas).toHaveLength(1);
  });

  it('uno que empieza por el otro («José Pérez») cuenta; un nombre de pila suelto no', async () => {
    const r = await venta({ nombre: 'Jose Perez', email: `otro2-${MARCA.toLowerCase()}@prueba.test` });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.data.venta.id).toBe(primera);

    const solo = await venta({ nombre: 'José', telefono: '600000000', email: `jose-solo-${MARCA.toLowerCase()}@prueba.test` });
    expect(solo.status, JSON.stringify(solo.body)).toBe(201);
  });

  it('el mismo correo con otro nombre es el mismo alumno', async () => {
    const r = await venta({ nombre: 'Pepe', email: `JOSE-${MARCA.toLowerCase()}@prueba.test` });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.data.venta).toMatchObject({ id: primera, motivo: 'mismo_correo' });
  });

  it('otro programa del mismo alumno no es repetida', async () => {
    const r = await venta({ lead_id: lead.id, producto_interes_id: otroProducto, importe_total: 500, importe_pagado: 500 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it('con forzar entra, y queda quién lo forzó y de cuál es repetida', async () => {
    const r = await venta({ lead_id: lead.id, importe_total: 300, importe_pagado: 300, forzar: true });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const [v] = await q(
      'SELECT repetida_de, repetida_forzada_por, repetida_forzada_at FROM conversions WHERE id = $1',
      [r.body.data.conversion_id]);
    expect(v.repetida_de).toBe(primera);
    expect(v.repetida_forzada_por).toBe(superId);
    expect(v.repetida_forzada_at).not.toBeNull();
  });
});

describe('Posibles repetidas', () => {
  it('saca el grupo de la carga desde facturas: prospecto sin correo con el mismo nombre', async () => {
    // Como dejó la carga del 21/07: dos fichas del mismo nombre (una con
    // tildes, otra sin ellas y sin correo) y una venta en cada una. Directas
    // a la base: así entraron, sin pasar por el alta.
    const [a] = await q(
      `INSERT INTO leads (project_id, nombre, email, status) VALUES ($1, 'María Núñez', $2, 'convertido') RETURNING id`,
      [PROYECTO, `maria-${MARCA.toLowerCase()}@prueba.test`]);
    const [b] = await q(
      `INSERT INTO leads (project_id, nombre, email, status) VALUES ($1, 'MARIA NUNEZ', NULL, 'convertido') RETURNING id`,
      [PROYECTO]);
    const ids = [];
    for (const l of [a, b]) {
      const [c] = await q(
        `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado, fecha_conversion)
         VALUES ($1, $2, $3, $4, 450, 450, $5) RETURNING id`,
        [l.id, PROYECTO, `Diplomado ${MARCA}`, producto, FECHA]);
      ids.push(c.id);
    }

    const r = await request.get(`/api/conversions/posibles-repetidas?projectId=${PROYECTO}`).set(auth());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const grupos = r.body.data;
    const deMaria = grupos.find((g) => g.ventas.some((v) => v.id === ids[0]));
    expect(deMaria, JSON.stringify(grupos)).toBeTruthy();
    expect(deMaria.ventas.map((v) => v.id).sort()).toEqual([...ids].sort());
    // Lo cobrado es la suma de los pagos (#692): estas, sin pagos, deben todo.
    expect(deMaria.ventas[0]).toMatchObject({ total: 450, cobrado: 0, pendiente: 450 });

    // La venta de José creada forzando ya se vio con el aviso: no sale como
    // repetida. Y la de otro programa tampoco.
    const deJose = grupos.filter((g) => g.ventas.some((v) => v.lead_id === lead.id));
    expect(deJose).toHaveLength(0);
  });

  it('sin el permiso de editar ventas, 403', async () => {
    const [{ id: gestoraSin }] = await q(
      `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', 'tutor', TRUE) RETURNING id`,
      [`${MARCA} tutor`, `${MARCA.toLowerCase()}-tutor@prueba.test`]);
    try {
      const t = jwt.sign({ userId: gestoraSin, role: 'tutor' }, process.env.JWT_SECRET, { expiresIn: '10m' });
      const r = await request.get(`/api/conversions/posibles-repetidas?projectId=${PROYECTO}`).set({ Authorization: `Bearer ${t}` });
      expect(r.status).toBe(403);
    } finally {
      await q('DELETE FROM users WHERE id = $1', [gestoraSin]).catch(() => {});
    }
  });
});
