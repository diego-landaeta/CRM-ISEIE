import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM#1113 / CRM-ISEIE#767 · Formaciones desde el CRM, fase 1: crear y editar
 * una formación con sus módulos desde Productos › Formaciones, con la base de
 * verdad.
 *
 * Lo que se defiende:
 *   · crear guarda el producto con su tipo, horas («N horas»), precio, moneda y
 *     fechas, y sus módulos en el orden de la lista;
 *   · sin horas, la regla del tipo (curso 100, diplomado 750, máster 1500);
 *   · guardar deja los módulos como la lista: actualiza, crea, quita y reordena,
 *     y un módulo de otra formación es un 400;
 *   · las tutoras salen de las colaboraciones; el % solo con `tutores.gestionar`;
 *   · permisos del catálogo: la gestora ve pero no crea ni edita; un campus
 *     ajeno es un 403; nombre repetido, 409; fechas al revés, 400.
 *
 *   npx vitest run tests/formacionesDesdeCrm767.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/products/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { horasQueSeGuardan, horasEnTexto } = await import('../src/modules/products/formacion.service.js');
const { formacionSchema } = await import('../src/modules/products/formacion.validation.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `F1113${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

let CAMPUS; let AJENO; let ADMIN; let GESTORA; let TUTORA;

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
  TUTORA = await persona('TUTORA', 'tutor', [CAMPUS]);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM tutor_collaborations WHERE tutor_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM products WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
}, 60000);

describe('las horas y la validación (sin base)', () => {
  it('sin horas, la regla del tipo; con horas, las escritas', () => {
    expect(horasQueSeGuardan(null, 'curso')).toBe(100);
    expect(horasQueSeGuardan(null, 'diplomado')).toBe(750);
    expect(horasQueSeGuardan(null, 'master')).toBe(1500);
    expect(horasQueSeGuardan(null, null)).toBe(null);
    expect(horasQueSeGuardan(320, 'master')).toBe(320);
    expect(horasEnTexto(1500)).toBe('1500 horas');
  });

  it('fechas al revés, tipo raro o módulo repetido: no pasa', () => {
    expect(formacionSchema.safeParse({ nombre: 'X', fecha_inicio: '2026-12-01', fecha_fin: '2026-11-01' }).success).toBe(false);
    expect(formacionSchema.safeParse({ nombre: 'X', tipo_formacion: 'grado' }).success).toBe(false);
    expect(formacionSchema.safeParse({ nombre: 'X', modulos: [{ id: 3, titulo: 'a' }, { id: 3, titulo: 'b' }] }).success).toBe(false);
    expect(formacionSchema.safeParse({ nombre: 'X', moneda: 'euros' }).success).toBe(false);
    const ok = formacionSchema.safeParse({ nombre: ' X ', moneda: 'usd', horas_totales: '', modulos: [{ titulo: 'Uno', horas: '' }] });
    expect(ok.success).toBe(true);
    expect(ok.data).toMatchObject({ nombre: 'X', moneda: 'USD', horas_totales: null });
  });
});

describe('Productos › Formaciones (CRM#1113)', () => {
  let id;

  it('crea la formación con sus módulos en orden', async () => {
    const r = await request.post('/api/products/formacion').set(como(ADMIN)).send({
      projectId: CAMPUS, nombre: `${MARCA} Máster en Logopedia`, tipo_formacion: 'master',
      horas_totales: 1200, precio: 2400, moneda: 'eur', modalidad: 'Online',
      fecha_inicio: '2027-01-15', fecha_fin: '2027-12-15',
      modulos: [
        { titulo: 'Fundamentos', horas: 400, descripcion: 'Tema 1\nTema 2' },
        { titulo: 'Evaluación', horas: 400 },
        { titulo: 'Intervención', horas: 400 },
      ],
    });
    expect(r.status).toBe(201);
    id = r.body.data.id;
    expect(r.body.data).toMatchObject({
      tipo_formacion: 'master', horas_totales: 1200, horas_texto: '1200 horas', precio: 2400, moneda: 'EUR',
      fecha_inicio: '2027-01-15', fecha_fin: '2027-12-15', horas_de_los_modulos: 1200, de_la_web: false,
    });
    expect(r.body.data.modulos.map((m) => [m.orden, m.titulo])).toEqual([[0, 'Fundamentos'], [1, 'Evaluación'], [2, 'Intervención']]);
    const [p] = await q('SELECT num_modulos, project_id FROM products WHERE id = $1', [id]);
    expect(p).toMatchObject({ num_modulos: 3, project_id: CAMPUS });
  });

  it('sin horas, guarda las de la regla del tipo', async () => {
    const r = await request.post('/api/products/formacion').set(como(ADMIN))
      .send({ projectId: CAMPUS, nombre: `${MARCA} Diplomado en Voz`, tipo_formacion: 'diplomado' });
    expect(r.status).toBe(201);
    expect(r.body.data.horas_texto).toBe('750 horas');
  });

  it('guardar actualiza, crea, quita y reordena los módulos', async () => {
    const antes = (await request.get(`/api/products/${id}/formacion?projectId=${CAMPUS}`).set(como(ADMIN))).body.data;
    const [fund, , interv] = antes.modulos;
    const r = await request.put(`/api/products/${id}/formacion`).set(como(ADMIN)).send({
      projectId: CAMPUS, nombre: antes.nombre, precio: 1990,
      modulos: [
        { id: interv.id, titulo: 'Intervención clínica', horas: 500 },
        { titulo: 'Trabajo final', horas: 200 },
        { id: fund.id, titulo: fund.titulo, horas: 500 },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.data.precio).toBe(1990);
    expect(r.body.data.tipo_formacion).toBe('master');
    expect(r.body.data.modulos.map((m) => m.titulo)).toEqual(['Intervención clínica', 'Trabajo final', 'Fundamentos']);
    expect(r.body.data.modulos[0].id).toBe(interv.id);
    expect(r.body.data.modulos[2].id).toBe(fund.id);
    const quedan = await q('SELECT id FROM product_modules WHERE product_id = $1', [id]);
    expect(quedan).toHaveLength(3);
  });

  it('un módulo de otra formación es un 400 y no cambia nada', async () => {
    const [otra] = await q('INSERT INTO products (project_id, nombre) VALUES ($1, $2) RETURNING id', [CAMPUS, `${MARCA} Otra`]);
    const [mod] = await q(`INSERT INTO product_modules (product_id, titulo, orden) VALUES ($1, 'Ajeno', 0) RETURNING id`, [otra.id]);
    const r = await request.put(`/api/products/${id}/formacion`).set(como(ADMIN))
      .send({ projectId: CAMPUS, nombre: `${MARCA} Máster en Logopedia`, modulos: [{ id: mod.id, titulo: 'Robado' }] });
    expect(r.status).toBe(400);
    const [m] = await q('SELECT product_id, titulo FROM product_modules WHERE id = $1', [mod.id]);
    expect(m).toMatchObject({ product_id: otra.id, titulo: 'Ajeno' });
    expect(await q('SELECT id FROM product_modules WHERE product_id = $1', [id])).toHaveLength(3);
  });

  it('nombre repetido en el campus: 409; fechas al revés: 400', async () => {
    const r1 = await request.post('/api/products/formacion').set(como(ADMIN))
      .send({ projectId: CAMPUS, nombre: `${MARCA} Máster en Logopedia` });
    expect(r1.status).toBe(409);
    const r2 = await request.put(`/api/products/${id}/formacion`).set(como(ADMIN))
      .send({ projectId: CAMPUS, nombre: `${MARCA} Máster en Logopedia`, fecha_inicio: '2027-05-01', fecha_fin: '2027-04-01' });
    expect(r2.status).toBe(400);
  });

  it('las tutoras salen de las colaboraciones; el % solo con tutores.gestionar', async () => {
    await q('INSERT INTO tutor_collaborations (tutor_id, product_id, pct) VALUES ($1, $2, 12.5)', [TUTORA.id, id]);
    const admin = await request.get(`/api/products/${id}/formacion?projectId=${CAMPUS}`).set(como(ADMIN));
    expect(admin.body.data.tutoras).toEqual([expect.objectContaining({ tutor_id: TUTORA.id, pct: 12.5 })]);
    const gestora = await request.get(`/api/products/${id}/formacion?projectId=${CAMPUS}`).set(como(GESTORA));
    expect(gestora.status).toBe(200);
    expect(gestora.body.data.tutoras[0].tutor_id).toBe(TUTORA.id);
    expect(gestora.body.data.tutoras[0]).not.toHaveProperty('pct');
  });

  it('la gestora no crea ni edita; un campus ajeno es un 403', async () => {
    const crear = await request.post('/api/products/formacion').set(como(GESTORA)).send({ projectId: CAMPUS, nombre: `${MARCA} No` });
    expect(crear.status).toBe(403);
    const editar = await request.put(`/api/products/${id}/formacion`).set(como(GESTORA)).send({ projectId: CAMPUS, nombre: 'No' });
    expect(editar.status).toBe(403);
    const ajeno = await request.get(`/api/products/${id}/formacion?projectId=${AJENO}`).set(como(ADMIN));
    expect(ajeno.status).toBe(403);
  });
});
