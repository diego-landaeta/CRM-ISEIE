import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Pagar o recalcular una comisión, solo sobre ventas de tus campus.
 *
 * `PATCH /:id/pay` y `POST /recalculate/:conversionId` aceptaban a cualquier
 * admin sobre cualquier comisión: un admin de un campus podía marcar como
 * pagada la de otro campus. Misma regla que en ventas.
 *
 *   npx vitest run tests/comisionesAmbito.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/commissions/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `COA${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], leads: [], conversions: [] };
let P; let ADMIN; let ADMIN_OTRO; let SUPER; let VENTA; let COMISION;
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

async function persona(n, role, campus = []) {
  const [u] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
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
  P = await proy('a'); const OTRO = await proy('b');
  SUPER = await persona('SUPER', 'superadmin');
  ADMIN = await persona('ADMIN', 'admin', [P]);
  ADMIN_OTRO = await persona('ADMINOTRO', 'admin', [OTRO]);
  const [l] = await q(`INSERT INTO leads (project_id, nombre, email, telefono, responsable_id) VALUES ($1, $2, $3, '+34600111222', $4) RETURNING id`,
    [P, `${MARCA} Ana`, `ana@lead.${MARCA.toLowerCase()}.test`, ADMIN.id]);
  ids.leads.push(l.id);
  const [v] = await q(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion) VALUES ($1, $2, 'x', 500, 100, CURRENT_DATE) RETURNING id`, [l.id, P]);
  VENTA = v.id; ids.conversions.push(v.id);
  [{ id: COMISION }] = await q(`INSERT INTO commissions (conversion_id, user_id, importe_base, pct, importe_comision) VALUES ($1, $2, 100, 10, 10) RETURNING id`, [VENTA, ADMIN.id]);
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM commissions WHERE conversion_id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

describe('comisiones: pagar y recalcular, solo en tus campus', () => {
  it('un admin de otro campus: 403 y no se toca nada', async () => {
    const pagar = await request.patch(`/api/commissions/${COMISION}/pay`).set(como(ADMIN_OTRO)).send({ fecha_pago: '2026-10-01' });
    const recalcular = await request.post(`/api/commissions/recalculate/${VENTA}`).set(como(ADMIN_OTRO));
    expect(pagar.status).toBe(403);
    expect(recalcular.status).toBe(403);
    const [c] = await q(`SELECT estado FROM commissions WHERE id = $1`, [COMISION]);
    expect(c.estado).toBe('pendiente');
  });

  it('el admin del campus y el superadmin sí pueden', async () => {
    expect((await request.post(`/api/commissions/recalculate/${VENTA}`).set(como(SUPER))).status).not.toBe(403);
    const r = await request.patch(`/api/commissions/${COMISION}/pay`).set(como(ADMIN)).send({ fecha_pago: '2026-10-01' });
    expect(r.status).toBe(200);
  });

  it('una comisión que no existe, 404', async () => {
    expect((await request.patch('/api/commissions/999999999/pay').set(como(ADMIN)).send({ fecha_pago: '2026-10-01' })).status).toBe(404);
  });
});
