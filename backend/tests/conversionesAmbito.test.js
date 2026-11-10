import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Cada venta, solo para quien le toca (IDOR de `/api/conversions/:id` y hermanas).
 *
 * Antes, el detalle, las cuotas, los pagos, las devoluciones y el reparto de una
 * venta trabajaban con el id de la URL y nada más: cualquier sesión, de
 * cualquier campus, podía leer o cambiar la venta de otro.
 *
 *   npx vitest run tests/conversionesAmbito.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/conversions/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `CAM${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], leads: [], conversions: [] };
let P; let OTRO;
let SUPER; let ADMIN; let ADMIN_OTRO; let DUENA; let COMPANERA; let GESTORA_OTRO;
let LEAD; let VENTA; let CUOTA; let PAGO; let DEVOLUCION;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

async function persona(n, role, campus = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, c]);
  return u;
}

beforeAll(async () => {
  const proy = async (c) => {
    const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  P = await proy('a'); OTRO = await proy('b');
  SUPER = await persona('SUPER', 'superadmin');
  ADMIN = await persona('ADMIN', 'admin', [P]);
  ADMIN_OTRO = await persona('ADMINOTRO', 'admin', [OTRO]);
  DUENA = await persona('DUENA', 'gestor', [P]);
  COMPANERA = await persona('COMPANERA', 'gestor', [P]);
  GESTORA_OTRO = await persona('GESTORAOTRO', 'gestor', [OTRO]);

  const [l] = await q(`INSERT INTO leads (project_id, nombre, email, telefono, responsable_id) VALUES ($1, $2, $3, '+34600111222', $4) RETURNING id`,
    [P, `${MARCA} Ana`, `ana@lead.${MARCA.toLowerCase()}.test`, DUENA.id]);
  LEAD = l.id; ids.leads.push(l.id);
  const [v] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion) VALUES ($1, $2, 'x', 500, 100, CURRENT_DATE) RETURNING id`,
    [LEAD, P]);
  VENTA = v.id; ids.conversions.push(v.id);
  [{ id: CUOTA }] = await q(`INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento) VALUES ($1, 1, 100, CURRENT_DATE) RETURNING id`, [VENTA]);
  [{ id: PAGO }] = await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 100, CURRENT_DATE) RETURNING id`, [VENTA]);
  [{ id: DEVOLUCION }] = await q(`INSERT INTO conversion_refunds (conversion_id, importe, fecha) VALUES ($1, 10, CURRENT_DATE) RETURNING id`, [VENTA]);
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM conversion_refunds WHERE conversion_id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM conversion_installments WHERE conversion_id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

// Cada lectura por id que existía. Las de escritura se prueban aparte, sin cambiar nada.
const LECTURAS = () => [
  ['detalle', `/api/conversions/${VENTA}`],
  ['cuotas', `/api/conversions/${VENTA}/installments`],
  ['reparto', `/api/conversions/${VENTA}/reparto`],
  ['devoluciones', `/api/conversions/${VENTA}/refunds`],
  ['ventas del prospecto', `/api/conversions/by-lead/${LEAD}`],
];

describe('quien sí', () => {
  it.each([['superadmin', () => SUPER], ['admin del campus', () => ADMIN], ['la gestora dueña del prospecto', () => DUENA]])('%s lo ve todo', async (_n, quien) => {
    for (const [nombre, ruta] of LECTURAS()) {
      const r = await request.get(ruta).set(como(quien()));
      expect(r.status, nombre).toBe(200);
    }
  });

  it('la gestora que figura en el reparto de la venta, también', async () => {
    await q(`UPDATE conversions SET vendedora_id = $1 WHERE id = $2`, [COMPANERA.id, VENTA]);
    try {
      expect((await request.get(`/api/conversions/${VENTA}`).set(como(COMPANERA))).status).toBe(200);
    } finally {
      await q(`UPDATE conversions SET vendedora_id = NULL WHERE id = $1`, [VENTA]);
    }
  });
});

describe('quien no', () => {
  it.each([
    ['un admin de otro campus', () => ADMIN_OTRO],
    ['una gestora de otro campus', () => GESTORA_OTRO],
    ['una gestora del mismo campus que no es la suya', () => COMPANERA],
  ])('%s: 403 en todas las lecturas', async (_n, quien) => {
    for (const [nombre, ruta] of LECTURAS()) {
      const r = await request.get(ruta).set(como(quien()));
      expect(r.status, nombre).toBe(403);
      expect(r.body.code).toBe('FORBIDDEN');
    }
  });

  it('y tampoco escribe: pagos, cuotas, devoluciones, reparto y la propia venta', async () => {
    const quien = como(ADMIN_OTRO);
    const intentos = [
      request.patch(`/api/conversions/${VENTA}`).set(quien).send({ importe_total: 1 }),
      request.post(`/api/conversions/${VENTA}/payments`).set(quien).send({ importe: 5, fecha: '2026-10-01' }),
      request.delete(`/api/conversions/payments/${PAGO}`).set(quien),
      request.post(`/api/conversions/installments/${CUOTA}/pay`).set(quien).send({ fecha_cobro: '2026-10-01' }),
      request.patch(`/api/conversions/installments/${CUOTA}`).set(quien).send({ importe_previsto: 1 }),
      request.delete(`/api/conversions/installments/${CUOTA}`).set(quien),
      request.post(`/api/conversions/${VENTA}/installments/generate`).set(quien).send({ num_cuotas: 2, importe_total: 10, fecha_inicio: '2026-10-01' }),
      request.post(`/api/conversions/${VENTA}/refunds`).set(quien).send({ importe: 5 }),
      request.delete(`/api/conversions/refunds/${DEVOLUCION}`).set(quien),
      request.put(`/api/conversions/${VENTA}/reparto`).set(quien).send({ partes: [] }),
      request.delete(`/api/conversions/${VENTA}`).set(quien).send({ reason: 'duplicada' }),
    ];
    for (const r of await Promise.all(intentos)) expect(r.status).toBe(403);
    // Y no se tocó nada.
    const [v] = await q(`SELECT importe_total FROM conversions WHERE id = $1`, [VENTA]);
    expect(Number(v.importe_total)).toBe(500);
    expect(await q(`SELECT 1 FROM conversion_payments WHERE id = $1`, [PAGO])).toHaveLength(1);
    expect(await q(`SELECT 1 FROM conversion_refunds WHERE id = $1`, [DEVOLUCION])).toHaveLength(1);
    expect(await q(`SELECT 1 FROM conversion_installments WHERE id = $1 AND fecha_cobro IS NULL`, [CUOTA])).toHaveLength(1);
  });

  it('no se crea una venta en un campus ajeno', async () => {
    const r = await request.post('/api/conversions').set(como(ADMIN_OTRO))
      .send({ lead_id: LEAD, project_id: P, producto_contratado: 'x', importe_total: 10 });
    expect(r.status).toBe(403);
  });

  it('una venta que no existe sigue siendo 404, y un id que no es número, 400', async () => {
    expect((await request.get('/api/conversions/999999999').set(como(ADMIN))).status).toBe(404);
    expect((await request.get('/api/conversions/abc').set(como(ADMIN))).status).toBe(400);
  });
});

/**
 * Un id que NO es un entero limpio no puede colarse. La guarda solo dejaba de actuar con lo que
 * no era un entero (`next()`, «ya responderá el controlador»), y los controladores hacen
 * `parseInt`: `/conversions/7.5` pasaba la guarda y el controlador servía la venta 7 a quien no
 * podía verla. Y `Number('7e1')` es 70 pero `parseInt('7e1')` es 7: la guarda y el controlador
 * podían mirar ventas distintas. Ahora solo entran dígitos canónicos; todo lo demás es un 400.
 */
describe('un id que no es un entero limpio', () => {
  const sucios = (id) => [`${id}.5`, `${id}.0`, `${id}e0`, `+${id}`, `0${id}`, `${id}%20`];

  it('en lecturas: 400 aunque quien pregunte no tenga acceso (antes devolvía la venta ajena con un 200)', async () => {
    const quien = como(ADMIN_OTRO);
    for (const f of sucios(VENTA)) {
      for (const sufijo of ['', '/installments', '/reparto', '/refunds']) {
        const r = await request.get(`/api/conversions/${f}${sufijo}`).set(quien);
        expect(r.status, `GET ${f}${sufijo}`).toBe(400);
      }
    }
    expect((await request.get(`/api/conversions/by-lead/${LEAD}.5`).set(quien)).status).toBe(400);
  });

  it('en escrituras: 400 y no se toca nada', async () => {
    const quien = como(ADMIN_OTRO);
    const intentos = [
      request.patch(`/api/conversions/${VENTA}.5`).set(quien).send({ importe_total: 1 }),
      request.delete(`/api/conversions/payments/${PAGO}.5`).set(quien),
      request.patch(`/api/conversions/installments/${CUOTA}.5`).set(quien).send({ importe_previsto: 1 }),
      request.delete(`/api/conversions/refunds/${DEVOLUCION}.5`).set(quien),
    ];
    for (const r of await Promise.all(intentos)) expect(r.status).toBe(400);
    const [v] = await q(`SELECT importe_total FROM conversions WHERE id = $1`, [VENTA]);
    expect(Number(v.importe_total)).toBe(500);
    expect(await q(`SELECT 1 FROM conversion_payments WHERE id = $1`, [PAGO])).toHaveLength(1);
    expect(await q(`SELECT 1 FROM conversion_refunds WHERE id = $1`, [DEVOLUCION])).toHaveLength(1);
  });

  it('en el cuerpo de «crear venta»: lead_id o project_id sucios, 400 (no se salta la guarda)', async () => {
    const quien = como(ADMIN_OTRO);
    for (const cuerpo of [{ lead_id: `${LEAD}.5`, project_id: P }, { lead_id: LEAD, project_id: `${P}e0` }, { lead_id: `${LEAD}`, project_id: `+${P}` }]) {
      const r = await request.post('/api/conversions').set(quien).send({ ...cuerpo, producto_contratado: 'x', importe_total: 10 });
      expect(r.status, JSON.stringify(cuerpo)).toBe(400);
    }
  });

  it('control: con el id limpio, el ajeno sigue en 403 y el dueño entra', async () => {
    expect((await request.get(`/api/conversions/${VENTA}`).set(como(ADMIN_OTRO))).status).toBe(403);
    expect((await request.get(`/api/conversions/${VENTA}`).set(como(ADMIN))).status).toBe(200);
  });
});
