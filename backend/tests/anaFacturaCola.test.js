import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * 25/11 · Ana (gestora con «Emitir desde la cola») y la venta 540.
 *
 * Lo que pasó: cobró la cuota (cobro 1008), la factura automática no lo tomó
 * —la venta ya se facturaba a mano— y lo dejó en la cola, como debe. Pero no
 * vio dónde emitirlo (eso es del frontal: ConversionsTab.recarga.test.tsx y
 * colasDeFacturacion.test.ts). Aquí, lo del servidor que salió al revisarlo:
 *
 *   1. La factura hecha a mano de una venta (`POST /invoices`, el botón
 *      «Factura» de Finanzas › Ventas) quedaba con `payment_id` vacío aunque
 *      la venta tuviera su cobro del mismo importe (las 2026/0311 y 0312 del
 *      23/11). Ahora va con ese cobro, y el cobro sale de la cola.
 *   2. HAY_ANTERIORES dice qué cobro para el turno.
 *   3. Con la automática encendida, el cobro de una venta que ya se facturaba a
 *      mano no lo toma (`alCobrar` → false), sigue en la cola y la cola lo dice
 *      («a mano»), para que nadie espere a que salga solo.
 *
 * Contra la base local:
 *   npm run db:preparar -- --datos
 *   npx vitest run tests/anaFacturaCola.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/invoices/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const FA = await import('../src/modules/factura-automatica/factura-automatica.service.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `AF${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], issuers: [], leads: [], conversions: [] };
let SUPER;
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const dia = async (n) => (await one(`SELECT (CURRENT_DATE + $1::int)::text AS d`, [n])).d;

let campus = 0;
async function nuevoCampus() {
  campus += 1;
  const serie = `F${Date.now().toString(36).slice(-6)}${campus}`;
  const e = await one(`INSERT INTO invoice_issuers (razon_social, nif, serie) VALUES ($1, 'B00000000', $2) RETURNING id`,
    [`${MARCA} Emisora ${campus}`, serie]);
  ids.issuers.push(e.id);
  const p = (await one(`INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${MARCA} campus ${campus}`, `${MARCA.toLowerCase()}-${campus}`, `${MARCA}-k${campus}`, e.id])).id;
  ids.projects.push(p);
  return p;
}

async function venta(P, nombre, { total = 900, cobros = [] } = {}) {
  const l = await one(`INSERT INTO leads (project_id, nombre) VALUES ($1, $2) RETURNING id`, [P, `${MARCA} ${nombre}`]);
  ids.leads.push(l.id);
  const cobrado = cobros.reduce((a, c) => a + c.importe, 0);
  const v = (await one(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
                         VALUES ($1, $2, 'Curso', $3, $4, CURRENT_DATE) RETURNING id`, [l.id, P, total, cobrado])).id;
  ids.conversions.push(v);
  const cps = [];
  for (const c of cobros) {
    cps.push((await one(`INSERT INTO conversion_payments (conversion_id, importe, fecha, metodo)
                          VALUES ($1, $2, $3, 'tarjeta') RETURNING id`, [v, c.importe, c.fecha])).id);
  }
  return { lead: l.id, venta: v, cobros: cps };
}

const factura = (P, V, total, extra = {}) => request.post('/api/invoices').set(como(SUPER)).send({
  projectId: P, conversionId: V.venta, leadId: V.lead,
  clienteNombre: `${MARCA} cliente`, clienteNif: `T${MARCA.slice(-6).toUpperCase()}${total}`,
  clienteDireccion: 'Calle 1', clienteCiudad: 'Madrid', clienteCp: '28001', clientePais: 'España',
  items: [{ descripcion: 'Curso', cantidad: 1, precio_unitario: total }], ivaPct: 0,
  metodoPago: 'tarjeta', confirmar_duplicada: true, ...extra,
});

beforeAll(async () => {
  SUPER = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'superadmin') RETURNING id, role`,
    [`${MARCA} super`, `super@${MARCA.toLowerCase()}.test`]);
  ids.users.push(SUPER.id);
}, 60000);

afterAll(async () => {
  delete process.env.FACTURA_AUTOMATICA_ACTIVA;
  delete process.env.FACTURA_AUTOMATICA_CAMPUS;
  const quita = (sql, p) => q(sql, p).catch(() => {});
  await quita('DELETE FROM factura_datos_fiscales WHERE conversion_id = ANY($1::int[])', [ids.conversions]);
  await quita('DELETE FROM invoices WHERE project_id = ANY($1::int[])', [ids.projects]);
  await quita('DELETE FROM invoice_sequences WHERE project_id = ANY($1::int[])', [ids.projects]);
  await quita('DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])', [ids.conversions]);
  await quita('DELETE FROM conversion_reparto WHERE conversion_id = ANY($1::int[])', [ids.conversions]);
  await quita('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.conversions]);
  await quita('DELETE FROM lead_interactions WHERE lead_id = ANY($1::int[])', [ids.leads]);
  await quita('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await quita('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await quita('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await quita('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

describe('1 · la factura hecha a mano va con su cobro (las 0311 y 0312 del 23/11)', () => {
  let P;
  beforeAll(async () => { P = await nuevoCampus(); }, 60000);

  it('venta con un cobro de 380 €: la factura a mano de 380 € queda con ese cobro y el cobro sale de la cola', async () => {
    const V = await venta(P, 'Como la 721', { total: 380, cobros: [{ importe: 380, fecha: await dia(0) }] });
    const r = await factura(P, V, 380);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.payment_id).toBe(V.cobros[0]);

    const cola = (await request.get(`/api/invoices/cola/venta/${V.venta}`).set(como(SUPER))).body.data;
    expect(cola.cobros).toEqual([]);
  });

  it('dos cobros del mismo importe (como la 720: el manual y el de Stripe): va con el de fecha más cercana y el otro sigue en la cola', async () => {
    const V = await venta(P, 'Como la 720', {
      total: 790, cobros: [{ importe: 395, fecha: await dia(-5) }, { importe: 395, fecha: await dia(0) }],
    });
    const r = await factura(P, V, 395, { fechaEmision: await dia(0) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.payment_id).toBe(V.cobros[1]);
    const cola = (await request.get(`/api/invoices/cola/venta/${V.venta}`).set(como(SUPER))).body.data;
    expect(cola.cobros.map((c) => c.payment_id)).toEqual([V.cobros[0]]);
  });

  it('sin cobro del mismo importe, como hasta hoy: sin cobro', async () => {
    const V = await venta(P, 'Importe distinto', { total: 900, cobros: [{ importe: 300, fecha: await dia(0) }] });
    const r = await factura(P, V, 250);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.payment_id).toBeNull();
  });
});

describe('2 · HAY_ANTERIORES dice qué cobro para el turno', () => {
  it('emitir el cobro de hoy con uno de anteayer esperando: 409 con el de anteayer', async () => {
    const P = await nuevoCampus();
    const A = await venta(P, 'Anterior', { total: 500, cobros: [{ importe: 120, fecha: await dia(-2) }] });
    const B = await venta(P, 'Ahora', { total: 500, cobros: [{ importe: 91.66, fecha: await dia(0) }] });
    const r = await request.post('/api/invoices/cola/generar').set(como(SUPER))
      .send({ projectId: P, paymentId: B.cobros[0] });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.code).toBe('HAY_ANTERIORES');
    expect(r.body.data.anterior).toMatchObject({ payment_id: A.cobros[0], conversion_id: A.venta, importe: 120 });
    expect(r.body.error).toContain(`venta ${A.venta}, cobro ${A.cobros[0]}`);
    // «Emitir igualmente» (forzar) sigue funcionando: nada se queda sin camino.
    const f = await request.post('/api/invoices/cola/generar').set(como(SUPER))
      .send({ projectId: P, paymentId: B.cobros[0], forzar: true });
    expect(f.status, JSON.stringify(f.body)).toBe(200);
    expect(f.body.data.payment_id).toBe(B.cobros[0]);
  });
});

describe('3 · con la automática encendida, lo que se facturaba a mano sigue a mano', () => {
  it('cobro de una venta que ya tenía factura: alCobrar no lo toma, sigue en la cola y la cola dice «a mano»', async () => {
    const P = await nuevoCampus();
    process.env.FACTURA_AUTOMATICA_ACTIVA = '1';
    process.env.FACTURA_AUTOMATICA_CAMPUS = String(P);
    try {
      // Como la 540: dos cuotas ya facturadas a mano y una nueva.
      const V = await venta(P, 'Como la 540', {
        total: 850, cobros: [{ importe: 150, fecha: await dia(-3) }, { importe: 91.66, fecha: await dia(0) }],
      });
      const r = await request.post('/api/invoices/cola/generar').set(como(SUPER))
        .send({ projectId: P, paymentId: V.cobros[0], forzar: true });
      expect(r.status, JSON.stringify(r.body)).toBe(200);

      expect(await FA.alCobrar({ conversionId: V.venta, paymentId: V.cobros[1] })).toBe(false);
      const filas = await q('SELECT id FROM factura_datos_fiscales WHERE conversion_id = $1', [V.venta]);
      expect(filas).toEqual([]);

      const e = await request.get(`/api/invoices/facturacion-al-dia?projectId=${P}`).set(como(SUPER));
      expect(e.status, JSON.stringify(e.body)).toBe(200);
      const fila = e.body.data.cola.find((c) => c.payment_id === V.cobros[1]);
      expect(fila, 'el cobro tiene que seguir en la cola').toBeTruthy();
      expect(fila.datos_fiscales).toMatchObject({ estado: 'a_mano', sale_sola: false, motivo_codigo: 'A_MANO' });

      // Y se emite a mano desde la cola, como antes.
      const g = await request.post('/api/invoices/cola/generar').set(como(SUPER))
        .send({ projectId: P, paymentId: V.cobros[1] });
      expect(g.status, JSON.stringify(g.body)).toBe(200);
      expect(g.body.data.payment_id).toBe(V.cobros[1]);
    } finally {
      delete process.env.FACTURA_AUTOMATICA_ACTIVA;
      delete process.env.FACTURA_AUTOMATICA_CAMPUS;
    }
  });

  it('apagada, la cola no pone etiqueta (como siempre)', async () => {
    const P = await nuevoCampus();
    const V = await venta(P, 'Apagada', { total: 300, cobros: [{ importe: 100, fecha: await dia(0) }] });
    const e = await request.get(`/api/invoices/facturacion-al-dia?projectId=${P}`).set(como(SUPER));
    const fila = e.body.data.cola.find((c) => c.payment_id === V.cobros[0]);
    expect(fila.datos_fiscales).toBeNull();
  });
});
