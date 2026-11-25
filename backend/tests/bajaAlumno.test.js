import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Baja del alumno en la venta (CRM-ISEIE#767, gemela de CRM#1113), con la base de verdad.
 *
 * Lo que se defiende:
 *   · dar de baja (fecha, motivo, nota), cambiarla y deshacerla, con su
 *     historial (quién y cuándo) y la nota en la ficha del cliente;
 *   · NO anula facturas ni toca cuotas ni cobros; si quedan cuotas, lo avisa;
 *   · en Formaciones › Alumnos, desde la fecha de baja deja de ser activo
 *     («De baja» en las cifras); con fecha futura sigue activo hasta entonces;
 *   · permisos: la gestora, en sus ventas; otra gestora, 403; la tutora, 403;
 *   · validación: motivo, «otro» con nota, fecha válida y no antes de la venta.
 *
 *   npx vitest run tests/bajaAlumno.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: ventas } = await import('../src/modules/conversions/index.js');
const { default: productos } = await import('../src/modules/products/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(ventas.prefix, ventas.router);
app.use(productos.prefix, productos.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `BAJA${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

let CAMPUS; let ADMIN; let GESTORA; let OTRA; let TUTORA; let CURSO;
let VENTA; let OTRA_VENTA; let LEAD; let FACTURA;
let HACE_2; let EN_20; let HACE_30;

beforeAll(async () => {
  [{ hace_2: HACE_2, en_20: EN_20, hace_30: HACE_30 }] = await q(
    `SELECT (CURRENT_DATE - 2)::text AS hace_2, (CURRENT_DATE + 20)::text AS en_20, (CURRENT_DATE - 30)::text AS hace_30`);
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

  [{ id: CURSO }] = await q('INSERT INTO products (project_id, nombre, duracion) VALUES ($1, $2, $3) RETURNING id',
    [CAMPUS, `${MARCA} Curso de Coaching`, '2 meses']);

  const venta = async (clave, gestora, total, cobrado) => {
    const [l] = await q('INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [CAMPUS, `${MARCA} Alumno ${clave}`, `${clave.toLowerCase()}@${MARCA.toLowerCase()}.test`, gestora.id]);
    const [c] = await q(
      `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado,
                                vendedora_id, fecha_conversion)
       VALUES ($1, $2, 'Curso de Coaching', $3, $4, $5, $6, CURRENT_DATE - 10) RETURNING id`,
      [l.id, CAMPUS, CURSO, total, cobrado, gestora.id]);
    if (cobrado) await q('INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, $2, CURRENT_DATE - 10)', [c.id, cobrado]);
    return { venta: c.id, lead: l.id };
  };
  ({ venta: VENTA, lead: LEAD } = await venta('BAJA', GESTORA, 300, 100));
  await q(
    `INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento, fecha_cobro, importe_cobrado)
     VALUES ($1, 1, 100, CURRENT_DATE - 10, CURRENT_DATE - 10, 100), ($1, 2, 100, CURRENT_DATE + 20, NULL, NULL),
            ($1, 3, 100, CURRENT_DATE + 50, NULL, NULL)`, [VENTA]);
  [{ id: FACTURA }] = await q(
    `INSERT INTO invoices (project_id, serie, ano, numero, codigo, cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad,
                           cliente_cp, cliente_pais, items, base_imponible, total, estado, tipo, conversion_id)
     VALUES ($1, 'A', 2026, 1, $2, 'Alumno', '—', 'Calle 1', 'Madrid', '28001', 'España', '[]'::jsonb, 100, 100, 'emitida', 'normal', $3)
     RETURNING id`, [CAMPUS, `${MARCA}-1`, VENTA]);
  ({ venta: OTRA_VENTA } = await venta('SIGUE', OTRA, 100, 100));
}, 60000);

afterAll(async () => {
  await q('DELETE FROM lead_interactions WHERE lead_id IN (SELECT id FROM leads WHERE project_id = ANY($1::int[]))', [ids.projects]);
  await q('DELETE FROM invoices WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM conversions WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM leads WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM products WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
});

const alumnos = () => request.get(`/api/products/${CURSO}/formacion/alumnos?projectId=${CAMPUS}`).set(como(ADMIN));
const delAlumno = (r) => r.body.data.alumnos.find((a) => a.venta_id === VENTA);

describe('leer la baja', () => {
  it('sin baja: null, historial vacío, los motivos y el aviso de las cuotas por cobrar', async () => {
    const r = await request.get(`/api/conversions/${VENTA}/baja`).set(como(GESTORA));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ disponible: true, baja: null, historial: [] });
    expect(r.body.data.avisos).toMatchObject({ cuotas_pendientes: 2, importe_cuotas_pendientes: 200, pendiente: 200, cobro_automatico: false });
    expect(r.body.data.motivos.map((m) => m.clave)).toEqual(['desistimiento', 'voluntaria', 'impago', 'otro']);
  });

  it('otra gestora no ve ni toca la venta; la tutora, tampoco', async () => {
    expect((await request.get(`/api/conversions/${VENTA}/baja`).set(como(OTRA))).status).toBe(403);
    expect((await request.put(`/api/conversions/${VENTA}/baja`).set(como(OTRA)).send({ fecha: HACE_2, motivo: 'voluntaria' })).status).toBe(403);
    expect((await request.get(`/api/conversions/${VENTA}/baja`).set(como(TUTORA))).status).toBe(403);
  });
});

describe('dar de baja, cambiarla y deshacerla', () => {
  it('valida el motivo, la nota con «otro» y la fecha', async () => {
    const enviar = (body) => request.put(`/api/conversions/${VENTA}/baja`).set(como(GESTORA)).send(body);
    expect((await enviar({ fecha: HACE_2, motivo: 'raro' })).status).toBe(400);
    expect((await enviar({ fecha: HACE_2, motivo: 'otro' })).status).toBe(400);
    expect((await enviar({ fecha: '2026-02-30', motivo: 'voluntaria' })).status).toBe(400);
    const antes = await enviar({ fecha: HACE_30, motivo: 'voluntaria' });
    expect(antes.status).toBe(400);
    expect(antes.body.code).toBe('BAJA_ANTES_DE_LA_VENTA');
  });

  it('la gestora da de baja a su alumno: queda con quién y cuándo, y no toca facturas ni cuotas', async () => {
    const r = await request.put(`/api/conversions/${VENTA}/baja`).set(como(GESTORA))
      .send({ fecha: HACE_2, motivo: 'desistimiento', nota: 'Lo pidió por correo' });
    expect(r.status).toBe(200);
    expect(r.body.data.baja).toMatchObject({
      fecha: HACE_2, motivo: 'desistimiento', motivo_texto: 'Desistimiento en plazo', nota: 'Lo pidió por correo', por: `${MARCA} GESTORA`,
    });
    expect(r.body.data.historial).toHaveLength(1);
    expect(r.body.data.historial[0]).toMatchObject({ accion: 'baja', fecha_baja: HACE_2, usuario: `${MARCA} GESTORA` });
    expect(r.body.data.avisos.cuotas_pendientes).toBe(2);

    const [f] = await q('SELECT estado, anulada_at FROM invoices WHERE id = $1', [FACTURA]);
    expect(f).toMatchObject({ estado: 'emitida', anulada_at: null });
    const [c] = await q(`SELECT COUNT(*)::int AS n FROM conversion_installments WHERE conversion_id = $1 AND fecha_cobro IS NULL`, [VENTA]);
    expect(c.n).toBe(2);
    const [p] = await q('SELECT COUNT(*)::int AS n FROM conversion_payments WHERE conversion_id = $1', [VENTA]);
    expect(p.n).toBe(1);
    const notas = await q(`SELECT nota FROM lead_interactions WHERE lead_id = $1`, [LEAD]);
    expect(notas.some((n) => n.nota.startsWith('Alumno dado de baja'))).toBe(true);
  });

  it('en Alumnos deja de ser activo: «De baja» con su motivo', async () => {
    const r = await alumnos();
    expect(r.status).toBe(200);
    expect(delAlumno(r)).toMatchObject({ estado: 'baja', fecha_baja: HACE_2, motivo_baja: 'desistimiento', origen_fin: 'baja' });
    expect(r.body.data.resumen).toMatchObject({ activos: 1, baja: 1, total: 2, terminados: 0, fuera: 0 });
    const campus = await request.get(`/api/products/formaciones/alumnos?projectId=${CAMPUS}`).set(como(ADMIN));
    expect(campus.body.data.por_producto[CURSO]).toMatchObject({ activos: 1, baja: 1 });
  });

  it('con la baja en el futuro (el admin la cambia) sigue activo hasta ese día', async () => {
    const r = await request.put(`/api/conversions/${VENTA}/baja`).set(como(ADMIN)).send({ fecha: EN_20, motivo: 'voluntaria' });
    expect(r.status).toBe(200);
    expect(r.body.data.historial.map((h) => h.accion)).toEqual(['cambio', 'baja']);
    expect(r.body.data.baja).toMatchObject({ fecha: EN_20, motivo: 'voluntaria', nota: null, por: `${MARCA} ADMIN` });
    const a = delAlumno(await alumnos());
    expect(a).toMatchObject({ estado: 'activo', fin_acceso: EN_20, fecha_baja: EN_20, motivo_baja: 'voluntaria' });
  });

  it('deshacer: vuelve a contar como antes y queda en el historial; deshacer dos veces, 404', async () => {
    const r = await request.delete(`/api/conversions/${VENTA}/baja`).set(como(GESTORA)).send({ nota: 'Se arrepintió' });
    expect(r.status).toBe(200);
    expect(r.body.data.baja).toBeNull();
    expect(r.body.data.historial.map((h) => h.accion)).toEqual(['deshecha', 'cambio', 'baja']);
    expect(r.body.data.historial[0]).toMatchObject({ fecha_baja: EN_20, motivo: 'voluntaria', nota: 'Se arrepintió', usuario: `${MARCA} GESTORA` });
    const a = delAlumno(await alumnos());
    expect(a).toMatchObject({ estado: 'activo', fecha_baja: null, motivo_baja: null });
    expect(a.origen_fin).not.toBe('baja');

    const otra = await request.delete(`/api/conversions/${VENTA}/baja`).set(como(GESTORA));
    expect(otra.status).toBe(404);
    expect(otra.body.code).toBe('SIN_BAJA');
  });

  it('la venta de otra gestora no se ha tocado', async () => {
    const [v] = await q('SELECT baja_fecha FROM conversions WHERE id = $1', [OTRA_VENTA]);
    expect(v.baja_fecha).toBeNull();
  });
});
