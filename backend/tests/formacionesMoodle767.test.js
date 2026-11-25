import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM#1113 / CRM-ISEIE#767 · Formaciones desde el CRM, fase 2: «Crear / Actualizar en
 * Moodle» desde la ficha de la formación, con la base de verdad y Moodle simulado.
 *
 * Lo que se defiende:
 *   · se llama a `local_crm_curso_guardar` con el nombre, el idnumber del CRM, las fechas
 *     y una sección por módulo (título y temario en HTML), en orden;
 *   · el curso que devuelve queda unido al producto (`moodle_cursos_producto`) y la
 *     segunda vez se actualiza ese mismo (`cursoid`);
 *   · apagado en producción sin FORMACIONES_MOODLE_EN_PRODUCCION; sin módulos, 409; sin
 *     Moodle conectado, 409; la gestora no puede (`moodle.crear_cursos`).
 *   · al crear, la categoría de su tipo (la que se llama como él, o la guardada en
 *     Integraciones › Moodle) y un nombre corto libre (-2 si ya existe, también si Moodle
 *     lo dice al crear); la ficha lo enseña antes de pulsar, y después el enlace al curso.
 *
 *   npx vitest run tests/formacionesMoodle767.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/products/index.js');
const { default: integraciones } = await import('../src/modules/integrations/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const { datosDelCurso, marcaDeDia, moodleDisponible, vaciarCacheDelCampus } = await import('../src/modules/products/formacion.moodle.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(integraciones.prefix, integraciones.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `FM1113${Date.now().toString(36)}`;
const PLUGIN = `https://${MARCA.toLowerCase()}.plugin.test`;
const TOKEN = `tok${MARCA}0123456789abcdef`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const json = (c) => new Response(JSON.stringify(c), { status: 200, headers: { 'content-type': 'application/json' } });

let CAMPUS; let SIN_MOODLE; let ADMIN; let GESTORA; let FORMACION; let VACIA; let DE_SIN_MOODLE; let CON_SKU;
let llamadas = [];
// Los nombres cortos que Moodle rechaza al crear aunque no estén en su lista (uno creado entretanto).
let repetidosAlCrear = new Set();
// El nombre corto que el CRM propone para FORMACION («… Diplomado en Voz», 2027): ya está cogido en el campus.
const CORTO_DE_FORMACION = `DIP-${MARCA.toUpperCase()}-VOZ-2027`;

beforeAll(async () => {
  const proy = async (c) => {
    const [p] = await q('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  CAMPUS = await proy('campus');
  SIN_MOODLE = await proy('sin');
  const enc = encrypt(TOKEN);
  await q(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
    [CAMPUS, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url: `${PLUGIN}/` })]);
  const persona = async (n, role, campus) => {
    const [u] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
      [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  ADMIN = await persona('ADMIN', 'admin', [CAMPUS, SIN_MOODLE]);
  GESTORA = await persona('GESTORA', 'gestor', [CAMPUS]);
  const prod = async (campus, nombre, extra = {}) => {
    const [p] = await q('INSERT INTO products (project_id, nombre, fecha_inicio, fecha_fin) VALUES ($1, $2, $3, $4) RETURNING id',
      [campus, `${MARCA} ${nombre}`, extra.inicio ?? null, extra.fin ?? null]);
    return p.id;
  };
  FORMACION = await prod(CAMPUS, 'Diplomado en Voz', { inicio: '2027-02-01', fin: '2027-07-31' });
  await q(`INSERT INTO product_modules (product_id, titulo, descripcion, orden) VALUES
           ($1, 'Anatomía', 'Tema 1\nTema 2', 0), ($1, 'Evaluación', NULL, 1)`, [FORMACION]);
  VACIA = await prod(CAMPUS, 'Sin módulos');
  DE_SIN_MOODLE = await prod(SIN_MOODLE, 'De un campus sin Moodle');
  CON_SKU = await prod(CAMPUS, 'Curso de Canto', { inicio: '2027-03-01' });
  await q(`UPDATE products SET sku = $2, tipo_formacion = 'curso' WHERE id = $1`, [CON_SKU, `SKU-${MARCA}`]);
  await q(`INSERT INTO product_modules (product_id, titulo, orden) VALUES ($1, 'Respiración', 0)`, [CON_SKU]);
  await q(`INSERT INTO product_modules (product_id, titulo, orden) VALUES ($1, 'Uno', 0)`, [DE_SIN_MOODLE]);
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
    // El campus, como hoy con el plugin 1.11/1.12: lee los cursos, pero no las categorías.
    if (funcion === 'core_course_get_courses_by_field') {
      return json({
        courses: [
          { id: 1, format: 'site', shortname: 'portada', categoryid: 0 },
          { id: 40, shortname: CORTO_DE_FORMACION, fullname: 'Diplomado viejo', categoryid: 7, categoryname: 'Diplomados' },
          { id: 41, shortname: 'otro', fullname: 'Curso de algo', categoryid: 3, categoryname: 'Cursos' },
          { id: 42, shortname: 'fm-x', fullname: 'Diplomado de algo', categoryid: 7, categoryname: 'Diplomados' },
        ],
      });
    }
    if (funcion === 'core_course_get_categories') return json({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'no' });
    if (funcion !== 'local_crm_curso_guardar') return json({ exception: 'x', errorcode: 'invalidrecord', message: 'no' });
    if (!Number(cuerpo.get('cursoid')) && repetidosAlCrear.has(cuerpo.get('nombrecorto'))) {
      return json({ exception: 'moodle_exception', errorcode: 'cursonombrecortorepetido', message: 'Ya hay un curso con ese nombre corto.' });
    }
    const cursoid = Number(cuerpo.get('cursoid')) || (cuerpo.get('idnumber') === `crm-${CAMPUS}-${FORMACION}` ? 501 : 502);
    return json({
      cursoid, nombre: cuerpo.get('nombre'), nombrecorto: cuerpo.get('nombrecorto'), creado: !Number(cuerpo.get('cursoid')),
      visible: false, secciones: [{ numero: 1, id: 9001 }, { numero: 2, id: 9002 }], sobran: 0,
    });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); repetidosAlCrear = new Set(); });

describe('lo que se manda al plugin (sin base)', () => {
  it('idnumber del CRM, fechas a mediodía UTC y el temario en HTML', () => {
    const d = datosDelCurso({ id: 7, project_id: 3, nombre: 'Máster', fecha_inicio: '2027-02-01', fecha_fin: null },
      [{ titulo: 'Uno', descripcion: 'a\nb' }, { titulo: 'Dos', descripcion: null }]);
    expect(d).toMatchObject({ idnumber: 'crm-3-7', nombre: 'Máster', inicio: marcaDeDia('2027-02-01'), fin: 0 });
    expect(new Date(d.inicio * 1000).toISOString()).toBe('2027-02-01T12:00:00.000Z');
    expect(d.secciones).toEqual([{ nombre: 'Uno', resumen: '<p>a<br>b</p>' }, { nombre: 'Dos', resumen: '' }]);
  });

  it('en producción, apagado hasta que se apruebe', () => {
    expect(moodleDisponible({ NODE_ENV: 'production', CRM_BASE_URL: 'https://x/crm' })).toBe(false);
    expect(moodleDisponible({ NODE_ENV: 'production', CRM_BASE_URL: 'https://x/crm', FORMACIONES_MOODLE_EN_PRODUCCION: '1' })).toBe(false);
    expect(moodleDisponible({
      NODE_ENV: 'production', CRM_BASE_URL: 'https://x/crm', FORMACIONES_MOODLE_EN_PRODUCCION: '1', PLUGIN_MOODLE_EN_PRODUCCION: '1',
    })).toBe(true);
  });
});

describe('Crear / Actualizar en Moodle (CRM#1113, fase 2)', () => {
  it('crea el curso con una sección por módulo y lo une al producto', async () => {
    const r = await request.post(`/api/products/${FORMACION}/formacion/moodle`).set(como(ADMIN)).send({ projectId: CAMPUS });
    expect(r.status).toBe(200);
    expect(r.body.data.curso).toMatchObject({ cursoId: 501, creado: true });
    const c = llamadas.at(-1);
    expect(c.get('cursoid')).toBe('0');
    // Diplomado → la categoría «Diplomados» (por su nombre); su nombre corto ya existe → -2.
    expect(c.get('categoria')).toBe('7');
    expect(c.get('nombrecorto')).toBe(`${CORTO_DE_FORMACION}-2`);
    // Solo se ha leído antes de escribir.
    expect(llamadas.slice(0, -1).every((x) => /_get_/.test(x.get('wsfunction')))).toBe(true);
    expect(r.body.data.curso.url).toBe(`${PLUGIN}/course/view.php?id=501`);
    expect(c.get('idnumber')).toBe(`crm-${CAMPUS}-${FORMACION}`);
    expect(c.get('secciones[0][nombre]')).toBe('Anatomía');
    expect(c.get('secciones[0][resumen]')).toBe('<p>Tema 1<br>Tema 2</p>');
    expect(c.get('secciones[1][nombre]')).toBe('Evaluación');
    expect(c.get('wstoken')).toBe(TOKEN);
    const unidos = await q('SELECT curso_moodle_id FROM moodle_cursos_producto WHERE product_id = $1 AND project_id = $2', [FORMACION, CAMPUS]);
    expect(unidos.map((u) => Number(u.curso_moodle_id))).toEqual([501]);
    expect(r.body.data.formacion.cursos_moodle).toEqual([
      expect.objectContaining({ curso_moodle_id: 501, url: `${PLUGIN}/course/view.php?id=501` }),
    ]);
  });

  it('la segunda vez actualiza el curso unido', async () => {
    const r = await request.post(`/api/products/${FORMACION}/formacion/moodle`).set(como(ADMIN)).send({ projectId: CAMPUS });
    expect(r.status).toBe(200);
    expect(llamadas.at(-1).get('cursoid')).toBe('501');
    expect(r.body.data.curso.creado).toBe(false);
    // Al actualizar no se lee el campus: la categoría y el nombre corto no se tocan.
    expect(llamadas).toHaveLength(1);
  });

  it('la ficha dice si se puede y si el campus está conectado', async () => {
    const admin = await request.get(`/api/products/${FORMACION}/formacion?projectId=${CAMPUS}`).set(como(ADMIN));
    expect(admin.body.data.moodle).toEqual({ disponible: true, conectado: true });
    const gestora = await request.get(`/api/products/${FORMACION}/formacion?projectId=${CAMPUS}`).set(como(GESTORA));
    expect(gestora.body.data.moodle.disponible).toBe(false);
  });

  it('sin módulos o sin Moodle conectado: 409, sin llamar a Moodle', async () => {
    const vacia = await request.post(`/api/products/${VACIA}/formacion/moodle`).set(como(ADMIN)).send({ projectId: CAMPUS });
    expect(vacia.status).toBe(409);
    expect(vacia.body.code).toBe('SIN_MODULOS');
    const sin = await request.post(`/api/products/${DE_SIN_MOODLE}/formacion/moodle`).set(como(ADMIN)).send({ projectId: SIN_MOODLE });
    expect(sin.status).toBe(409);
    expect(sin.body.code).toBe('SIN_MOODLE');
    expect(llamadas).toHaveLength(0);
  });

  it('la gestora no puede; apagado en producción', async () => {
    const g = await request.post(`/api/products/${FORMACION}/formacion/moodle`).set(como(GESTORA)).send({ projectId: CAMPUS });
    expect(g.status).toBe(403);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRM_BASE_URL', 'https://x.test/crm');
    vi.stubEnv('PLUGIN_MOODLE_EN_PRODUCCION', '1');
    const r = await request.post(`/api/products/${FORMACION}/formacion/moodle`).set(como(ADMIN)).send({ projectId: CAMPUS });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('APAGADO');
    expect(llamadas).toHaveLength(0);
  });
});

describe('antes de pulsar: qué se va a crear (CRM#1113, fase 2)', () => {
  it('la vista previa: categoría, nombre corto libre, oculto y una sección por módulo', async () => {
    const r = await request.get(`/api/products/${CON_SKU}/formacion/moodle?projectId=${CAMPUS}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      accion: 'crear',
      tipo: 'curso',
      categoria: { id: 3, nombre: 'Cursos', origen: 'propuesta' },
      fuente_categorias: 'cursos',
      nombre_corto: { valor: `SKU-${MARCA}`, origen: 'sku', ajustado: false },
      visible: false,
      secciones: ['Respiración'],
    });
    expect(r.body.data.categorias.map((c) => c.id)).toEqual([3, 7]);
    expect(llamadas.every((x) => /_get_/.test(x.get('wsfunction')))).toBe(true);
  });

  it('con el curso ya unido, «actualizar» con su enlace', async () => {
    const r = await request.get(`/api/products/${FORMACION}/formacion/moodle?projectId=${CAMPUS}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ accion: 'actualizar', categoria: null, nombre_corto: null });
    expect(r.body.data.cursos_unidos).toEqual([expect.objectContaining({ id: 501, url: `${PLUGIN}/course/view.php?id=501` })]);
  });

  it('la gestora no la ve', async () => {
    const r = await request.get(`/api/products/${CON_SKU}/formacion/moodle?projectId=${CAMPUS}`).set(como(GESTORA));
    expect(r.status).toBe(403);
  });
});

describe('Integraciones › Moodle: la categoría de cada tipo (CRM#1113, fase 2)', () => {
  it('lee las categorías del campus y propone una por tipo', async () => {
    const r = await request.get(`/api/integrations/moodle/categorias?projectId=${CAMPUS}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.data.fuente).toBe('cursos');
    expect(r.body.data.propuesta).toEqual({ curso: { id: 3, nombre: 'Cursos' }, diplomado: { id: 7, nombre: 'Diplomados' }, master: null });
    expect(r.body.data.efectivas.master).toEqual({ id: 0, nombre: null, origen: 'por_defecto' });
  });

  it('guarda el mapeo en config_public y «Crear en Moodle» lo usa; el nombre corto se puede cambiar', async () => {
    const g = await request.put('/api/integrations/moodle/categorias').set(como(ADMIN))
      .send({ projectId: CAMPUS, categorias: { curso: 7, diplomado: null, master: 0 } });
    expect(g.status).toBe(200);
    expect(g.body.data.guardadas).toEqual({ curso: 7, master: 0 });
    const [fila] = await q(`SELECT config_public FROM project_integrations WHERE project_id = $1 AND provider = 'moodle'`, [CAMPUS]);
    expect(fila.config_public.categorias_formacion).toEqual({ curso: 7, master: 0 });
    // La dirección y lo demás siguen ahí.
    expect(fila.config_public.url).toBe(`${PLUGIN}/`);

    const vista = await request.get(`/api/products/${CON_SKU}/formacion/moodle?projectId=${CAMPUS}`).set(como(ADMIN));
    expect(vista.body.data.categoria).toEqual({ id: 7, nombre: 'Diplomados', origen: 'campus' });

    // Moodle dice que el nombre corto pedido ya existe: se crea con -2.
    repetidosAlCrear = new Set(['CANTO-27']);
    const r = await request.post(`/api/products/${CON_SKU}/formacion/moodle`).set(como(ADMIN))
      .send({ projectId: CAMPUS, nombre_corto: ' CANTO-27 ' });
    expect(r.status).toBe(200);
    const creaciones = llamadas.filter((x) => x.get('wsfunction') === 'local_crm_curso_guardar');
    expect(creaciones.map((x) => x.get('nombrecorto'))).toEqual(['CANTO-27', 'CANTO-27-2']);
    expect(creaciones.at(-1).get('categoria')).toBe('7');
  });

  it('valida lo que se guarda y solo en sus campus', async () => {
    const malo = await request.put('/api/integrations/moodle/categorias').set(como(ADMIN))
      .send({ projectId: CAMPUS, categorias: { curso: -3 } });
    expect(malo.status).toBe(400);
    const sin = await request.put('/api/integrations/moodle/categorias').set(como(ADMIN))
      .send({ projectId: SIN_MOODLE, categorias: { curso: 1 } });
    expect(sin.status).toBe(409);
    const gestora = await request.put('/api/integrations/moodle/categorias').set(como(GESTORA))
      .send({ projectId: CAMPUS, categorias: { curso: 1 } });
    expect(gestora.status).toBe(403);
  });
});
