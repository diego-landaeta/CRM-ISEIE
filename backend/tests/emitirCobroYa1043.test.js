import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM#1043 (gemela CRM-ISEIE#708) · «Emitir ya la factura de este cobro».
 *
 * Ticket de soporte del 23/11: una gestora registró una venta con la primera
 * cuota cobrada y el CRM solo le ofreció la proforma. La venta se quedó en
 * «Ventas sin factura» sin la factura de su cobro. Ahora, al registrar la venta
 * o el cobro, la pantalla pregunta a la cola por los cobros de ESA venta
 * (`GET /invoices/cola/venta/:id`) y los emite con la misma llamada que el botón
 * de la cola (`POST /invoices/cola/generar`).
 *
 *   - la venta con cobro inicial sale con su cobro en la cola (se ofrece emitir);
 *   - emitir crea la factura de ESE cobro, y otra vez ya no: no hay dos del mismo;
 *   - sin «Emitir desde la cola» no se ofrece (puede_emitir false) ni se emite;
 *   - «Ventas sin factura» dice cuál es su cobro, para llevar a él en la cola.
 *
 * Contra la base local:
 *   npm run db:preparar -- --datos
 *   npx vitest run tests/emitirCobroYa1043.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/invoices/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `EC${Date.now().toString(36)}`;
const SERIE = `E${Date.now().toString(36).slice(-7)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], issuers: [], leads: [], conversions: [] };
let P; let SUPER; let GESTORA;
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

// Una venta de la gestora con un cobro de hoy.
async function ventaConCobro(nombre, { total = 900, cobrado = 300 } = {}) {
  const l = await one(`INSERT INTO leads (project_id, nombre, responsable_id) VALUES ($1, $2, $3) RETURNING id`,
    [P, `${MARCA} ${nombre}`, GESTORA.id]);
  ids.leads.push(l.id);
  const venta = (await one(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
                             VALUES ($1, $2, 'Curso', $3, $4, CURRENT_DATE) RETURNING id`, [l.id, P, total, cobrado])).id;
  ids.conversions.push(venta);
  const cobro = (await one(`INSERT INTO conversion_payments (conversion_id, importe, fecha, metodo)
                             VALUES ($1, $2, CURRENT_DATE, 'tarjeta') RETURNING id`, [venta, cobrado])).id;
  return { venta, cobro };
}

beforeAll(async () => {
  const e = await one(`INSERT INTO invoice_issuers (razon_social, nif, serie) VALUES ($1, '', $2) RETURNING id`,
    [`${MARCA} Emisora`, SERIE]);
  ids.issuers.push(e.id);
  P = (await one(`INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${MARCA} campus`, MARCA.toLowerCase(), `${MARCA}-k`, e.id])).id;
  ids.projects.push(P);
  SUPER = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'superadmin') RETURNING id, role`,
    [`${MARCA} super`, `super@${MARCA.toLowerCase()}.test`]);
  GESTORA = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id, role`,
    [`${MARCA} gestora`, `gestora@${MARCA.toLowerCase()}.test`]);
  ids.users.push(SUPER.id, GESTORA.id);
  await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [GESTORA.id, P]);
}, 60000);

afterAll(async () => {
  const quita = (sql, p) => q(sql, p).catch(() => {});
  await quita('DELETE FROM invoices WHERE project_id = ANY($1::int[])', [ids.projects]);
  await quita('DELETE FROM invoice_sequences WHERE project_id = ANY($1::int[])', [ids.projects]);
  await quita('DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])', [ids.conversions]);
  await quita('DELETE FROM conversion_reparto WHERE conversion_id = ANY($1::int[])', [ids.conversions]);
  await quita('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.conversions]);
  await quita('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await quita('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await quita('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await quita('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await quita('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

describe('#1043 · la factura del cobro, al registrarlo', () => {
  let V;
  beforeAll(async () => { V = await ventaConCobro('Venta Dos Cuotas'); }, 60000);

  it('venta con cobro inicial: su cobro está en la cola y quien lleva la cola puede emitirlo', async () => {
    const r = await request.get(`/api/invoices/cola/venta/${V.venta}`).set(como(SUPER));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.project_id).toBe(P);
    expect(r.body.data.puede_emitir).toBe(true);
    expect(r.body.data.cobros.map((c) => c.payment_id)).toEqual([V.cobro]);
    expect(r.body.data.cobros[0]).toMatchObject({ importe: 300, origen: 'manual' });
    expect(r.body.data.facturas).toEqual([]);
  });

  it('sin «Emitir desde la cola» (gestora) no se ofrece ni se emite', async () => {
    const r = await request.get(`/api/invoices/cola/venta/${V.venta}`).set(como(GESTORA));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.puede_emitir).toBe(false);
    const e = await request.post('/api/invoices/cola/generar').set(como(GESTORA))
      .send({ projectId: P, paymentId: V.cobro, forzar: true });
    expect(e.status).toBe(403);
    const n = await one(`SELECT count(*)::int AS n FROM invoices WHERE payment_id = $1`, [V.cobro]);
    expect(n.n).toBe(0);
  });

  it('«Emitir ya» crea la factura de ESE cobro', async () => {
    const r = await request.post('/api/invoices/cola/generar').set(como(SUPER))
      .send({ projectId: P, paymentId: V.cobro, forzar: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.payment_id).toBe(V.cobro);

    const d = (await request.get(`/api/invoices/cola/venta/${V.venta}`).set(como(SUPER))).body.data;
    expect(d.cobros).toEqual([]);
    expect(d.facturas.map((f) => f.payment_id)).toEqual([V.cobro]);
  });

  it('y no duplica: el cobro ya facturado no está en la cola y no sale otra', async () => {
    const r = await request.post('/api/invoices/cola/generar').set(como(SUPER))
      .send({ projectId: P, paymentId: V.cobro, forzar: true, confirmar_duplicada: true });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('NOT_IN_QUEUE');
    const n = await one(`SELECT count(*)::int AS n FROM invoices WHERE payment_id = $1 AND estado <> 'cancelada'`, [V.cobro]);
    expect(n.n).toBe(1);
  });

  it('una venta que no existe → 404', async () => {
    const r = await request.get('/api/invoices/cola/venta/999999999').set(como(SUPER));
    expect([403, 404]).toContain(r.status);
  });
});

describe('#1043 · «Ventas sin factura» lleva a su cobro en la cola', () => {
  it('cada venta cobrada dice su primer cobro', async () => {
    const V = await ventaConCobro('Sin Factura Aun', { total: 500, cobrado: 100 });
    const r = await request.get(`/api/invoices/ventas-sin-factura?projectId=${P}`).set(como(SUPER));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const fila = r.body.data.find((v) => v.conversion_id === V.venta);
    expect(fila).toBeTruthy();
    expect(fila.primer_cobro_id).toBe(V.cobro);
  });
});
