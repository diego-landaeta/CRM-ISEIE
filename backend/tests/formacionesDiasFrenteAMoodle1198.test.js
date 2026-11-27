import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM-ISEIE#832 (gemela de CRM#1198) · Formaciones: comprobar contra Moodle los días de «se desbloquea» de cada módulo y
 * avisar si alguien los cambió o los quitó a mano allí. Con la base de verdad y Moodle simulado
 * (plugin local_crm 1.16.0: `local_crm_curso_desbloqueo`).
 *
 * Lo que se defiende:
 *   · con un único curso unido, la vista previa lee Moodle y dice qué módulos no coinciden:
 *     los días coinciden (nada), son distintos, o faltan en Moodle; y los que cuentan desde la
 *     matrícula tampoco son los del CRM;
 *   · un plugin anterior, un campus sin «Fecha relativa», un curso que no es del CRM o un
 *     campus que no contesta: no se enseña nada y no falla;
 *   · solo lee: abrir la vista previa no escribe en Moodle ni cambia lo apuntado;
 *   · al llevarlo a Moodle se pone lo del CRM, también quitar lo que se puso allí a mano;
 *   · sin curso unido, o con varios, ni se pregunta.
 *
 *   npx vitest run tests/formacionesDiasFrenteAMoodle1198.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/products/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const { diferenciasDeDesbloqueo, diasEnMoodleAhora, vaciarCacheDelCampus } = await import('../src/modules/products/formacion.moodle.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `FD1198${Date.now().toString(36)}`;
const PLUGIN = `https://${MARCA.toLowerCase()}.plugin.test`;
const TOKEN = `tok${MARCA}0123456789abcdef`;
const CURSO = 701;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const json = (c, status = 200) => new Response(JSON.stringify(c), { status, headers: { 'content-type': 'application/json' } });

let CAMPUS; let ADMIN; let FORMACION;
let llamadas = [];
/**
 * Lo que contesta el Moodle simulado a `local_crm_curso_desbloqueo`:
 *   · null → un plugin anterior a la 1.16.0 (la función no existe);
 *   · 'cae' → el campus contesta con un error HTTP;
 *   · un objeto → { delcrm, relativedate, avisos, secciones: [[dias, desde], …] } (de la 1 en adelante).
 */
let moodle = null;

const relativa = (secciones, extra = {}) => ({
  cursoid: CURSO, delcrm: true, relativedate: true, avisos: [],
  secciones: secciones.map(([dias, desde], i) => ({ numero: i + 1, id: 100 + i, dias, desde })),
  ...extra,
});
const vista = () => request.get(`/api/products/${FORMACION}/formacion/moodle?projectId=${CAMPUS}`).set(como(ADMIN));
const llevar = () => request.post(`/api/products/${FORMACION}/formacion/moodle`).set(como(ADMIN)).send({ projectId: CAMPUS });
const llamadasA = (f) => llamadas.filter((x) => x.get('wsfunction') === f);
const apuntado = () => q('SELECT dias_secciones FROM moodle_cursos_producto WHERE product_id = $1', [FORMACION]).then((r) => r.map((x) => x.dias_secciones));
const ponerModulos = async (dias) => {
  const mods = await q('SELECT id FROM product_modules WHERE product_id = $1 ORDER BY orden, id', [FORMACION]);
  for (let i = 0; i < mods.length; i += 1) await q('UPDATE product_modules SET dias_desbloqueo = $2 WHERE id = $1', [mods[i].id, dias[i]]);
};
const unir = async (cursos, diasSecciones) => {
  await q('DELETE FROM moodle_cursos_producto WHERE product_id = $1', [FORMACION]);
  for (const c of cursos) {
    await q(`INSERT INTO moodle_cursos_producto (product_id, project_id, curso_moodle_id, curso_nombre, dias_secciones)
             VALUES ($1, $2, $3, 'Máster en Voz', $4::jsonb)`, [FORMACION, CAMPUS, c, JSON.stringify(diasSecciones)]);
  }
};

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
  await q(`INSERT INTO product_modules (product_id, titulo, orden, dias_desbloqueo)
           VALUES ($1, 'Fundamentos', 0, NULL), ($1, 'Práctica', 1, 7), ($1, 'Final', 2, 30)`, [FORMACION]);
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

beforeEach(async () => {
  llamadas = [];
  moodle = null;
  vaciarCacheDelCampus();
  await ponerModulos([null, 7, 30]);
  await unir([CURSO], [null, 7, 30]);
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    if (String(url) !== `${PLUGIN}/webservice/rest/server.php`) return original(url, init);
    const cuerpo = new URLSearchParams(String(init.body));
    llamadas.push(cuerpo);
    const funcion = cuerpo.get('wsfunction');
    if (funcion === 'core_course_get_courses_by_field') return json({ courses: [] });
    if (funcion === 'core_course_get_categories') return json([{ id: 9, name: 'Másteres', parent: 0, depth: 1, coursecount: 0 }]);
    if (funcion === 'local_crm_curso_desbloqueo') {
      if (moodle === 'cae') return json({}, 500);
      if (moodle) return json(moodle);
    }
    if (funcion !== 'local_crm_curso_guardar') return json({ exception: 'x', errorcode: 'invalidrecord', message: 'no' });
    return json({
      cursoid: Number(cuerpo.get('cursoid')) || CURSO, nombre: cuerpo.get('nombre'), nombrecorto: cuerpo.get('nombrecorto'),
      creado: !Number(cuerpo.get('cursoid')), visible: false, delcrm: true,
      secciones: [{ numero: 1, id: 1 }, { numero: 2, id: 2 }, { numero: 3, id: 3 }], sobran: 0, avisos: [],
    });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('comparar (sin base)', () => {
  const mods = [{ titulo: 'Uno', dias_desbloqueo: null }, { titulo: 'Dos', dias_desbloqueo: 7 }, { titulo: 'Tres', dias_desbloqueo: 30 }];
  const leidas = (pares) => new Map(pares.map(([dias, desde], i) => [i + 1, { dias, desde }]));

  it('los días coinciden: nada', () => {
    expect(diferenciasDeDesbloqueo(mods, leidas([[0, 0], [7, 1], [30, 1]]))).toEqual([]);
  });

  it('son distintos, faltan en Moodle o sobran allí', () => {
    expect(diferenciasDeDesbloqueo(mods, leidas([[5, 1], [15, 1], [0, 0]]))).toEqual([
      { posicion: 0, modulo: 'Uno', en_moodle: 5, desde_moodle: 1, aqui: null },
      { posicion: 1, modulo: 'Dos', en_moodle: 15, desde_moodle: 1, aqui: 7 },
      { posicion: 2, modulo: 'Tres', en_moodle: null, desde_moodle: null, aqui: 30 },
    ]);
  });

  it('los mismos días desde la matrícula no son los del CRM', () => {
    expect(diferenciasDeDesbloqueo(mods, leidas([[0, 0], [7, 3], [30, 1]]))).toEqual([
      { posicion: 1, modulo: 'Dos', en_moodle: 7, desde_moodle: 3, aqui: 7 },
    ]);
  });

  it('sin lectura, o con secciones que aún no existen: no se compara', () => {
    expect(diferenciasDeDesbloqueo(mods, null)).toEqual([]);
    expect(diferenciasDeDesbloqueo(mods, leidas([[0, 0]]))).toEqual([]);
  });

  it('lo que hay en Moodle: lo leído y, donde no se pudo, lo apuntado', () => {
    expect(diasEnMoodleAhora([null, 7, 30], null, 3)).toEqual([null, 7, 30]);
    expect(diasEnMoodleAhora([null, 7, 30], leidas([[5, 1], [0, 0]]), 3)).toEqual([5, null, 30]);
    // Las secciones de más que haya apuntadas se conservan.
    expect(diasEnMoodleAhora([null, 7, 30, 9], leidas([[0, 0]]), 2)).toEqual([null, 7, 30, 9]);
  });
});

describe('la vista previa con un curso unido (CRM#1198)', () => {
  it('los días coinciden: no avisa', async () => {
    moodle = relativa([[0, 0], [7, 1], [30, 1]]);
    const r = await vista();
    expect(r.status).toBe(200);
    expect(r.body.data.accion).toBe('actualizar');
    expect(r.body.data.desbloqueo_distinto).toEqual([]);
    expect(llamadasA('local_crm_curso_desbloqueo').map((x) => x.get('cursoid'))).toEqual([String(CURSO)]);
  });

  it('son distintos (15 en Moodle, 7 aquí) y faltan en Moodle', async () => {
    moodle = relativa([[0, 0], [15, 1], [0, 0]]);
    const r = await vista();
    expect(r.status).toBe(200);
    expect(r.body.data.desbloqueo_distinto).toEqual([
      { posicion: 1, modulo: 'Práctica', en_moodle: 15, desde_moodle: 1, aqui: 7 },
      { posicion: 2, modulo: 'Final', en_moodle: null, desde_moodle: null, aqui: 30 },
    ]);
    // Al llevarlo a Moodle se ponen los del CRM: no se quita nada.
    expect(r.body.data.quitar_desbloqueo).toEqual([null, null, null]);
  });

  it('puestos a mano en un módulo que aquí no tiene: avisa y se quitarán al llevarlo', async () => {
    moodle = relativa([[12, 1], [7, 1], [30, 1]]);
    const r = await vista();
    expect(r.body.data.desbloqueo_distinto).toEqual([{ posicion: 0, modulo: 'Fundamentos', en_moodle: 12, desde_moodle: 1, aqui: null }]);
    expect(r.body.data.quitar_desbloqueo).toEqual([12, null, null]);
  });

  it('plugin anterior a la 1.16.0: no avisa y no falla', async () => {
    moodle = null;
    const r = await vista();
    expect(r.status).toBe(200);
    expect(r.body.data.desbloqueo_distinto).toEqual([]);
    expect(r.body.data.quitar_desbloqueo).toEqual([null, null, null]);
  });

  it('sin «Fecha relativa», curso que no es del CRM o el campus no contesta: no avisa y no falla', async () => {
    for (const caso of [
      relativa([], { relativedate: false, avisos: ['sin_relativedate'] }),
      relativa([], { delcrm: false, avisos: ['curso_no_del_crm'] }),
      'cae',
    ]) {
      moodle = caso;
      const r = await vista();
      expect(r.status).toBe(200);
      expect(r.body.data.desbloqueo_distinto).toEqual([]);
    }
  });

  it('solo lee: ni escribe en Moodle ni cambia lo apuntado', async () => {
    moodle = relativa([[0, 0], [15, 1], [0, 0]]);
    await vista();
    expect(llamadasA('local_crm_curso_guardar')).toHaveLength(0);
    expect(await apuntado()).toEqual([[null, 7, 30]]);
  });

  it('sin curso unido, o con varios: ni se pregunta a Moodle', async () => {
    moodle = relativa([[0, 0], [15, 1], [0, 0]]);
    await unir([], []);
    expect((await vista()).body.data.accion).toBe('crear');
    await unir([CURSO, 702], [null, 7, 30]);
    const r = await vista();
    expect(r.body.data.accion).toBe('varios');
    expect(r.body.data).not.toHaveProperty('desbloqueo_distinto');
    expect(llamadasA('local_crm_curso_desbloqueo')).toHaveLength(0);
  });
});

describe('al llevarlo a Moodle se pone lo del CRM (CRM#1198)', () => {
  const enviado = () => llamadasA('local_crm_curso_guardar')[0];

  it('días cambiados a mano: se mandan los del CRM; puestos a mano donde aquí no hay: -1', async () => {
    moodle = relativa([[12, 1], [15, 1], [0, 0]]);
    const r = await llevar();
    expect(r.status).toBe(200);
    const c = enviado();
    expect(c.get('secciones[0][dias]')).toBe('-1');
    expect(c.get('secciones[1][dias]')).toBe('7');
    expect(c.get('secciones[2][dias]')).toBe('30');
    expect(await apuntado()).toEqual([[null, 7, 30]]);
  });

  it('con un plugin anterior, lo de siempre: lo apuntado decide qué se quita', async () => {
    moodle = null;
    await unir([CURSO], [5, 7, 30]);
    const r = await llevar();
    expect(r.status).toBe(200);
    expect(enviado().get('secciones[0][dias]')).toBe('-1');
    llamadas = [];
    // Ya quitado: la siguiente vez no se manda nada en esa sección.
    await llevar();
    expect(enviado().has('secciones[0][dias]')).toBe(false);
  });
});
