import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM#1215 · Formaciones: al guardar, el `orden` de los módulos pasaba de 1…6 a 0…5.
 *
 * El temario de la web (temario.js) los deja 1…n —como las secciones de Moodle, donde la 0
 * es «General»— y la ficha de la formación (guardarModulos) los reescribía 0…n-1. Ahora
 * todos los que escriben `product_modules.orden` lo sacan del mismo sitio
 * (`ordenDeLaPosicion`): 1…n.
 *
 * Lo que se defiende, con la base de verdad y Moodle simulado:
 *   · guardar una formación con 6 módulos 1…6 los deja 1…6;
 *   · crearla con 6 módulos, 1…6;
 *   · reordenar mantiene los ids y deja 1…6 en el orden nuevo;
 *   · guardar dos veces seguidas no desplaza nada;
 *   · lo que se manda a Moodle va en su sección: el módulo de orden N, en la sección N;
 *   · la API vieja de módulos (añadir y reordenar) y el importador, también desde el 1.
 *
 *   npx vitest run tests/formacionesOrden1215.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/products/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const { vaciarCacheDelCampus } = await import('../src/modules/products/formacion.moodle.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `FO1215${Date.now().toString(36)}`;
const PLUGIN = `https://${MARCA.toLowerCase()}.plugin.test`;
const TOKEN = `tok${MARCA}0123456789abcdef`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const json = (c) => new Response(JSON.stringify(c), { status: 200, headers: { 'content-type': 'application/json' } });

const TITULOS = ['Fundamentos', 'Evaluación', 'Diagnóstico', 'Intervención', 'Casos', 'Trabajo final'];
const UNO_A_SEIS = [1, 2, 3, 4, 5, 6];

let CAMPUS; let ADMIN; let FORMACION;
let llamadas = [];

const enLaBase = (productId) => q('SELECT id, orden, titulo FROM product_modules WHERE product_id = $1 ORDER BY orden, id', [productId]);
const ficha = async (productId) => (await request.get(`/api/products/${productId}/formacion?projectId=${CAMPUS}`).set(como(ADMIN))).body.data;
const guardar = (productId, nombre, modulos) => request.put(`/api/products/${productId}/formacion`).set(como(ADMIN))
  .send({ projectId: CAMPUS, nombre, modulos });
// Lo que manda la pantalla al pulsar «Guardar»: los módulos tal cual los tiene (sin `orden`).
const comoLosManda = (modulos) => modulos.map(({ id, titulo, descripcion, horas }) => ({ id, titulo, descripcion, horas }));

beforeAll(async () => {
  const [p] = await q('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} campus`, `${MARCA.toLowerCase()}-campus`, `${MARCA}-key`]);
  ids.projects.push(p.id);
  CAMPUS = p.id;
  const enc = encrypt(TOKEN);
  await q(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
    [CAMPUS, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url: `${PLUGIN}/` })]);
  const [u] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id, role`,
    [`${MARCA} ADMIN`, `admin@${MARCA.toLowerCase()}.test`]);
  ids.users.push(u.id);
  ADMIN = u;
  await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, CAMPUS]);

  // Como la [PRUEBA] 9820 de /testeo: seis módulos 1…6, tal como los deja el temario de la web.
  const [f] = await q(`INSERT INTO products (project_id, nombre, tipo_formacion, num_modulos) VALUES ($1, $2, 'diplomado', 6) RETURNING id`,
    [CAMPUS, `${MARCA} Diplomado en Voz`]);
  FORMACION = f.id;
  for (const [i, t] of TITULOS.entries()) {
    await q('INSERT INTO product_modules (product_id, titulo, orden) VALUES ($1, $2, $3)', [FORMACION, t, i + 1]);
  }
}, 60000);

afterAll(async () => {
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM moodle_cursos_producto WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM products WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM project_integrations WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
}, 60000);

beforeEach(() => {
  llamadas = [];
  vaciarCacheDelCampus();
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    if (String(url) !== `${PLUGIN}/webservice/rest/server.php`) return original(url, init);
    const cuerpo = new URLSearchParams(String(init.body));
    llamadas.push(cuerpo);
    const funcion = cuerpo.get('wsfunction');
    if (funcion === 'core_course_get_courses_by_field') return json({ courses: [{ id: 1, format: 'site', shortname: 'portada', categoryid: 0 }] });
    if (funcion === 'core_course_get_categories') return json({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'no' });
    if (funcion !== 'local_crm_curso_guardar') return json({ exception: 'x', errorcode: 'invalidrecord', message: 'no' });
    // Como el plugin: la sección 0 es «General»; la que llega en la posición i es la sección i + 1.
    const secciones = [];
    for (let i = 0; cuerpo.has(`secciones[${i}][nombre]`); i++) secciones.push({ numero: i + 1, id: 9000 + i });
    return json({
      cursoid: Number(cuerpo.get('cursoid')) || 777, nombre: cuerpo.get('nombre'), nombrecorto: cuerpo.get('nombrecorto'),
      creado: !Number(cuerpo.get('cursoid')), visible: false, secciones, sobran: 0,
    });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Formaciones: el orden de los módulos al guardar (CRM#1215)', () => {
  it('guardar una formación con 6 módulos 1…6 los deja 1…6', async () => {
    const antes = await ficha(FORMACION);
    expect(antes.modulos.map((m) => m.orden)).toEqual(UNO_A_SEIS);
    const r = await guardar(FORMACION, antes.nombre, comoLosManda(antes.modulos));
    expect(r.status).toBe(200);
    expect(r.body.data.modulos.map((m) => [m.orden, m.titulo])).toEqual(TITULOS.map((t, i) => [i + 1, t]));
    expect((await enLaBase(FORMACION)).map((m) => m.orden)).toEqual(UNO_A_SEIS);
  });

  it('crear una formación con 6 módulos: 1…6', async () => {
    const r = await request.post('/api/products/formacion').set(como(ADMIN)).send({
      projectId: CAMPUS, nombre: `${MARCA} Curso nuevo`, tipo_formacion: 'curso', modulos: TITULOS.map((titulo) => ({ titulo })),
    });
    expect(r.status).toBe(201);
    expect(r.body.data.modulos.map((m) => m.orden)).toEqual(UNO_A_SEIS);
    expect((await enLaBase(r.body.data.id)).map((m) => m.orden)).toEqual(UNO_A_SEIS);
  });

  it('reordenar: los mismos módulos (mismos ids), 1…6 en el orden nuevo', async () => {
    const antes = await ficha(FORMACION);
    // «Trabajo final» sube a la primera posición; el resto, igual.
    const nuevo = [antes.modulos[5], ...antes.modulos.slice(0, 5)];
    const r = await guardar(FORMACION, antes.nombre, comoLosManda(nuevo));
    expect(r.status).toBe(200);
    const filas = await enLaBase(FORMACION);
    expect(filas.map((m) => m.orden)).toEqual(UNO_A_SEIS);
    expect(filas.map((m) => m.titulo)).toEqual(['Trabajo final', ...TITULOS.slice(0, 5)]);
    expect(filas.map((m) => Number(m.id))).toEqual(nuevo.map((m) => m.id));
  });

  it('guardar dos veces seguidas no desplaza nada', async () => {
    const antes = await enLaBase(FORMACION);
    for (let vez = 0; vez < 2; vez++) {
      const f = await ficha(FORMACION);
      expect((await guardar(FORMACION, f.nombre, comoLosManda(f.modulos))).status).toBe(200);
    }
    expect(await enLaBase(FORMACION)).toEqual(antes);
    expect(antes.map((m) => m.orden)).toEqual(UNO_A_SEIS);
  });

  it('lo que se manda a Moodle va en su sección: el módulo de orden N, en la sección N', async () => {
    const r = await request.post(`/api/products/${FORMACION}/formacion/moodle`).set(como(ADMIN)).send({ projectId: CAMPUS });
    expect(r.status).toBe(200);
    const c = llamadas.find((x) => x.get('wsfunction') === 'local_crm_curso_guardar');
    const enviadas = [];
    for (let i = 0; c.has(`secciones[${i}][nombre]`); i++) enviadas.push({ seccion: i + 1, titulo: c.get(`secciones[${i}][nombre]`) });
    // Seis secciones, ninguna de más ni de menos, y ninguna en la 0 («General»).
    expect(enviadas).toHaveLength(6);
    const filas = await enLaBase(FORMACION);
    expect(enviadas).toEqual(filas.map((m) => ({ seccion: m.orden, titulo: m.titulo })));
    expect(r.body.data.curso.secciones.map((s) => s.numero)).toEqual(UNO_A_SEIS);
  });

  it('la API vieja de módulos: añadir va detrás del último y reordenar deja 1…n', async () => {
    const [p] = await q('INSERT INTO products (project_id, nombre) VALUES ($1, $2) RETURNING id', [CAMPUS, `${MARCA} Vieja`]);
    const uno = await request.post(`/api/products/${p.id}/modules?projectId=${CAMPUS}`).set(como(ADMIN)).send({ projectId: CAMPUS, titulo: 'Uno' });
    const dos = await request.post(`/api/products/${p.id}/modules?projectId=${CAMPUS}`).set(como(ADMIN)).send({ projectId: CAMPUS, titulo: 'Dos' });
    expect([uno.status, dos.status]).toEqual([201, 201]);
    expect((await enLaBase(p.id)).map((m) => [m.orden, m.titulo])).toEqual([[1, 'Uno'], [2, 'Dos']]);
    const r = await request.post(`/api/products/${p.id}/modules/reorder?projectId=${CAMPUS}`).set(como(ADMIN))
      .send({ projectId: CAMPUS, ids: [dos.body.data.id, uno.body.data.id] });
    expect(r.status).toBe(200);
    expect((await enLaBase(p.id)).map((m) => [m.orden, m.titulo])).toEqual([[1, 'Dos'], [2, 'Uno']]);
  });
});
