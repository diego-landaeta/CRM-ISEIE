import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM#957 · Unir cada producto del catálogo con su curso de Moodle (lo lee la
 * matrícula automática, #767), con la base de verdad y Moodle simulado.
 *
 * Lo que se defiende:
 *   · los productos del campus salen con su curso, o sin él, y el aviso cuenta
 *     los vendidos sin curso;
 *   · la lista de cursos viene del Moodle del campus (plugin; si no, el panel);
 *   · unir, cambiar y quitar escriben `moodle_cursos_producto`, con el nombre
 *     que dice Moodle y no el que manda el navegador; un curso que no existe en
 *     ese Moodle es un 404;
 *   · la matrícula automática ve la unión (`productosConCursos`);
 *   · el permiso `moodle.cursos_producto`: admin y soporte sí, gestora no; un
 *     campus ajeno es un 403 y un producto de otro campus, un 404.
 *
 *   npx vitest run tests/moodleCursosProducto957.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/moodle/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const credenciales = await import('../src/modules/credentials/credentials.model.js');
const { vaciarCacheCursosProducto } = await import('../src/modules/moodle/moodle.cursosProducto.controller.js');
const matricula = await import('../src/modules/matricula-moodle/matricula-moodle.model.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `M957${Date.now().toString(36)}`;
const PLUGIN = `https://${MARCA.toLowerCase()}.plugin.test`;
const PANEL = `https://${MARCA.toLowerCase()}.panel.test`;
const TOKEN = `tok${MARCA}0123456789abcdef`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const json = (c) => new Response(JSON.stringify(c), { status: 200, headers: { 'content-type': 'application/json' } });

const CURSOS = [
  { id: 41, fullname: 'Máster en Neuropsicología', displayname: 'Máster en Neuropsicología', shortname: 'MN', visible: 1, format: 'topics' },
  { id: 42, fullname: 'Curso de Logopedia', displayname: 'Curso de Logopedia', shortname: 'CL', visible: 0, format: 'topics' },
  { id: 1, fullname: 'Sitio', shortname: 'sitio', format: 'site' },
];
let llamadas = 0;

let CAMPUS; let SOLO_PANEL; let SIN_MOODLE; let AJENO; let IA;
let ADMIN; let SOPORTE; let GESTORA;
let VENDIDO; let SIN_VENTAS; let DESACTIVADO; let DE_OTRO;

beforeAll(async () => {
  const proy = async (c) => {
    const [p] = await q('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  CAMPUS = await proy('campus'); SOLO_PANEL = await proy('panel'); SIN_MOODLE = await proy('sin'); AJENO = await proy('ajeno');
  IA = await proy('ia');
  await q(`UPDATE projects SET type = 'ia' WHERE id = $1`, [IA]);

  const enc = encrypt(TOKEN);
  await q(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
    [CAMPUS, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url: `${PLUGIN}/` })]);
  await credenciales.upsert({ project_id: SOLO_PANEL, service: 'moodle', entorno: 'produccion', value: JSON.stringify({ url: PANEL, token: TOKEN }) });

  const persona = async (n, role, campus) => {
    const [u] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
      [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  ADMIN = await persona('ADMIN', 'admin', [CAMPUS, SOLO_PANEL, SIN_MOODLE, IA]);
  SOPORTE = await persona('SOPORTE', 'soporte', [CAMPUS]);
  GESTORA = await persona('GESTORA', 'gestor', [CAMPUS]);

  const prod = async (campus, nombre, active = true) => {
    const [p] = await q('INSERT INTO products (project_id, nombre, active) VALUES ($1, $2, $3) RETURNING id', [campus, `${MARCA} ${nombre}`, active]);
    return p.id;
  };
  VENDIDO = await prod(CAMPUS, 'Máster vendido');
  SIN_VENTAS = await prod(CAMPUS, 'Curso sin ventas');
  DESACTIVADO = await prod(CAMPUS, 'Viejo sin nada', false);
  DE_OTRO = await prod(AJENO, 'De otro campus');
  const [lead] = await q('INSERT INTO leads (nombre, email, project_id) VALUES ($1, $2, $3) RETURNING id', [`${MARCA} alumna`, `a@${MARCA.toLowerCase()}.test`, CAMPUS]);
  const [venta] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, fecha_conversion)
     VALUES ($1, $2, 'Máster', $3, 900, CURRENT_DATE) RETURNING id`, [lead.id, CAMPUS, VENDIDO]);
  ids.venta = venta.id;
}, 60000);

afterAll(async () => {
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM conversions WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM leads WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM api_credentials WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM project_integrations WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
}, 60000);

beforeEach(() => {
  vaciarCacheCursosProducto();
  llamadas = 0;
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const origen = [PLUGIN, PANEL].find((o) => String(url) === `${o}/webservice/rest/server.php`);
    if (!origen) return original(url, init);
    llamadas += 1;
    const p = new URLSearchParams(init.body);
    if (p.get('wstoken') !== TOKEN) return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'x' });
    if (p.get('wsfunction') !== 'core_course_get_courses_by_field') return json({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'x' });
    return json({ courses: CURSOS });
  }));
});

const fila = (r, id) => r.body.data.productos.find((p) => p.id === id);

describe('#957 · productos y cursos de Moodle', () => {
  it('lista los productos del campus, sin curso al principio, y avisa de los vendidos sin curso', async () => {
    const r = await request.get(`/api/moodle/campus/${CAMPUS}/productos-cursos`).set(como(ADMIN));
    expect(r.status).toBe(200);
    const nombres = r.body.data.productos.map((p) => p.id);
    expect(nombres).toContain(VENDIDO);
    expect(nombres).toContain(SIN_VENTAS);
    // Desactivado, sin curso y sin ventas: no hace falta unirlo.
    expect(nombres).not.toContain(DESACTIVADO);
    expect(nombres).not.toContain(DE_OTRO);
    expect(fila(r, VENDIDO)).toMatchObject({ ventas: 1, cursos: [] });
    expect(r.body.data.resumen).toMatchObject({ total: 2, con_curso: 0, sin_curso: 2, vendidos_sin_curso: 1 });
  });

  it('los cursos vienen del Moodle del campus, sin el «sitio», y la caché no vuelve a preguntar', async () => {
    const r = await request.get(`/api/moodle/campus/${CAMPUS}/cursos-moodle`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.data.via).toBe('plugin');
    expect(r.body.data.cursos).toEqual([
      { id: 42, nombre: 'Curso de Logopedia', visible: false },
      { id: 41, nombre: 'Máster en Neuropsicología', visible: true },
    ]);
    await request.get(`/api/moodle/campus/${CAMPUS}/cursos-moodle`).set(como(ADMIN));
    expect(llamadas).toBe(1);
    await request.get(`/api/moodle/campus/${CAMPUS}/cursos-moodle?refrescar=1`).set(como(ADMIN));
    expect(llamadas).toBe(2);
    // El token no sale nunca.
    expect(JSON.stringify(r.body)).not.toContain(TOKEN);
  });

  it('sin plugin, por la conexión del panel; sin ninguna, un 409 que lo dice', async () => {
    const r = await request.get(`/api/moodle/campus/${SOLO_PANEL}/cursos-moodle`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.data.via).toBe('panel');
    const s = await request.get(`/api/moodle/campus/${SIN_MOODLE}/cursos-moodle`).set(como(ADMIN));
    expect(s.status).toBe(409);
    expect(s.body.code).toBe('MOODLE_SIN_CONECTAR');
  });

  it('unir, cambiar y quitar: la tabla queda con un curso y el nombre que dice Moodle', async () => {
    const url = `/api/moodle/campus/${CAMPUS}/productos/${VENDIDO}/curso`;
    const u = await request.put(url).set(como(ADMIN)).send({ curso_moodle_id: 41, curso_nombre: 'Lo que diga el navegador' });
    expect(u.status).toBe(200);
    expect(u.body.data).toMatchObject({ curso_moodle_id: 41, curso_nombre: 'Máster en Neuropsicología', antes: [] });
    let filas = await q('SELECT curso_moodle_id::int AS id, curso_nombre, creado_por FROM moodle_cursos_producto WHERE product_id = $1', [VENDIDO]);
    expect(filas).toEqual([{ id: 41, curso_nombre: 'Máster en Neuropsicología', creado_por: ADMIN.id }]);

    // La matrícula automática lo ve.
    const [p] = await matricula.productosConCursos(ids.venta);
    expect(p.cursos).toEqual([{ project_id: CAMPUS, curso_moodle_id: 41, curso_nombre: 'Máster en Neuropsicología' }]);

    const c = await request.put(url).set(como(ADMIN)).send({ curso_moodle_id: 42 });
    expect(c.status).toBe(200);
    expect(c.body.data.antes).toEqual([{ curso_moodle_id: '41', curso_nombre: 'Máster en Neuropsicología' }]);
    filas = await q('SELECT curso_moodle_id::int AS id FROM moodle_cursos_producto WHERE product_id = $1', [VENDIDO]);
    expect(filas).toEqual([{ id: 42 }]);

    const l = await request.get(`/api/moodle/campus/${CAMPUS}/productos-cursos`).set(como(ADMIN));
    expect(fila(l, VENDIDO).cursos).toEqual([{ curso_moodle_id: 42, curso_nombre: 'Curso de Logopedia' }]);
    expect(l.body.data.resumen).toMatchObject({ con_curso: 1, sin_curso: 1, vendidos_sin_curso: 0 });

    const d = await request.delete(url).set(como(ADMIN));
    expect(d.status).toBe(200);
    expect(d.body.data.quitados).toBe(1);
    expect(await q('SELECT 1 FROM moodle_cursos_producto WHERE product_id = $1', [VENDIDO])).toEqual([]);

    // Queda apuntado quién lo hizo.
    const log = await q(`SELECT action FROM user_activity_log WHERE user_id = $1 AND action LIKE 'moodle.%' ORDER BY id`, [ADMIN.id]);
    expect(log.map((x) => x.action)).toEqual(['moodle.unir_curso_producto', 'moodle.unir_curso_producto', 'moodle.quitar_curso_producto']);
  });

  it('un curso que no está en ese Moodle es un 404 y no se guarda nada', async () => {
    const r = await request.put(`/api/moodle/campus/${CAMPUS}/productos/${SIN_VENTAS}/curso`).set(como(ADMIN)).send({ curso_moodle_id: 999 });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('CURSO_NO_EXISTE');
    expect(await q('SELECT 1 FROM moodle_cursos_producto WHERE product_id = $1', [SIN_VENTAS])).toEqual([]);
    const b = await request.put(`/api/moodle/campus/${CAMPUS}/productos/${SIN_VENTAS}/curso`).set(como(ADMIN)).send({ curso_moodle_id: 'x' });
    expect(b.status).toBe(400);
  });

  it('soporte entra; la gestora no tiene el permiso', async () => {
    expect((await request.get(`/api/moodle/campus/${CAMPUS}/productos-cursos`).set(como(SOPORTE))).status).toBe(200);
    expect((await request.get(`/api/moodle/campus/${CAMPUS}/productos-cursos`).set(como(GESTORA))).status).toBe(403);
    expect((await request.put(`/api/moodle/campus/${CAMPUS}/productos/${VENDIDO}/curso`).set(como(GESTORA)).send({ curso_moodle_id: 41 })).status).toBe(403);
  });

  it('un campus ajeno es un 403, un producto de otro campus un 404 y una plataforma de IA no tiene Moodle', async () => {
    expect((await request.get(`/api/moodle/campus/${AJENO}/productos-cursos`).set(como(ADMIN))).status).toBe(403);
    // El producto de otro campus, por la ruta de uno propio.
    const r = await request.put(`/api/moodle/campus/${CAMPUS}/productos/${DE_OTRO}/curso`).set(como(ADMIN)).send({ curso_moodle_id: 41 });
    expect(r.status).toBe(404);
    expect((await request.delete(`/api/moodle/campus/${CAMPUS}/productos/${DE_OTRO}/curso`).set(como(ADMIN))).status).toBe(404);
    const ia = await request.get(`/api/moodle/campus/${IA}/productos-cursos`).set(como(ADMIN));
    expect(ia.status).toBe(400);
    expect(ia.body.code).toBe('NO_ES_CAMPUS');
  });
});
