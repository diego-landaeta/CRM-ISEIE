import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #770 · Cursos vendidos sin desarrollar (Automatizaciones 7/9, fase 2 de #336),
 * contra la base de verdad.
 *
 * Lo que pide la issue, y lo que se defiende aquí:
 *   · la venta de un curso sin desarrollar avisa al tutor o redactor asignado,
 *     con fecha límite (y crea su pendiente o suma la alumna, sin duplicar);
 *   · el curso aparece en el panel con su estado: pendiente, en desarrollo,
 *     ENTREGADO y publicado;
 *   · una fecha vencida avisa a administración;
 *   · el tutor redactor (#708) entra en Cursos pendientes y se le puede asignar
 *     (antes, 400 y 403).
 *
 *   npx vitest run tests/cursosVendidosSinDesarrollar770.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/cursos-pendientes/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { verifyToken } = await import('../src/shared/middleware/auth.js');
const { avisarVencimientos } = await import('../src/modules/cursos-pendientes/cursos-pendientes.service.js');
const { alVender, plazosPorDefecto, tipoPorNombre } = await import('../src/modules/cursos-pendientes/cursos-pendientes.venta.js');
const conversionService = await import('../src/modules/conversions/conversion.service.js');
const productService = await import('../src/modules/products/product.service.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `CV7${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], leads: [], products: [] };
let P; let ADMIN; let TUTORA; let REDACTOR;
const jwtDe = (u) => jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' });
const como = (u) => ({ Authorization: `Bearer ${jwtDe(u)}` });
const ZONA = process.env.APP_TIMEZONE || 'Europe/Madrid';
const dia = (n) => {
  const [a, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: ZONA }).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};
const nombre = (s) => `${MARCA} ${s}`;
const avisos = (tipo, userId) => q(`SELECT title, message FROM admin_notifications WHERE type = $1 AND $2 = ANY(target_user_ids) ORDER BY id`, [tipo, userId]);
const fechaDe = (f) => (f instanceof Date ? f.toLocaleDateString('en-CA') : String(f).slice(0, 10));

async function persona(n, role, campus = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role, nombre`,
    [nombre(n), `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, c]);
  return u;
}

async function alumna(n) {
  const [l] = await q(`INSERT INTO leads (project_id, nombre, email, telefono) VALUES ($1, $2, $3, '+34600111222') RETURNING id`,
    [P, nombre(n), `${n.toLowerCase()}@lead.${MARCA.toLowerCase()}.test`]);
  ids.leads.push(l.id);
  return l.id;
}

async function producto(n, extra = {}) {
  const [p] = await q(
    `INSERT INTO products (project_id, nombre, sin_desarrollar, responsable_desarrollo_id, plazo_desarrollo_dias)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [P, nombre(n), extra.sin_desarrollar ?? true, extra.responsable ?? null, extra.plazo ?? null]);
  ids.products.push(p.id);
  return p.id;
}

/** Una venta de verdad, por el mismo camino que el formulario de Ventas. */
const vender = (leadId, datos) => conversionService.create({
  lead_id: leadId, project_id: P, importe_total: 900, importe_pagado: 0, metodo_pago: 'transferencia', ...datos,
}, ADMIN.id);

const pendientesDe = (productId) => q(
  `SELECT c.*, (SELECT count(*)::int FROM cursos_pendientes_alumnas a WHERE a.curso_id = c.id) AS alumnas
     FROM cursos_pendientes c WHERE c.product_id = $1 ORDER BY c.id`, [productId]);

beforeAll(async () => {
  const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [nombre('Campus'), `${MARCA.toLowerCase()}-a`, `${MARCA}-key`]);
  P = p.id; ids.projects.push(P);
  ADMIN = await persona('ADMIN', 'admin', [P]);
  TUTORA = await persona('TUTORA', 'tutor', [P]);
  REDACTOR = await persona('REDACTOR', 'tutor_redactor', [P]);
}, 60000);

afterAll(async () => {
  const borrar = [
    [`DELETE FROM admin_notifications WHERE title LIKE $1 OR message LIKE $1`, [`%${MARCA}%`]],
    [`DELETE FROM cursos_pendientes WHERE project_id = ANY($1::int[])`, [ids.projects]],
    [`DELETE FROM commissions WHERE conversion_id IN (SELECT id FROM conversions WHERE project_id = ANY($1::int[]))`, [ids.projects]],
    [`DELETE FROM conversion_items WHERE conversion_id IN (SELECT id FROM conversions WHERE project_id = ANY($1::int[]))`, [ids.projects]],
    [`DELETE FROM conversions WHERE project_id = ANY($1::int[])`, [ids.projects]],
    [`DELETE FROM lead_status_history WHERE lead_id = ANY($1::int[])`, [ids.leads]],
    [`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]],
    [`DELETE FROM products WHERE id = ANY($1::int[])`, [ids.products]],
    [`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]],
    [`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]],
    [`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]],
  ];
  for (const [sql, params] of borrar) await q(sql, params).catch(() => {});
  await pool.end();
}, 60000);

// ── Lo que se puede configurar ───────────────────────────────────────────

describe('plazo y tipo de serie (decisiones abiertas)', () => {
  it('sin variable: 30 días un curso, 45 un diplomado, 60 un máster', () => {
    expect(plazosPorDefecto('')).toEqual({ curso: 30, diplomado: 45, master: 60 });
  });
  it('«20» vale para todos; «master=90» solo cambia ese; lo que no se entiende se ignora', () => {
    expect(plazosPorDefecto('20')).toEqual({ curso: 20, diplomado: 20, master: 20 });
    expect(plazosPorDefecto('master=90, curso=x, nada=3')).toEqual({ curso: 30, diplomado: 45, master: 90 });
    expect(plazosPorDefecto('0')).toEqual({ curso: 30, diplomado: 45, master: 60 });
  });
  it('el tipo sale del nombre, con o sin tilde', () => {
    expect(tipoPorNombre('Máster en Neuropsicología')).toBe('master');
    expect(tipoPorNombre('Diplomado en Logopedia')).toBe('diplomado');
    expect(tipoPorNombre('Curso de Mindfulness')).toBe('curso');
  });
}, 60000);

// ── La venta ─────────────────────────────────────────────────────────────

describe('vender un curso sin desarrollar', () => {
  let PROD; let LEAD_1; let LEAD_2; let CURSO;

  beforeAll(async () => {
    PROD = await producto('Curso de Apego', { responsable: REDACTOR.id, plazo: 20 });
    LEAD_1 = await alumna('Ana');
    LEAD_2 = await alumna('Berta');
  });

  it('crea su pendiente, asignado al redactor responsable, con la fecha límite = venta + plazo', async () => {
    const venta = await vender(LEAD_1, { producto_contratado_id: PROD });
    const [c] = await pendientesDe(PROD);
    CURSO = c;
    expect(c).toMatchObject({ project_id: P, estado: 'asignado', tutor_id: REDACTOR.id, tipo: 'curso', alumnas: 1 });
    expect(fechaDe(c.fecha_comprometida)).toBe(dia(20));
    const [a] = await q(`SELECT lead_id, conversion_id, estado FROM cursos_pendientes_alumnas WHERE curso_id = $1`, [c.id]);
    expect(a).toEqual({ lead_id: LEAD_1, conversion_id: venta.id, estado: 'en_espera' });
    const h = await q(`SELECT accion, detalle FROM cursos_pendientes_historial WHERE curso_id = $1 ORDER BY id`, [c.id]);
    expect(h.map((x) => x.accion)).toEqual(['creado', 'alumna_sumada']);
    expect(h[0].detalle).toMatchObject({ origen: 'venta', conversion_id: venta.id, plazo_dias: 20 });
  });

  it('avisa al redactor con la fecha límite', async () => {
    const [n] = await avisos('curso_pendiente_asignado', REDACTOR.id);
    expect(n.title).toBe(`Te han asignado un curso: ${nombre('Curso de Apego')}`);
    expect(n.message).toContain(`Fecha límite: ${dia(20)}`);
  });

  it('venderlo otra vez suma la alumna al mismo pendiente, sin duplicarlo, y el redactor se entera', async () => {
    await vender(LEAD_2, { producto_contratado_id: PROD });
    const filas = await pendientesDe(PROD);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: CURSO.id, alumnas: 2 });
    expect((await avisos('curso_pendiente_alumna', REDACTOR.id)).map((n) => n.title)).toContain(`Una alumna más espera: ${nombre('Curso de Apego')}`);
  });

  it('la misma venta repasada otra vez no suma a nadie dos veces', async () => {
    const [{ id }] = await q(`SELECT id FROM conversions WHERE lead_id = $1`, [LEAD_2]);
    const r = await alVender({ conversionId: id, userId: ADMIN.id });
    expect(r).toEqual([expect.objectContaining({ nuevo: false, alumna_sumada: false })]);
    expect((await pendientesDe(PROD))[0].alumnas).toBe(2);
  });

  it('un curso que NO está marcado no crea nada', async () => {
    const otro = await producto('Curso ya hecho', { sin_desarrollar: false });
    await vender(await alumna('Carla'), { producto_contratado_id: otro });
    expect(await pendientesDe(otro)).toHaveLength(0);
  });

  it('en una venta de varias líneas, solo el curso marcado', async () => {
    const hecho = await producto('Curso hecho en líneas', { sin_desarrollar: false });
    const sinHacer = await producto('Diplomado en Duelo', { responsable: TUTORA.id });
    await vender(await alumna('Dora'), {
      items: [
        { descripcion: 'Uno', cantidad: 1, precio_unitario: 400, product_id: hecho },
        { descripcion: 'Dos', cantidad: 1, precio_unitario: 500, product_id: sinHacer },
      ],
    });
    expect(await pendientesDe(hecho)).toHaveLength(0);
    const [c] = await pendientesDe(sinHacer);
    // Diplomado, sin plazo propio: el de serie (45 días).
    expect(c).toMatchObject({ tipo: 'diplomado', tutor_id: TUTORA.id, estado: 'asignado' });
    expect(fechaDe(c.fecha_comprometida)).toBe(dia(45));
  });

  it('sin responsable: queda sin asignar y administración se entera para asignarlo', async () => {
    const prod = await producto('Máster en Trauma');
    await vender(await alumna('Elena'), { producto_contratado_id: prod });
    const [c] = await pendientesDe(prod);
    expect(c).toMatchObject({ estado: 'pendiente_asignar', tutor_id: null, tipo: 'master' });
    expect(fechaDe(c.fecha_comprometida)).toBe(dia(60));
    expect((await avisos('curso_pendiente_sin_tutora', ADMIN.id)).map((n) => n.title))
      .toContain(`Vendido sin desarrollar y sin responsable: ${nombre('Máster en Trauma')}`);
  });

  it('una venta que no existe no lanza: la venta nunca se rompe por esto', async () => {
    await expect(alVender({ conversionId: 2147480000 })).resolves.toEqual([]);
  });
}, 60000);

// ── El responsable en Productos ──────────────────────────────────────────

describe('el responsable del producto', () => {
  it('tiene que ser un tutor o un tutor redactor de alta', async () => {
    const prod = await producto('Curso con responsable', { sin_desarrollar: false });
    await expect(productService.update(prod, P, { responsable_desarrollo_id: ADMIN.id })).rejects.toMatchObject({ statusCode: 400 });
    const r = await productService.update(prod, P, { sin_desarrollar: true, responsable_desarrollo_id: REDACTOR.id, plazo_desarrollo_dias: 15 });
    expect(r).toMatchObject({ sin_desarrollar: true, responsable_desarrollo_id: REDACTOR.id, plazo_desarrollo_dias: 15 });
  });
}, 60000);

// ── El panel: el redactor y el estado «entregado» ────────────────────────

describe('el tutor redactor en Cursos pendientes, y el estado «entregado»', () => {
  let ID;
  const cambiar = (u, cuerpo) => request.patch(`/api/cursos-pendientes/${ID}`).set(como(u)).send(cuerpo);

  beforeAll(async () => {
    const [c] = await q(`INSERT INTO cursos_pendientes (project_id, nombre, tipo, created_by) VALUES ($1, $2, 'curso', $3) RETURNING id`,
      [P, nombre('Curso del panel'), ADMIN.id]);
    ID = c.id;
  });

  it('el servidor le deja entrar (antes, 403 en verifyToken)', async () => {
    let error = null;
    const req = { headers: { authorization: `Bearer ${jwtDe(REDACTOR)}` }, originalUrl: '/api/cursos-pendientes?projectId=1' };
    await verifyToken(req, {}, (e) => { error = e || null; });
    expect(error).toBeNull();
  });

  it('un admin puede asignárselo (antes, 400 «no es una tutora activa»)', async () => {
    const r = await cambiar(ADMIN, { tutor_id: REDACTOR.id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ tutor_id: REDACTOR.id, estado: 'asignado' });
  });

  it('el redactor ve solo lo suyo, como una tutora', async () => {
    const r = await request.get('/api/cursos-pendientes').set(como(REDACTOR));
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
    expect(r.body.data.every((c) => c.tutor_id === REDACTOR.id)).toBe(true);
    expect(r.body.data.map((c) => c.id)).toContain(ID);
  });

  it('no se entrega lo que no está en desarrollo', async () => {
    expect((await cambiar(REDACTOR, { estado: 'entregado' })).status).toBe(409);
  });

  it('en desarrollo → entregado: administración se entera y ya no cuenta como retrasado', async () => {
    expect((await cambiar(REDACTOR, { fecha_comprometida: dia(5) })).status).toBe(200);
    expect((await cambiar(REDACTOR, { estado: 'en_desarrollo' })).status).toBe(200);
    const r = await cambiar(REDACTOR, { estado: 'entregado' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.estado).toBe('entregado');
    expect((await avisos('curso_pendiente_entregado', ADMIN.id)).map((n) => n.title)).toContain(`Entregado, falta publicarlo: ${nombre('Curso del panel')}`);
    await q(`UPDATE cursos_pendientes SET fecha_comprometida = $2 WHERE id = $1`, [ID, dia(-3)]);
    const d = (await request.get(`/api/cursos-pendientes/${ID}`).set(como(ADMIN))).body.data;
    expect(d.retrasado).toBe(false);
  });

  it('devolverlo: solo un admin, y con motivo; el redactor se entera', async () => {
    expect((await cambiar(REDACTOR, { estado: 'en_desarrollo', motivo: 'me lo devuelvo' })).status).toBe(403);
    expect((await cambiar(ADMIN, { estado: 'en_desarrollo' })).status).toBe(400);
    const r = await cambiar(ADMIN, { estado: 'en_desarrollo', motivo: 'Falta el módulo 3' });
    expect(r.status).toBe(200);
    expect(r.body.data.estado).toBe('en_desarrollo');
    const [n] = await avisos('curso_pendiente_devuelto', REDACTOR.id);
    expect(n.message).toContain('Falta el módulo 3');
  });
}, 60000);

// ── La fecha vencida avisa a administración ──────────────────────────────

describe('una fecha límite vencida', () => {
  it('avisa al responsable y a administración', async () => {
    const prod = await producto('Curso que se pasa de fecha', { responsable: TUTORA.id, plazo: 10 });
    await vender(await alumna('Fani'), { producto_contratado_id: prod });
    const [c] = await pendientesDe(prod);
    await q(`UPDATE cursos_pendientes SET fecha_comprometida = $2 WHERE id = $1`, [c.id, dia(-1)]);
    await avisarVencimientos();
    const titulo = `Retrasado: ${nombre('Curso que se pasa de fecha')}`;
    for (const u of [TUTORA, ADMIN]) expect((await avisos('curso_pendiente_retrasado', u.id)).map((n) => n.title)).toContain(titulo);
  });
}, 60000);
