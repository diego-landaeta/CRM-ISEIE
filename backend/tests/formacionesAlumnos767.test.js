import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM-ISEIE#767 (gemela de CRM#1113) · Formaciones: los alumnos de cada formación, con la
 * base de verdad.
 *
 * Lo que se defiende:
 *   · activo / terminado / fuera (factura anulada) y, de los activos, al día,
 *     con cuotas pendientes o con impago (cuota vencida sin cobrar);
 *   · una venta cuenta por su producto o por una de sus líneas, UNA vez;
 *   · el alcance de Ventas: la gestora solo ve sus ventas; admin, todas;
 *   · la regla de acceso del campus cambia el fin de las formaciones sin
 *     duración; solo con `products.edit`;
 *   · permisos: sin `products.alumnos` (tutor), 403; formación de otro campus, 403.
 *
 *   npx vitest run tests/formacionesAlumnos767.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/products/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `A767${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

let CAMPUS; let AJENO; let ADMIN; let GESTORA; let OTRA; let TUTORA;
let CURSO; let DIPLOMADO; let DE_OTRO;
const V = {};

beforeAll(async () => {
  const proy = async (c) => {
    const [p] = await q('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  CAMPUS = await proy('campus');
  AJENO = await proy('ajeno');
  const persona = async (n, role, campus) => {
    const [u] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
      [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  ADMIN = await persona('ADMIN', 'admin', [CAMPUS]);
  GESTORA = await persona('GESTORA', 'gestor', [CAMPUS]);
  OTRA = await persona('OTRA', 'gestor', [CAMPUS]);
  TUTORA = await persona('TUTORA', 'tutor', [CAMPUS]);

  const producto = async (campus, nombre, extra = {}) => {
    const [p] = await q(
      'INSERT INTO products (project_id, nombre, duracion, tipo_formacion) VALUES ($1, $2, $3, $4) RETURNING id',
      [campus, `${MARCA} ${nombre}`, extra.duracion ?? null, extra.tipo ?? null]);
    return p.id;
  };
  CURSO = await producto(CAMPUS, 'Curso de Coaching', { duracion: '2 meses' });
  DIPLOMADO = await producto(CAMPUS, 'Diplomado sin duración', { tipo: 'diplomado' });
  DE_OTRO = await producto(AJENO, 'Curso de otro campus', { duracion: '2 meses' });

  const venta = async (clave, { gestora, productoId, enLinea = false, hace, total, cobrado = 0 }) => {
    const [l] = await q('INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [CAMPUS, `${MARCA} Alumno ${clave}`, `${clave.toLowerCase()}@${MARCA.toLowerCase()}.test`, gestora.id]);
    const [c] = await q(
      `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado,
                                vendedora_id, fecha_conversion)
       VALUES ($1, $2, 'Formación', $3, $4, $5, $6, CURRENT_DATE - $7::int) RETURNING id`,
      [l.id, CAMPUS, enLinea ? null : productoId, total, cobrado, gestora.id, hace]);
    if (enLinea) {
      await q(`INSERT INTO conversion_items (conversion_id, product_id, descripcion, precio_unitario, subtotal)
               VALUES ($1, $2, 'Formación', $3, $3)`, [c.id, productoId, total]);
    }
    if (cobrado) await q('INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, $2, CURRENT_DATE - $3::int)', [c.id, cobrado, hace]);
    V[clave] = c.id;
    return c.id;
  };
  const cuota = (conv, numero, importe, vence, cobrada = false) => q(
    `INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento, fecha_cobro, importe_cobrado)
     VALUES ($1, $2, $3, CURRENT_DATE + $4::int, ${cobrada ? 'CURRENT_DATE' : 'NULL'}, ${cobrada ? '$3' : 'NULL'})`,
    [conv, numero, importe, vence]);

  // Curso (2 meses): activo al día (gestora), activo con impago (otra), terminado (gestora), anulada (otra).
  await venta('ALDIA', { gestora: GESTORA, productoId: CURSO, hace: 10, total: 100, cobrado: 100 });
  const impago = await venta('IMPAGO', { gestora: OTRA, productoId: CURSO, hace: 20, total: 300, cobrado: 100 });
  await cuota(impago, 1, 100, -20, true);
  await cuota(impago, 2, 100, -5);
  await cuota(impago, 3, 100, 25);
  await venta('TERMINADO', { gestora: GESTORA, productoId: CURSO, hace: 400, total: 100, cobrado: 100 });
  const anulada = await venta('ANULADA', { gestora: OTRA, productoId: CURSO, hace: 8, total: 100, cobrado: 100 });
  await q(
    `INSERT INTO invoices (project_id, serie, ano, numero, codigo, cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad,
                           cliente_cp, cliente_pais, items, base_imponible, total, estado, tipo, conversion_id, anulada_at, motivo_anulacion)
     VALUES ($1, 'A', 2026, 1, $2, 'Alumno', '—', 'Calle 1', 'Madrid', '28001', 'España', '[]'::jsonb, 100, 100, 'emitida', 'normal', $3, NOW(), 'Desiste')`,
    [CAMPUS, `${MARCA}-1`, anulada]);
  // Diplomado sin duración, vendido en una LÍNEA de la venta: con cuotas por venir.
  const pendiente = await venta('PENDIENTE', { gestora: GESTORA, productoId: DIPLOMADO, enLinea: true, hace: 45, total: 200, cobrado: 100 });
  await cuota(pendiente, 1, 100, 30);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM invoices WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM conversions WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM leads WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM products WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
});

describe('los alumnos de una formación', () => {
  it('admin: activos, terminados, fuera y, de los activos, cómo van de pagos', async () => {
    const r = await request.get(`/api/products/${CURSO}/formacion/alumnos?projectId=${CAMPUS}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.resumen).toEqual({ activos: 2, terminados: 1, total: 3, fuera: 1, al_dia: 1, pendiente: 0, impago: 1 });
    expect(d.solo_lo_suyo).toBe(false);
    expect(d.regla).toMatchObject({ curso: 3, diplomado: 6, master: 12, configurada: false });
    const de = (v) => d.alumnos.find((a) => a.venta_id === V[v]);
    expect(de('IMPAGO')).toMatchObject({ estado: 'activo', pago: 'impago', gestora: `${MARCA} OTRA`, origen_fin: 'duracion' });
    expect(de('ALDIA')).toMatchObject({ estado: 'activo', pago: 'al_dia', gestora: `${MARCA} GESTORA` });
    expect(de('TERMINADO')).toMatchObject({ estado: 'terminado' });
    expect(de('ANULADA')).toMatchObject({ estado: 'fuera', motivo_fuera: 'anulada' });
    // Primero los activos, con el impago arriba.
    expect(d.alumnos[0].venta_id).toBe(V.IMPAGO);
  });

  it('la gestora solo ve sus ventas', async () => {
    const r = await request.get(`/api/products/${CURSO}/formacion/alumnos?projectId=${CAMPUS}`).set(como(GESTORA));
    expect(r.status).toBe(200);
    expect(r.body.data.solo_lo_suyo).toBe(true);
    expect(r.body.data.alumnos.map((a) => a.venta_id).sort()).toEqual([V.ALDIA, V.TERMINADO].sort());
    expect(r.body.data.resumen).toMatchObject({ activos: 1, terminados: 1, total: 2, impago: 0 });
  });

  it('una formación de otro campus, 403; sin el permiso (tutora), 403', async () => {
    const r = await request.get(`/api/products/${DE_OTRO}/formacion/alumnos?projectId=${CAMPUS}`).set(como(ADMIN));
    expect(r.status).toBe(403);
    const t = await request.get(`/api/products/${CURSO}/formacion/alumnos?projectId=${CAMPUS}`).set(como(TUTORA));
    expect(t.status).toBe(403);
    const ajeno = await request.get(`/api/products/formaciones/alumnos?projectId=${AJENO}`).set(como(GESTORA));
    expect(ajeno.status).toBe(403);
  });
});

describe('las cifras de la lista de formaciones', () => {
  it('cada formación con sus alumnos, contando las ventas por su línea y una sola vez', async () => {
    const r = await request.get(`/api/products/formaciones/alumnos?projectId=${CAMPUS}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    const pp = r.body.data.por_producto;
    expect(pp[CURSO]).toMatchObject({ activos: 2, impago: 1, total: 3 });
    expect(pp[DIPLOMADO]).toEqual({ activos: 1, terminados: 0, total: 1, fuera: 0, al_dia: 0, pendiente: 1, impago: 0 });
    expect(pp[DE_OTRO]).toBeUndefined();
  });
});

describe('la regla de acceso del campus', () => {
  it('solo con products.edit; valores raros, 400; cambia el fin de lo que no tiene duración', async () => {
    const g = await request.put('/api/products/formaciones/acceso').set(como(GESTORA)).send({ projectId: CAMPUS, diplomado: 1 });
    expect(g.status).toBe(403);
    const mal = await request.put('/api/products/formaciones/acceso').set(como(ADMIN)).send({ projectId: CAMPUS, diplomado: 0 });
    expect(mal.status).toBe(400);

    const r = await request.put('/api/products/formaciones/acceso').set(como(ADMIN)).send({ projectId: CAMPUS, diplomado: 1 });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ curso: 3, diplomado: 1, master: 12, configurada: true });

    // La venta del diplomado es de hace 45 días: con 1 mes, ya terminó. El curso tiene duración: no cambia.
    const l = await request.get(`/api/products/formaciones/alumnos?projectId=${CAMPUS}`).set(como(ADMIN));
    expect(l.body.data.por_producto[DIPLOMADO]).toMatchObject({ activos: 0, terminados: 1 });
    expect(l.body.data.por_producto[CURSO]).toMatchObject({ activos: 2 });
    const f = await request.get(`/api/products/${DIPLOMADO}/formacion/alumnos?projectId=${CAMPUS}`).set(como(ADMIN));
    expect(f.body.data.alumnos[0]).toMatchObject({ origen_fin: 'regla_campus', detalle_fin: 'Regla del campus: diplomado, 1 mes' });

    // Volver a la de serie.
    const s = await request.put('/api/products/formaciones/acceso').set(como(ADMIN)).send({ projectId: CAMPUS, curso: null, diplomado: null, master: null });
    expect(s.body.data.configurada).toBe(false);
  });
});
