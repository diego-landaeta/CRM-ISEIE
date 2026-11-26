import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Los documentos van a una carpeta temporal, no a la de la máquina.
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'apost1130-'));

/**
 * Apostilla de La Haya (CRM#1130 / CRM-ISEIE#786), contra la base de verdad.
 *
 * Lo que se defiende:
 *   · la ficha nace sola de la venta (con línea y sin línea) y no se repite;
 *   · la ven todos los de su campus (también otra gestora); la tutora, no;
 *   · la gestiona la gestora de esa venta y el admin; otra gestora, 403;
 *   · cada cambio queda en el historial; cancelar pide el motivo;
 *   · las cifras: cuántas, cuánto vendido y cobrado, por estado, campus y mes;
 *   · el aviso de atascada va a la campana de su gestora, una vez por cada N días;
 *   · los documentos, solo quien la gestiona;
 *   · los días del aviso, solo administración.
 *
 *   npx vitest run tests/apostillas786.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: apostillas } = await import('../src/modules/apostillas/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const alta = await import('../src/modules/apostillas/apostillas.alta.js');
const { avisarAtascadas } = await import('../src/modules/apostillas/apostillas.avisos.js');
const externos = await import('../src/modules/links-pago/links-pago.externos.js');

const app = express();
app.use(express.json());
app.use(apostillas.prefix, apostillas.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `APO${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let CAMPUS; let ADMIN; let GESTORA; let OTRA; let TUTORA; let APOSTILLA;
let VENTA_A; let VENTA_B; let LINEA_A; let AP_A; let AP_B;

beforeAll(async () => {
  const [p] = await q('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} campus`, `${MARCA.toLowerCase()}-campus`, `${MARCA}-key`]);
  CAMPUS = p.id;
  ids.projects.push(CAMPUS);
  const persona = async (n, role) => {
    const [u] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
      [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, CAMPUS]);
    return u;
  };
  ADMIN = await persona('ADMIN', 'admin');
  GESTORA = await persona('GESTORA', 'gestor');
  OTRA = await persona('OTRA', 'gestor');
  TUTORA = await persona('TUTORA', 'tutor');

  [{ id: APOSTILLA }] = await q(
    `INSERT INTO products (project_id, nombre, precio, servicio) VALUES ($1, 'Apostilla de La Haya', 300, 'apostilla') RETURNING id`, [CAMPUS]);
  const [{ id: MASTER }] = await q('INSERT INTO products (project_id, nombre, precio) VALUES ($1, $2, 2000) RETURNING id',
    [CAMPUS, `${MARCA} Máster`]);

  const lead = async (clave, gestora) => (await q(
    'INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [CAMPUS, `${MARCA} ${clave}`, `${clave.toLowerCase()}@${MARCA.toLowerCase()}.test`, gestora.id]))[0].id;

  // A: máster + apostilla en la misma venta (2.300 €), cobrada entera.
  const leadA = await lead('Ana', GESTORA);
  [{ id: VENTA_A }] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado,
                              vendedora_id, fecha_conversion)
     VALUES ($1, $2, 'Máster, Apostilla de La Haya', $3, 2300, 2300, $4, CURRENT_DATE - 3) RETURNING id`,
    [leadA, CAMPUS, MASTER, GESTORA.id]);
  await q(`INSERT INTO conversion_items (conversion_id, product_id, descripcion, cantidad, precio_unitario, subtotal, orden)
           VALUES ($1, $2, 'Máster', 1, 2000, 2000, 0)`, [VENTA_A, MASTER]);
  [{ id: LINEA_A }] = await q(
    `INSERT INTO conversion_items (conversion_id, product_id, descripcion, cantidad, precio_unitario, subtotal, orden)
     VALUES ($1, $2, 'Apostilla de La Haya', 1, 300, 300, 1) RETURNING id`, [VENTA_A, APOSTILLA]);
  await q('INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 2300, CURRENT_DATE - 3)', [VENTA_A]);

  // B: solo la apostilla, sin líneas (como las ventas a mano antiguas), 100 de 300 cobrados.
  const leadB = await lead('Beto', OTRA);
  [{ id: VENTA_B }] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado,
                              vendedora_id, fecha_conversion)
     VALUES ($1, $2, 'Apostilla de La Haya', $3, 300, 100, $4, CURRENT_DATE - 1) RETURNING id`,
    [leadB, CAMPUS, APOSTILLA, OTRA.id]);
  await q('INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 100, CURRENT_DATE - 1)', [VENTA_B]);
}, 60000);

afterAll(async () => {
  const aps = (await q('SELECT id FROM apostillas WHERE project_id = ANY($1::int[])', [ids.projects])).map((r) => r.id);
  await q("DELETE FROM admin_notifications WHERE type LIKE 'apostilla_%' AND (metadata->>'apostilla_id')::int = ANY($1::int[])", [aps]);
  await q('DELETE FROM apostillas WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM apostillas_ajustes WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM conversions WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM stripe_links_externos WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM leads WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM products WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
});

const avisos = (tipo, apostillaId) => q(
  `SELECT title, target_user_ids FROM admin_notifications
    WHERE type = $1 AND (metadata->>'apostilla_id')::int = $2 ORDER BY id`, [tipo, apostillaId]);

describe('la ficha nace sola', () => {
  it('de la línea de apostilla de una venta mixta, una sola vez', async () => {
    const creadas = await alta.desdeVenta(VENTA_A);
    expect(creadas).toHaveLength(1);
    [AP_A] = creadas;
    expect(await alta.desdeVenta(VENTA_A)).toEqual([]);
    const [a] = await q('SELECT * FROM apostillas WHERE id = $1', [AP_A]);
    expect(a).toMatchObject({ conversion_item_id: LINEA_A, origen: 'venta', estado: 'pendiente_inicio' });
  });

  it('de una venta sin líneas cuyo producto es la apostilla, desde la vuelta de cada 10 minutos', async () => {
    await alta.repasar();
    const [b] = await q('SELECT * FROM apostillas WHERE conversion_id = $1', [VENTA_B]);
    expect(b).toMatchObject({ conversion_item_id: null, estado: 'pendiente_inicio' });
    AP_B = b.id;
    await alta.repasar();
    expect(await q('SELECT id FROM apostillas WHERE project_id = $1', [CAMPUS])).toHaveLength(2);
  });

  it('avisa en la campana a la gestora de la venta (nunca por correo)', async () => {
    const [aviso] = await avisos('apostilla_nueva', AP_A);
    expect(aviso.title).toContain('Ana');
    expect(aviso.target_user_ids.map(Number)).toEqual([GESTORA.id]);
  });
});

describe('quién la ve y quién la gestiona', () => {
  it('otra gestora del campus las ve todas, pero solo gestiona la suya', async () => {
    const r = await request.get(`/api/apostillas?projectId=${CAMPUS}`).set(como(OTRA));
    expect(r.status).toBe(200);
    const porId = Object.fromEntries(r.body.data.map((a) => [a.id, a]));
    expect(porId[AP_A].gestionable).toBe(false);
    expect(porId[AP_B].gestionable).toBe(true);
    const mias = await request.get(`/api/apostillas?projectId=${CAMPUS}&mias=1`).set(como(OTRA));
    expect(mias.body.data.map((a) => a.id)).toEqual([AP_B]);
  });

  it('la tutora no entra', async () => {
    expect((await request.get(`/api/apostillas?projectId=${CAMPUS}`).set(como(TUTORA))).status).toBe(403);
  });

  it('otra gestora no la cambia (403); la suya sí, y queda en el historial', async () => {
    expect((await request.patch(`/api/apostillas/${AP_A}`).set(como(OTRA)).send({ estado: 'en_tramite' })).status).toBe(403);
    const r = await request.patch(`/api/apostillas/${AP_A}`).set(como(GESTORA))
      .send({ estado: 'en_tramite', nota: 'Documentos recibidos' });
    expect(r.status).toBe(200);
    expect(r.body.data.estado).toBe('en_tramite');
    expect(r.body.data.eventos[0]).toMatchObject({ tipo: 'estado', de: 'pendiente_inicio', a: 'en_tramite', nota: 'Documentos recibidos' });
  });

  it('cancelar pide el motivo', async () => {
    const r = await request.patch(`/api/apostillas/${AP_B}`).set(como(OTRA)).send({ estado: 'cancelada' });
    expect(r.status).toBe(400);
  });

  it('el admin la gestiona aunque no sea suya', async () => {
    const r = await request.patch(`/api/apostillas/${AP_B}`).set(como(ADMIN)).send({ numeroSeguimiento: 'ES123' });
    expect(r.status).toBe(200);
    expect(r.body.data.numero_seguimiento).toBe('ES123');
  });
});

describe('las cifras', () => {
  it('cuántas, cuánto vendido y cobrado, por estado, campus y mes', async () => {
    const r = await request.get(`/api/apostillas/cifras?projectId=${CAMPUS}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ total: 2, importe: 600, cobrado: 400, pagadas: 1, sin_asociar: 0 });
    const estados = Object.fromEntries(r.body.data.por_estado.map((e) => [e.estado, e.n]));
    expect(estados).toEqual({ en_tramite: 1, pendiente_inicio: 1 });
    expect(r.body.data.por_campus).toHaveLength(1);
    expect(r.body.data.por_mes.reduce((s, m) => s + m.n, 0)).toBe(2);
  });

  it('el bloque de la ficha del cliente y el de la venta', async () => {
    const v = await request.get(`/api/apostillas/de-venta/${VENTA_A}`).set(como(GESTORA));
    expect(v.body.data.map((a) => a.id)).toEqual([AP_A]);
    expect(v.body.data[0]).toMatchObject({ importe: 300, cobrado: 300, pagada: true });
  });
});

describe('el aviso de atascada', () => {
  it('a los 7 días en el mismo paso, a su gestora, y no se repite hasta otros 7', async () => {
    await q("UPDATE apostillas SET estado_desde = NOW() - interval '8 days' WHERE id = $1", [AP_A]);
    await avisarAtascadas();
    const primero = await avisos('apostilla_atascada', AP_A);
    expect(primero).toHaveLength(1);
    expect(primero[0].title).toBe(`La apostilla de ${MARCA} Ana lleva 8 días en «En trámite»`);
    expect(primero[0].target_user_ids.map(Number)).toEqual([GESTORA.id]);
    await avisarAtascadas();
    expect(await avisos('apostilla_atascada', AP_A)).toHaveLength(1);
  });

  it('con los días del campus: solo administración los cambia', async () => {
    expect((await request.put('/api/apostillas/ajustes').set(como(GESTORA)).send({ projectId: CAMPUS, diasAviso: 10 })).status).toBe(403);
    const r = await request.put('/api/apostillas/ajustes').set(como(ADMIN)).send({ projectId: CAMPUS, diasAviso: 10 });
    expect(r.status).toBe(200);
    expect(r.body.data[0].dias_aviso).toBe(10);
  });
});

describe('el cobro de un link de apostilla creado en Stripe', () => {
  it('abre su propia venta de apostilla y NO se cuelga de otra venta del cliente (lo del 23/11)', async () => {
    const [{ id: LINK }] = await q(
      `INSERT INTO stripe_links_externos (project_id, stripe_payment_link_id, nombre, importe, moneda)
       VALUES ($1, $2, 'Plan de pago - Apostilla HAYA', 300, 'EUR') RETURNING id`, [CAMPUS, `plink_${MARCA}`]);
    // Ana ya tiene una venta (la A); el cobro va a una venta NUEVA de apostilla.
    const payment = { stripe_id: `ch_${MARCA}`, amount: 300, stripe_created_at: Math.floor(Date.now() / 1000),
      customer_email: `ana@${MARCA.toLowerCase()}.test` };
    const r = await externos.ventaDelCargo(CAMPUS, payment, { id: 0, stripe_link_externo_id: LINK, checkout_externo: {} });
    expect(r.porVincular).toBeFalsy();
    expect(r.conv.id).not.toBe(VENTA_A);
    const [v] = await q('SELECT producto_contratado_id, importe_total, vendedora_id FROM conversions WHERE id = $1', [r.conv.id]);
    expect(v).toMatchObject({ producto_contratado_id: APOSTILLA, importe_total: '300.00', vendedora_id: GESTORA.id });
  });

  it('si no se sabe de quién es, a la bandeja y sin venta', async () => {
    const [{ id: LINK }] = await q('SELECT id FROM stripe_links_externos WHERE project_id = $1', [CAMPUS]);
    const payment = { stripe_id: `ch2_${MARCA}`, amount: 300, stripe_created_at: Math.floor(Date.now() / 1000),
      customer_email: `nadie@${MARCA.toLowerCase()}.test` };
    const r = await externos.ventaDelCargo(CAMPUS, payment, { id: 0, stripe_link_externo_id: LINK, checkout_externo: {} });
    expect(r).toMatchObject({ porVincular: true, motivo: 'sin_coincidencia' });
  });
});

describe('los documentos', () => {
  it('los sube y los abre quien la gestiona; otra gestora, no', async () => {
    const up = await request.post(`/api/apostillas/${AP_A}/documentos`).set(como(GESTORA))
      .field('tipo', 'diploma').attach('file', PNG, { filename: 'título.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ tipo: 'diploma', nombre: 'título.png' });
    const docId = up.body.data.id;
    expect((await request.get(`/api/apostillas/documentos/${docId}`).set(como(OTRA))).status).toBe(403);
    const bajada = await request.get(`/api/apostillas/documentos/${docId}`).set(como(GESTORA));
    expect(bajada.status).toBe(200);
    expect(bajada.headers['content-type']).toContain('image/png');
  });
});
