import {
  describe, it, expect, vi, afterEach, beforeEach,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';

/**
 * «Mi campus» y corregir desde el CRM (#408, gemela de CRM#681 y su prueba
 * tutoresMiCampusCorregir681.test.js; llega con la gemela de CRM#1084).
 *
 *  1. Poner la nota ESCRIBE en el Moodle del alumno (`local_crm_calificar`): solo en
 *     pruebas, como el resto del plugin (revisión de Diego de la #689, punto 1). Con
 *     NODE_ENV=production y sin PLUGIN_MOODLE_EN_PRODUCCION=1, la ruta de calificar no
 *     se monta (404) y `calificarComoTutora` se niega sin llamar al campus ('APAGADO').
 *     Leer (Mi campus, la tarea, el curso, un archivo) sí se monta: no cambia nada.
 *  2. En cada campus, Mi campus y corregir actúan con la cuenta de Moodle que la tutora
 *     tiene vinculada EN ESE campus (revisión del 06/11, punto 2): la misma persona es
 *     701 en un campus y 802 en otro, y en cada uno el otro número es de un alumno.
 *
 * Sin base: `query` es de mentira; los dos campus, también (un `fetch` que contesta
 * según la dirección del campus y apunta qué se le ha pedido).
 */

/** La tutora 1: en el campus 4 es la 701; en el 5, la 802. */
const CUENTA = { 4: 701, 5: 802 };
const query = vi.fn(async (sql, params = []) => {
  if (/SELECT moodle_user_id FROM tutor_campus/.test(sql)) {
    const id = CUENTA[Number(params[1])];
    return id ? { rows: [{ moodle_user_id: id }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  // Los campus de la tutora para «Mi campus» (campusDeLaTutora).
  if (/FROM tutor_campus tc JOIN projects p/.test(sql) && /tc\.estado = 'activa' AND tc\.moodle_user_id IS NOT NULL/.test(sql)) {
    return { rows: [{ project_id: 4, moodle_user_id: 701, campus: 'Campus A' }, { project_id: 5, moodle_user_id: 802, campus: 'Campus B' }], rowCount: 2 };
  }
  return { rows: [], rowCount: 0 };
});
vi.mock('../src/shared/config/db.js', () => ({
  query,
  getClient: vi.fn(async () => ({ query, release: () => {} })),
}));
vi.mock('../src/modules/tutores/tutor.campus.js', async (importOriginal) => ({
  ...(await importOriginal()),
  conexionDelCampus: vi.fn(async (projectId) => ({ url: `https://campus${projectId}.test`, token: `token-${projectId}` })),
}));
vi.mock('../src/shared/middleware/auth.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyToken: (req, _res, next) => { req.user = { userId: 1, role: 'tutor' }; next(); },
}));
vi.mock('../src/shared/middleware/permissions.js', async (importOriginal) => ({
  ...(await importOriginal()),
  puede: () => (_req, _res, next) => next(),
}));

/** En cada campus: la profesora es su cuenta de ESE campus; el número de la otra es un alumno. */
const MATRICULADOS = {
  4: [
    { id: 701, fullname: 'Tutora', roles: [{ shortname: 'editingteacher' }] },
    { id: 802, fullname: 'Alumno que se llama 802 aquí', roles: [{ shortname: 'student' }] },
    { id: 900, fullname: 'Ana', roles: [{ shortname: 'student' }] },
  ],
  5: [
    { id: 802, fullname: 'Tutora', roles: [{ shortname: 'editingteacher' }] },
    { id: 701, fullname: 'Alumno que se llama 701 aquí', roles: [{ shortname: 'student' }] },
    { id: 950, fullname: 'Bea', roles: [{ shortname: 'student' }] },
  ],
};

/** Lo que el CRM ha pedido a cada campus: { campus, f, params }. */
const alCampus = [];
vi.stubGlobal('fetch', vi.fn(async (url, { body } = {}) => {
  const campus = Number(/campus(\d+)\.test/.exec(String(url))?.[1]);
  const params = Object.fromEntries(new URLSearchParams(body));
  const f = params.wsfunction;
  alCampus.push({ campus, f, params });
  const respuestas = {
    core_enrol_get_users_courses: [{ id: 30, fullname: `Curso del campus ${campus}` }],
    core_enrol_get_enrolled_users: MATRICULADOS[campus] || [],
    mod_assign_get_assignments: { courses: [{ id: 30, assignments: [{ id: 77, cmid: 7, name: 'Tarea 1', grade: 10 }] }] },
    mod_assign_get_submissions: { assignments: [{ assignmentid: 77, submissions: [] }] },
    mod_assign_get_grades: { assignments: [] },
    local_crm_calificar: { ok: true, nota: Number(params.nota), maxima: 10, comentario: false },
  };
  return { ok: true, status: 200, json: async () => respuestas[f] ?? {} };
}));

const PRODUCCION = { NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com' };
const TESTEO = { NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com/staging' };
const APROBADO = { ...PRODUCCION, PLUGIN_MOODLE_EN_PRODUCCION: '1' };

function entorno(env) {
  vi.stubEnv('PLUGIN_MOODLE_EN_PRODUCCION', '');
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

beforeEach(() => { alCampus.length = 0; query.mockClear(); });
afterEach(() => { vi.unstubAllEnvs(); });

/** El router de tutores cargado con el entorno que se le pase; el controlador, de mentira. */
async function apiTutores(env) {
  vi.resetModules();
  entorno(env);
  vi.doMock('../src/modules/tutores/tutor.controller.js', async (importOriginal) => {
    const real = await importOriginal();
    const ok = (req, res) => res.json({ success: true, ruta: req.path });
    return Object.fromEntries(Object.entries(real).map(([k, v]) => [k, typeof v === 'function' ? ok : v]));
  });
  const { default: mod } = await import('../src/modules/tutores/index.js');
  vi.doUnmock('../src/modules/tutores/tutor.controller.js');
  const app = express();
  app.use(express.json());
  app.use(mod.prefix, mod.router);
  return supertest(app);
}

const CALIFICAR = '/api/tutores/mi-campus/tareas/4/30/77/calificar';
const DE_LEER = [
  '/api/tutores/mi-campus',
  '/api/tutores/mi-campus/tareas/4/30/77',
  '/api/tutores/mi-campus/tareas/4/30/77/archivo',
  '/api/tutores/mi-campus/cursos/4/30',
];

describe('#681 · calificar desde el CRM, detrás de PLUGIN_MOODLE_EN_PRODUCCION', () => {
  it('en producción sin la variable, la ruta de calificar no está montada (404); las de leer, sí', async () => {
    const api = await apiTutores(PRODUCCION);
    expect((await api.post(CALIFICAR).send({ alumnoId: 900, nota: 8 })).status).toBe(404);
    for (const ruta of DE_LEER) expect((await api.get(ruta)).status, ruta).toBe(200);
  });

  it('con la variable, en /staging y en local, calificar responde', async () => {
    for (const env of [APROBADO, TESTEO, { NODE_ENV: 'development' }]) {
      const api = await apiTutores(env);
      expect((await api.post(CALIFICAR).send({ alumnoId: 900, nota: 8 })).status, env.CRM_BASE_URL || env.NODE_ENV).toBe(200);
    }
  });

  it('apagado, calificarComoTutora se niega sin llamar al campus (APAGADO)', async () => {
    vi.resetModules();
    entorno(PRODUCCION);
    const { calificarComoTutora } = await import('../src/shared/services/moodle.client.js');
    await expect(calificarComoTutora({ url: 'https://campus4.test', token: 't' }, { desde: 701, tarea: 77, alumno: 900, nota: 8 }))
      .rejects.toMatchObject({ codigo: 'APAGADO' });
    expect(alCampus).toEqual([]);
  });

  it('apagado, aunque alguien llame al servicio a mano, la nota no llega al campus', async () => {
    vi.resetModules();
    entorno(PRODUCCION);
    const correccion = await import('../src/modules/tutores/tutor.correccion.js');
    await expect(correccion.calificar(1, 4, 30, 77, { alumnoId: 900, nota: 8, comentario: '' }))
      .rejects.toMatchObject({ statusCode: 502 });
    expect(alCampus.map((x) => x.f)).not.toContain('local_crm_calificar');
  });
});

describe('#681 · en cada campus, con la cuenta de Moodle de ESE campus (revisión 06/11, punto 2)', () => {
  beforeEach(() => { vi.resetModules(); entorno(APROBADO); });

  it('calificar en el campus 4 va como 701; en el 5, como 802', async () => {
    const correccion = await import('../src/modules/tutores/tutor.correccion.js');
    await correccion.calificar(1, 4, 30, 77, { alumnoId: 900, nota: 8, comentario: '' });
    await correccion.calificar(1, 5, 30, 77, { alumnoId: 950, nota: 9, comentario: '' });
    const notas = alCampus.filter((x) => x.f === 'local_crm_calificar').map((x) => ({ campus: x.campus, desde: x.params.desde, alumno: x.params.alumno }));
    expect(notas).toEqual([{ campus: 4, desde: '701', alumno: '900' }, { campus: 5, desde: '802', alumno: '950' }]);
  });

  it('el número de la tutora en el otro campus es un alumno aquí: no se le puede poner nota a ella como si lo fuera', async () => {
    const correccion = await import('../src/modules/tutores/tutor.correccion.js');
    // En el campus 5, 701 es un alumno; en el 4, la tutora (y no es alumna suya).
    await expect(correccion.calificar(1, 4, 30, 77, { alumnoId: 701, nota: 8, comentario: '' })).rejects.toMatchObject({ statusCode: 404 });
    await correccion.calificar(1, 5, 30, 77, { alumnoId: 701, nota: 8, comentario: '' });
    expect(alCampus.filter((x) => x.f === 'local_crm_calificar').map((x) => [x.campus, x.params.desde])).toEqual([[5, '802']]);
  });

  it('ver la tarea: en cada campus, sus alumnos de ese campus', async () => {
    const correccion = await import('../src/modules/tutores/tutor.correccion.js');
    const a = await correccion.verTarea(1, 4, 30, 77);
    const b = await correccion.verTarea(1, 5, 30, 77);
    expect(a.entregas.map((e) => e.alumnoId).sort()).toEqual([802, 900]);
    expect(b.entregas.map((e) => e.alumnoId).sort()).toEqual([701, 950]);
  });

  it('Mi campus pregunta los cursos de cada campus con la cuenta de ese campus', async () => {
    const { miCampus } = await import('../src/modules/tutores/tutor.micampus.js');
    const datos = await miCampus(1, { refrescar: true });
    const cursos = alCampus.filter((x) => x.f === 'core_enrol_get_users_courses').map((x) => [x.campus, x.params.userid]);
    expect(cursos.sort()).toEqual([[4, '701'], [5, '802']]);
    const porCampus = Object.fromEntries(datos.campus.map((c) => [c.projectId, c.cursos[0]?.alumnos.map((x) => x.id).sort()]));
    expect(porCampus).toEqual({ 4: [802, 900], 5: [701, 950] });
  });
});
