import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM#1124 · Formaciones: «se desbloquea a los X días» por módulo, como el plugin de
 * Moodle (`availability_relativedate`). Con la base de verdad y Moodle simulado.
 *
 * Lo que se defiende:
 *   · cada módulo guarda sus días (vacío o 0 = desde el principio) y la ficha los devuelve;
 *     un módulo que no trae la clave se queda como estaba;
 *   · va con la fase 2: con el interruptor apagado (producción) no se escribe nada;
 *   · «Crear en Moodle» manda `secciones[i][dias]` solo en los módulos con días, y los
 *     avisos del plugin («sin_relativedate») llegan dichos para quien los lee;
 *   · la vista previa dice a los cuántos días se abre cada sección.
 *
 *   npx vitest run tests/formacionesDesbloqueo1124.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/products/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const { datosDelCurso, diasDeDesbloqueo, textoDelAviso, vaciarCacheDelCampus } = await import('../src/modules/products/formacion.moodle.js');
const { formacionSchema } = await import('../src/modules/products/formacion.validation.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `FD1124${Date.now().toString(36)}`;
const PLUGIN = `https://${MARCA.toLowerCase()}.plugin.test`;
const TOKEN = `tok${MARCA}0123456789abcdef`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const json = (c) => new Response(JSON.stringify(c), { status: 200, headers: { 'content-type': 'application/json' } });

let CAMPUS; let ADMIN; let FORMACION;
let llamadas = [];
let avisosDelPlugin = [];

const modulosGuardados = () => q('SELECT titulo, dias_desbloqueo FROM product_modules WHERE product_id = $1 ORDER BY orden, id', [FORMACION]);
const ficha = () => request.get(`/api/products/${FORMACION}/formacion?projectId=${CAMPUS}`).set(como(ADMIN));
const guardar = (modulos) => request.put(`/api/products/${FORMACION}/formacion`).set(como(ADMIN))
  .send({ projectId: CAMPUS, nombre: `${MARCA} Máster en Voz`, modulos });

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
  const [f] = await q(`INSERT INTO products (project_id, nombre, tipo_formacion, fecha_inicio) VALUES ($1, $2, 'master', '2027-02-01') RETURNING id`,
    [CAMPUS, `${MARCA} Máster en Voz`]);
  FORMACION = f.id;
  await q(`INSERT INTO product_modules (product_id, titulo, orden) VALUES ($1, 'Fundamentos', 0), ($1, 'Práctica', 1), ($1, 'Final', 2)`, [FORMACION]);
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
  avisosDelPlugin = [];
  vaciarCacheDelCampus();
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    if (String(url) !== `${PLUGIN}/webservice/rest/server.php`) return original(url, init);
    const cuerpo = new URLSearchParams(String(init.body));
    llamadas.push(cuerpo);
    const funcion = cuerpo.get('wsfunction');
    if (funcion === 'core_course_get_courses_by_field') return json({ courses: [] });
    if (funcion === 'core_course_get_categories') return json([{ id: 9, name: 'Másteres', parent: 0, depth: 1, coursecount: 0 }]);
    if (funcion !== 'local_crm_curso_guardar') return json({ exception: 'x', errorcode: 'invalidrecord', message: 'no' });
    return json({
      cursoid: Number(cuerpo.get('cursoid')) || 701, nombre: cuerpo.get('nombre'), nombrecorto: cuerpo.get('nombrecorto'),
      creado: !Number(cuerpo.get('cursoid')), visible: false, delcrm: true,
      secciones: [{ numero: 1, id: 1 }, { numero: 2, id: 2 }, { numero: 3, id: 3 }], sobran: 0, avisos: avisosDelPlugin,
    });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('el campo (sin base)', () => {
  it('vacío o 0 es «desde el principio»; entero de 1 a 3650', () => {
    const dias = (v) => formacionSchema.safeParse({ nombre: 'X', modulos: [{ titulo: 'M', dias_desbloqueo: v }] });
    expect(dias('').data.modulos[0].dias_desbloqueo).toBeNull();
    expect(dias(0).data.modulos[0].dias_desbloqueo).toBeNull();
    expect(dias(null).data.modulos[0].dias_desbloqueo).toBeNull();
    expect(dias('15').data.modulos[0].dias_desbloqueo).toBe(15);
    expect(formacionSchema.safeParse({ nombre: 'X', modulos: [{ titulo: 'M' }] }).data.modulos[0]).not.toHaveProperty('dias_desbloqueo');
    for (const malo of [-1, 3651, 2.5, 'tres']) expect(dias(malo).success).toBe(false);
  });

  it('a Moodle solo van los días de los módulos que los tienen', () => {
    const d = datosDelCurso({ id: 1, project_id: 2, nombre: 'M' },
      [{ titulo: 'Uno', dias_desbloqueo: null }, { titulo: 'Dos', dias_desbloqueo: 7 }]);
    expect(d.secciones[0]).not.toHaveProperty('dias');
    expect(d.secciones[1].dias).toBe(7);
    expect(diasDeDesbloqueo({ dias_desbloqueo: 0 })).toBeNull();
    expect(textoDelAviso('sin_relativedate')).toMatch(/Fecha relativa/);
    expect(textoDelAviso('otro_aviso')).toBe('otro_aviso');
  });
});

describe('guardar y llevar a Moodle (CRM#1124)', () => {
  it('guarda los días de cada módulo y la ficha los devuelve', async () => {
    const antes = (await ficha()).body.data.modulos;
    const r = await guardar([
      { id: antes[0].id, titulo: 'Fundamentos', dias_desbloqueo: '' },
      { id: antes[1].id, titulo: 'Práctica', dias_desbloqueo: 7 },
      { id: antes[2].id, titulo: 'Final', dias_desbloqueo: 30 },
      { titulo: 'Nuevo', dias_desbloqueo: 45 },
    ]);
    expect(r.status).toBe(200);
    expect(r.body.data.modulos.map((m) => m.dias_desbloqueo)).toEqual([null, 7, 30, 45]);
    expect((await modulosGuardados()).map((m) => m.dias_desbloqueo)).toEqual([null, 7, 30, 45]);
  });

  it('sin la clave, los días se quedan como estaban', async () => {
    const antes = (await ficha()).body.data.modulos;
    const r = await guardar(antes.map((m) => ({ id: m.id, titulo: `${m.titulo}.` })));
    expect(r.status).toBe(200);
    expect((await modulosGuardados()).map((m) => m.dias_desbloqueo)).toEqual([null, 7, 30, 45]);
  });

  it('con la fase 2 apagada (producción) no se escribe nada', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRM_BASE_URL', 'https://x.test/crm');
    const antes = (await ficha()).body.data.modulos;
    const r = await guardar([...antes.map((m) => ({ id: m.id, titulo: m.titulo, dias_desbloqueo: 99 })), { titulo: 'Otro', dias_desbloqueo: 5 }]);
    expect(r.status).toBe(200);
    expect((await modulosGuardados()).map((m) => m.dias_desbloqueo)).toEqual([null, 7, 30, 45, null]);
    vi.unstubAllEnvs();
    // Se deja como estaba para lo siguiente.
    const ahora = (await ficha()).body.data.modulos;
    await guardar(ahora.slice(0, 4).map((m) => ({ id: m.id, titulo: m.titulo })));
  });

  it('la vista previa dice a los cuántos días se abre cada sección', async () => {
    const r = await request.get(`/api/products/${FORMACION}/formacion/moodle?projectId=${CAMPUS}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.data.desbloqueo).toEqual([null, 7, 30, 45]);
  });

  it('«Crear en Moodle» manda los días solo donde los hay, y los avisos llegan dichos', async () => {
    avisosDelPlugin = ['sin_relativedate'];
    const r = await request.post(`/api/products/${FORMACION}/formacion/moodle`).set(como(ADMIN)).send({ projectId: CAMPUS });
    expect(r.status).toBe(200);
    const c = llamadas.find((x) => x.get('wsfunction') === 'local_crm_curso_guardar');
    expect(c.has('secciones[0][dias]')).toBe(false);
    expect(c.get('secciones[1][dias]')).toBe('7');
    expect(c.get('secciones[2][dias]')).toBe('30');
    expect(c.get('secciones[3][dias]')).toBe('45');
    // «desde» no se manda: el plugin cuenta desde el inicio del curso (s = 1).
    expect([...c.keys()].some((k) => k.endsWith('[desde]'))).toBe(false);
    expect(r.body.data.curso.avisos).toEqual([expect.stringMatching(/Fecha relativa/)]);
  });
});
