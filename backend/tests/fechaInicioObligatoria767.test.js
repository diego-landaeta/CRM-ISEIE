import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool from '../src/shared/config/db.js';
import { createConversionSchema, updateConversionSchema, FALTA_FECHA_INICIO } from '../src/modules/conversions/conversion.validation.js';
import { createSaleSchema } from '../src/modules/sales/sales.validation.js';

/**
 * La fecha de inicio del curso al cerrar la venta (#455 paso 1, gemela de CRM#767 y CRM#1036).
 *
 * Con ella se programa la matrícula en Moodle (el día anterior). Las dos rutas
 * del formulario —POST /api/conversions («Nueva venta» de la ficha) y POST
 * /api/ventas («Registrar venta»)— la exigen SOLO si el producto de la venta
 * (el principal o el de alguna línea) está unido a un curso de Moodle de su
 * campus. Sin curso es opcional. Los caminos sin nadie delante (Conciliación,
 * compra directa, links de pago) siguen sin ella.
 *
 * Y la lista de las ventas ya hechas sin fecha cuyo producto tiene curso.
 */

const request = supertest(app);
// En ISEIE el test trae su campus y su superadmin (como ventasRepetidas898).
const MARCA = 'FechaInicio767' + Date.now();
let PROYECTO;
let superId;
let token;
let leadId;
let conCurso;
let sinCurso;
const ventas = [];

const base = (extra = {}) => ({
  lead_id: 1, project_id: 1, producto_contratado: 'Curso', importe_total: 100, importe_pagado: 0, ...extra,
});

describe('esquemas (sin base)', () => {
  it('el esquema ya no la exige: lo decide el controlador según el producto', () => {
    expect(createConversionSchema.safeParse(base()).success).toBe(true);
    expect(createConversionSchema.safeParse(base({ fecha_inicio: null })).success).toBe(true);
  });

  it('si llega, tiene que existir; una pasada vale (cursos ya empezados)', () => {
    expect(createConversionSchema.safeParse(base({ fecha_inicio: '2020-01-15' })).success).toBe(true);
    const mala = createConversionSchema.safeParse(base({ fecha_inicio: '2026-02-31' }));
    expect(mala.success).toBe(false);
    expect(mala.error.errors[0].message).toBe('esa fecha no existe');
  });

  it('editar: se puede poner, cambiar o quitar (quitar, solo sin curso: lo mira el controlador)', () => {
    expect(updateConversionSchema.safeParse({ fecha_inicio: '2026-12-01' }).success).toBe(true);
    expect(updateConversionSchema.safeParse({ fecha_inicio: null }).success).toBe(true);
    expect(updateConversionSchema.safeParse({ fecha_inicio: '2026-13-01' }).success).toBe(false);
  });

  it('el esquema de /ventas la deja opcional: Conciliación lo usa sin ella', () => {
    const venta = { project_id: 1, lead_id: 5, producto_interes_id: 3, importe_total: 100, fecha_pago: '2026-11-20' };
    expect(createSaleSchema.safeParse(venta).success).toBe(true);
    expect(createSaleSchema.safeParse({ ...venta, fecha_inicio: '01/12/2026' }).success).toBe(false);
  });
});

describe('las rutas del formulario (con la base local)', () => {
  beforeAll(async () => {
    PROYECTO = (await pool.query('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $2) RETURNING id', [MARCA, MARCA.toLowerCase()])).rows[0].id;
    superId = (await pool.query(`INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', 'superadmin', TRUE) RETURNING id`, [MARCA, MARCA.toLowerCase() + '@prueba.test'])).rows[0].id;
    token = jwt.sign({ userId: superId, role: 'superadmin' }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const producto = async (nombre) => (await pool.query(
      'INSERT INTO products (project_id, nombre, precio, active) VALUES ($1, $2, 300, TRUE) RETURNING id', [PROYECTO, nombre])).rows[0].id;
    conCurso = await producto(`Con curso ${MARCA}`);
    sinCurso = await producto(`Sin curso ${MARCA}`);
    await pool.query(
      `INSERT INTO moodle_cursos_producto (product_id, project_id, curso_moodle_id, curso_nombre) VALUES ($1, $2, 99001, 'Curso 767')`,
      [conCurso, PROYECTO]);
    const { rows } = await pool.query(
      `INSERT INTO leads (project_id, nombre, email, status, created_at, fecha_solicitud)
       VALUES ($1, 'Alumna Fecha Inicio 767', 'fecha-inicio-767@test-767.com', 'en_seguimiento', $2, $2) RETURNING id`,
      [PROYECTO, '2026-01-01 09:00:00']);
    leadId = rows[0].id;
  });

  afterAll(async () => {
    for (const id of ventas) {
      await pool.query('DELETE FROM matriculas_moodle WHERE conversion_id = $1', [id]).catch(() => {});
      await pool.query('DELETE FROM conversion_payments WHERE conversion_id = $1', [id]);
      await pool.query('DELETE FROM conversion_items WHERE conversion_id = $1', [id]);
      await pool.query('DELETE FROM conversions WHERE id = $1', [id]);
    }
    await pool.query('DELETE FROM lead_status_history WHERE lead_id = $1', [leadId]);
    await pool.query('DELETE FROM leads WHERE id = $1', [leadId]);
    await pool.query('DELETE FROM moodle_cursos_producto WHERE product_id = ANY($1::int[])', [[conCurso, sinCurso]]);
    await pool.query('DELETE FROM products WHERE id = ANY($1::int[])', [[conCurso, sinCurso]]);
    await pool.query('DELETE FROM activity_log WHERE user_id = $1', [superId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = $1', [superId]).catch(() => {});
    await pool.query('DELETE FROM projects WHERE id = $1', [PROYECTO]).catch(() => {});
    await pool.end();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const conversion = (extra) => request.post('/api/conversions').set(auth())
    .send({ lead_id: leadId, project_id: PROYECTO, producto_contratado: `Con curso ${MARCA}`, importe_total: 300, importe_pagado: 0, forzar: true, ...extra });
  const registrar = (extra) => request.post('/api/ventas').set(auth())
    .send({ project_id: PROYECTO, lead_id: leadId, importe_total: 300, importe_pagado: 0,
      metodo_pago: 'transferencia', fecha_pago: '2026-11-20', forzar: true, ...extra });
  const guardada = async (res) => { const id = res.body.data.conversion_id ?? res.body.data.id; ventas.push(id); return id; };
  const fechaDe = async (id) => (await pool.query(`SELECT to_char(fecha_inicio, 'YYYY-MM-DD') AS f FROM conversions WHERE id = $1`, [id])).rows[0].f;

  it('qué productos la exigen: el del curso sí, el otro no', async () => {
    const r = await request.get(`/api/conversions/productos-con-curso?projectId=${PROYECTO}`).set(auth());
    expect(r.status).toBe(200);
    expect(r.body.data).toContain(conCurso);
    expect(r.body.data).not.toContain(sinCurso);
  });

  it('POST /api/conversions con curso y sin fecha: 400 y no crea nada', async () => {
    const antes = (await pool.query('SELECT count(*)::int AS n FROM conversions WHERE lead_id = $1', [leadId])).rows[0].n;
    for (const extra of [
      { producto_contratado_id: conCurso },
      // Solo el nombre escrito: es el del catálogo, con curso.
      {},
      // En una de sus líneas.
      { producto_contratado: 'Pack', items: [{ product_id: sinCurso, descripcion: 'a', cantidad: 1, precio_unitario: 100 }, { product_id: conCurso, descripcion: 'b', cantidad: 1, precio_unitario: 200 }] },
    ]) {
      const res = await conversion(extra);
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(res.body.error).toBe(FALTA_FECHA_INICIO);
    }
    const despues = (await pool.query('SELECT count(*)::int AS n FROM conversions WHERE lead_id = $1', [leadId])).rows[0].n;
    expect(despues).toBe(antes);
  });

  it('POST /api/conversions de un producto SIN curso: sin fecha, entra', async () => {
    const res = await conversion({ producto_contratado: `Sin curso ${MARCA}`, producto_contratado_id: sinCurso });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await fechaDe(await guardada(res))).toBeNull();
  });

  it('POST /api/conversions con curso y con fecha la guarda', async () => {
    const res = await conversion({ producto_contratado_id: conCurso, fecha_inicio: '2026-12-14' });
    expect(res.status).toBe(201);
    expect(await fechaDe(await guardada(res))).toBe('2026-12-14');
  });

  it('POST /api/ventas: con curso y sin fecha, 400; sin curso, entra', async () => {
    const mal = await registrar({ producto_interes_id: conCurso });
    expect(mal.status).toBe(400);
    expect(mal.body.error).toBe(FALTA_FECHA_INICIO);
    const bien = await registrar({ producto_interes_id: sinCurso });
    expect(bien.status, JSON.stringify(bien.body)).toBe(201);
    await guardada(bien);
  });

  it('POST /api/ventas con fecha (aunque ya haya pasado) la guarda en la venta', async () => {
    const res = await registrar({ producto_interes_id: conCurso, fecha_inicio: '2026-10-05' });
    expect(res.status).toBe(201);
    expect(await fechaDe(await guardada(res))).toBe('2026-10-05');
  });

  it('la lista de ventas sin fecha: la de producto con curso sí; con fecha o sin curso, no', async () => {
    // Una venta antigua, hecha antes de esto: con curso y sin fecha.
    const { rows } = await pool.query(
      `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado, fecha_conversion)
       VALUES ($1, $2, $3, $4, 300, 0, '2026-09-01') RETURNING id`, [leadId, PROYECTO, `Con curso ${MARCA}`, conCurso]);
    ventas.push(rows[0].id);
    const r = await request.get(`/api/conversions/sin-fecha-inicio?projectId=${PROYECTO}`).set(auth());
    expect(r.status).toBe(200);
    const ids = r.body.data.map((v) => v.id);
    expect(ids).toContain(rows[0].id);
    expect(ids).not.toContain(ventas[0]); // sin curso
    expect(ids).not.toContain(ventas[1]); // con fecha
    expect(r.body.data.find((v) => v.id === rows[0].id)).toMatchObject({ programa: `Con curso ${MARCA}`, fecha: '2026-09-01' });
  });

  it('PATCH: se pone y se cambia; quitarla a una con curso, no; a una sin curso, sí', async () => {
    const vieja = ventas[ventas.length - 1];
    let res = await request.patch(`/api/conversions/${vieja}`).set(auth()).send({ fecha_inicio: '2027-01-11' });
    expect(res.status).toBe(200);
    expect(await fechaDe(vieja)).toBe('2027-01-11');
    res = await request.patch(`/api/conversions/${vieja}`).set(auth()).send({ fecha_inicio: null });
    expect(res.status).toBe(400);
    expect(await fechaDe(vieja)).toBe('2027-01-11');
    res = await request.patch(`/api/conversions/${ventas[0]}`).set(auth()).send({ fecha_inicio: null });
    expect(res.status).toBe(200);
  });
});
