import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM-ISEIE#858 + CRM-ISEIE#856 (gemelas CRM#1230 + #1228) · El rastro de un cobro
 * borrado (`cobro_borrado` en user_activity_log) lleva el campus de la venta.
 *
 * El Registro recorta `user_activity_log` por `details.project_id`
 * (registro.model.js, `deUsuarios`, #620). Sin él, la fila contaba como «de la
 * persona»: si quien borró está en dos campus, la veía el admin del otro, con
 * el importe, las notas, la referencia y el cargo de Stripe de una venta que no
 * es suya.
 *
 *   npx vitest run tests/cobroBorradoRegistro858.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/registro/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { olvidarTablas } = await import('../src/modules/registro/registro.model.js');
const conversionModel = await import('../src/modules/conversions/conversion.model.js');
const conversionService = await import('../src/modules/conversions/conversion.service.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `RB858${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
let MIO; let AJENO; let ADMIN_MIO; let ADMIN_AJENO; let DE_LOS_DOS; let pago;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const TODO = '/api/registro?vista=todos&limite=500';
/** El apunte del cobro borrado en lo que ve `u`, o undefined. */
const apunte = async (u) => {
  const r = await request.get(TODO).set(como(u));
  expect(r.status).toBe(200);
  return r.body.data.filas.find((f) => f.fuente === 'usuario' && f.accion === 'cobro_borrado'
    && Number(f.detalle?.payment_id) === Number(pago.id));
};

beforeAll(async () => {
  olvidarTablas();
  const campus = async (c) => {
    const p = await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-k-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  MIO = await campus('mio');
  AJENO = await campus('ajeno');
  const persona = async (c, role, suyos) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
      [`${MARCA} ${c}`, `${c}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const p of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, p]);
    return u;
  };
  ADMIN_MIO = await persona('admin-mio', 'admin', [MIO]);
  ADMIN_AJENO = await persona('admin-ajeno', 'admin', [AJENO]);
  // Quien borra está en los dos campus: por la vía «de la persona» su fila sin
  // campus la vería el admin de MIO.
  DE_LOS_DOS = await persona('gente-dos', 'gestor', [MIO, AJENO]);

  // Una venta del campus AJENO, con un cobro que se borra.
  const lead = await one('INSERT INTO leads (nombre, project_id) VALUES ($1, $2) RETURNING id', [`${MARCA} alumno`, AJENO]);
  const v = await conversionModel.create({
    lead_id: lead.id, project_id: AJENO, producto_contratado: `${MARCA} curso`,
    importe_total: 300, importe_pagado: 0, metodo_pago: 'transferencia', fecha_conversion: '2026-11-02', iva_incluido: true,
  });
  pago = (await conversionModel.addPayment(v.id,
    { importe: 120, fecha: '2026-11-03', metodo: 'transferencia', referencia: `${MARCA}-ref`, notas: `${MARCA} notas` },
    { allowDuplicate: true })).payment;
  await conversionService.removePayment(pago.id, { userId: DE_LOS_DOS.id });
}, 60000);

afterAll(async () => {
  const ventas = `SELECT id FROM conversions WHERE project_id = ANY('{${ids.projects.join(',')}}'::int[])`;
  for (const sql of [
    `DELETE FROM user_activity_log WHERE user_id = ANY('{${ids.users.join(',')}}'::int[])`,
    `DELETE FROM commissions WHERE conversion_id IN (${ventas})`,
    `DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`,
    `DELETE FROM conversion_items WHERE conversion_id IN (${ventas})`,
    `DELETE FROM conversions WHERE id IN (${ventas})`,
    `DELETE FROM leads WHERE project_id = ANY('{${ids.projects.join(',')}}'::int[])`,
    `DELETE FROM user_projects WHERE user_id = ANY('{${ids.users.join(',')}}'::int[])`,
    `DELETE FROM users WHERE id = ANY('{${ids.users.join(',')}}'::int[])`,
    `DELETE FROM projects WHERE id = ANY('{${ids.projects.join(',')}}'::int[])`,
  ]) {
    try { await q(sql); } catch { /* sigue limpiando */ }
  }
  await pool.end();
}, 60000);

describe('el rastro de un cobro borrado, en el Registro, por campus', () => {
  it('lleva el campus de la venta', async () => {
    const fila = await one(
      `SELECT details FROM user_activity_log WHERE action = 'cobro_borrado' AND (details->>'payment_id')::int = $1`, [pago.id]);
    expect(Number(fila.details.project_id)).toBe(AJENO);
  });

  it('un admin de OTRO campus no lo ve, aunque quien borró también sea de su campus', async () => {
    expect(await apunte(ADMIN_MIO)).toBeUndefined();
  });

  it('el admin del campus de la venta sí, contado en cristiano', async () => {
    const f = await apunte(ADMIN_AJENO);
    expect(f).toBeTruthy();
    expect(f.project_id).toBe(AJENO);
    expect(f.resumen).toBe('Borró un cobro de 120.00 € del 2026-11-03');
  });

  it('el CSV del admin de otro campus, igual: no sale el apunte de quien borró', async () => {
    // La única fila de esa persona es el borrado: si sale su nombre, se coló.
    const otro = await request.get('/api/registro/csv?vista=todos').set(como(ADMIN_MIO));
    expect(otro.status).toBe(200);
    expect(otro.text).not.toContain(`${MARCA} gente-dos`);
    const suyo = await request.get('/api/registro/csv?vista=todos').set(como(ADMIN_AJENO));
    expect(suyo.text).toContain(`${MARCA} gente-dos`);
  });
});
