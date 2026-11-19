import {
  describe, it, expect, beforeAll, afterAll, vi,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';
import * as campus from '../src/modules/tutores/tutor.campus.js';
import tutorRoutes from '../src/modules/tutores/tutor.routes.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';
import { logger } from '../src/shared/utils/logger.js';

// Como en tutoresCampus187: el superadmin de estas pruebas (`userId: 0`) no está en
// la base; solo a ese id se le da el mapa de un superadmin, los demás, el de verdad.
vi.mock('../src/modules/permissions/permissions.service.js', async (original) => {
  const real = await original();
  const { resolverPermisos } = await import('../src/modules/permissions/resolver.js');
  const superadmin = { ...resolverPermisos({ role: 'superadmin', roles_extra: [], excepciones: {} }), persona: { id: 0, role: 'superadmin', roles_extra: [], active: true } };
  return { ...real, explicarPermisos: (id, ...resto) => (Number(id) === 0 ? Promise.resolve(superadmin) : real.explicarPermisos(id, ...resto)) };
});

/*
  Punto 2 de la revisión de la #689 (Diego, 06/11 y 10/11): vincular, buscar y
  desvincular la cuenta de Moodle de una tutora van POR EMPRESA.

    · Solo en campus de tu empresa (403 en uno de otra); super admin, en cualquiera.
    · Una tutora de dos empresas tiene un vínculo en cada campus, y cada uno lo pone y
      lo quita el admin de esa empresa, sin tocar el de la otra.
    · Solo cuentas que son profesoras de algún curso de ese campus; nunca la del
      administrador del sitio ni la del token del CRM.
    · Vincular no crea la fila de un campus que la tutora no tiene.

  Contra la base local, con un Moodle de mentira (sin red) por campus.
*/

const marca = `t689v${Date.now()}`;
const ids = { users: [], projects: [], issuers: [] };
let hayBase = true;
let porQueNo = null;
const e = {};

// Dos Moodle, uno por empresa. En A el token es del administrador del sitio (conexión
// antigua, de antes de `crm_servicio`) y además da clase en el curso 100; el 4 es otro
// administrador que no da clase; el 6, otro administrador que SÍ da clase; el 20, una
// alumna. A tiene un plugin anterior a la 1.10.2: sin `local_crm_cuenta`, no se puede
// saber si el 6 es administrador. En B el token es de `crm_servicio` y el plugin es la
// 1.10.2: dice que el 5, que da clase en el curso 500, es el administrador del sitio.
const CAMPUS = {
  'token-a': {
    delToken: 2,
    admins: [2, 4, 6],
    plugin: '1.10.1',
    usuarios: {
      2: { id: 2, email: 'admin@a.test', fullname: 'Admin del sitio A', suspended: 0 },
      4: { id: 4, email: 'otroadmin@a.test', fullname: 'Otro admin A', suspended: 0 },
      6: { id: 6, email: 'admin.profe@a.test', fullname: 'Admin que da clase A', suspended: 0 },
      10: { id: 10, email: 'ana@a.test', fullname: 'Ana en A', suspended: 0 },
      20: { id: 20, email: 'alumna@a.test', fullname: 'Alumna A', suspended: 0 },
    },
    cursos: { 2: [100], 6: [100], 10: [100], 20: [100] },
    matriculados: {
      100: [
        { id: 2, roles: [{ shortname: 'editingteacher' }] },
        { id: 6, roles: [{ shortname: 'editingteacher' }] },
        { id: 10, roles: [{ shortname: 'editingteacher' }] },
        { id: 20, roles: [{ shortname: 'student' }] },
      ],
    },
  },
  'token-b': {
    delToken: 3,
    admins: [5],
    plugin: '1.10.2',
    usuarios: {
      3: { id: 3, email: 'crm@b.test', fullname: 'crm_servicio', suspended: 0 },
      5: { id: 5, email: 'admin@b.test', fullname: 'Admin del sitio B', suspended: 0 },
      50: { id: 50, email: 'ana@b.test', fullname: 'Ana en B', suspended: 0 },
    },
    cursos: { 5: [500], 50: [500] },
    matriculados: {
      500: [
        { id: 5, roles: [{ shortname: 'editingteacher' }] },
        { id: 50, roles: [{ shortname: 'teacher' }] },
      ],
    },
  },
};

const moodleFalso = vi.fn(async (_url, { body }) => {
  const p = new URLSearchParams(body);
  const json = (datos) => ({ ok: true, status: 200, json: async () => datos });
  const c = CAMPUS[p.get('wstoken')];
  if (!c) return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' });
  switch (p.get('wsfunction')) {
    case 'core_webservice_get_site_info':
      return json({ sitename: 'Campus', userid: c.delToken, userissiteadmin: c.delToken === 2 });
    case 'core_user_get_users_by_field': {
      const campo = p.get('field');
      const v = p.get('values[0]');
      const u = Object.values(c.usuarios).find((x) => String(x[campo]) === v);
      return json(u ? [u] : []);
    }
    case 'core_enrol_get_users_courses':
      return json((c.cursos[p.get('userid')] || []).map((id) => ({ id, fullname: `Curso ${id}` })));
    case 'core_enrol_get_enrolled_users':
      return json(c.matriculados[p.get('courseid')] || []);
    case 'local_crm_cuenta': {
      // Un plugin anterior no tiene la función: lo que contesta Moodle 5.0 (probado el 11/11).
      if (c.plugin !== '1.10.2') {
        return json({ exception: 'dml_missing_record_exception', errorcode: 'invalidrecordunknown', message: 'Can\'t find data record in database.' });
      }
      const id = Number(p.get('userid'));
      const existe = Boolean(c.usuarios[id]);
      return json({ existe, siteadmin: existe && c.admins.includes(id) });
    }
    default:
      return json({ exception: 'moodle_exception', errorcode: 'accessexception', message: 'Access control exception' });
  }
});

async function crearUsuario(role) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active)
     VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${role} ${marca}`, `${role}.${ids.users.length}.${marca}@test.local`, role]);
  ids.users.push(rows[0].id);
  return Number(rows[0].id);
}

async function crearEmpresa(nombre) {
  const { rows } = await query(
    `INSERT INTO invoice_issuers (razon_social, nif, pais, activo) VALUES ($1, $2, 'España', true) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre}${marca}`.slice(0, 20)]);
  ids.issuers.push(rows[0].id);
  return Number(rows[0].id);
}

async function crearCampus(nombre, issuerId, token) {
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active, sociedad_emisora_id)
     VALUES ($1, $2, $3, true, $4) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre.toLowerCase()}-${marca}`, `k-${marca}-${ids.projects.length}`, issuerId]);
  const id = Number(rows[0].id);
  ids.projects.push(id);
  const enc = encrypt(token);
  await query(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
    [id, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url: 'https://campus.prueba.local' })]);
  return id;
}

const darCampus = (userId, projectId) => query(
  'INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true) ON CONFLICT DO NOTHING', [userId, projectId]);

const vinculada = async (tutorId, projectId) => {
  const { rows } = await query('SELECT moodle_user_id FROM tutor_campus WHERE tutor_id = $1 AND project_id = $2', [tutorId, projectId]);
  return rows[0] ? (rows[0].moodle_user_id == null ? null : Number(rows[0].moodle_user_id)) : undefined;
};

beforeAll(async () => {
  try {
    vi.stubGlobal('fetch', moodleFalso);
    e.empresaA = await crearEmpresa('CEDIA');
    e.empresaB = await crearEmpresa('ISEIE');
    e.campusA = await crearCampus('CampusA', e.empresaA, 'token-a');
    e.campusA2 = await crearCampus('CampusA2', e.empresaA, 'token-a');
    e.campusB = await crearCampus('CampusB', e.empresaB, 'token-b');
    e.adminA = await crearUsuario('admin');
    e.adminB = await crearUsuario('admin');
    await darCampus(e.adminA, e.campusA);
    await darCampus(e.adminA, e.campusA2);
    await darCampus(e.adminB, e.campusB);
    // La tutora da clase en las dos empresas. Su correo del CRM no está en ningún
    // Moodle: queda «pendiente» en los dos y hay que vincularla a mano.
    e.tutora = await crearUsuario('tutor');
    await campus.asignarCampus(e.tutora, e.campusA);
    await campus.asignarCampus(e.tutora, e.campusB);
    await campus.comprobarTutor(e.tutora);
    // Otra, solo de CampusA.
    e.tutora2 = await crearUsuario('tutor');
    await campus.asignarCampus(e.tutora2, e.campusA);
    await campus.comprobarTutor(e.tutora2);
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const [sql, p] of [
    ['DELETE FROM tutor_campus WHERE tutor_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM tutor_empresas WHERE tutor_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM project_integrations WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM activity_log WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
});

const app = express();
app.use(express.json());
app.use('/api/tutores', tutorRoutes);
app.use(errorHandler);
const pide = (user) => {
  const token = jwt.sign(user, process.env.JWT_SECRET);
  return {
    get: (u) => supertest(app).get(u).set('Authorization', `Bearer ${token}`),
    post: (u, b = {}) => supertest(app).post(u).send(b).set('Authorization', `Bearer ${token}`),
  };
};
const comoAdminA = () => pide({ userId: e.adminA, role: 'admin' });
const comoAdminB = () => pide({ userId: e.adminB, role: 'admin' });
const comoSuperadmin = () => pide({ userId: 0, role: 'superadmin' });

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('#689 punto 2 · vincular cuentas de Moodle va por empresa', () => {
  it('el admin de A, en un campus de B: 403 al vincular, buscar y desvincular, y no cambia nada', async () => {
    if (!hayBase) return;
    const a = comoAdminA();
    const vincular = await a.post(`/api/tutores/${e.tutora}/campus/${e.campusB}/vincular`, { moodleUserId: 50 });
    expect(vincular.status, JSON.stringify(vincular.body)).toBe(403);
    expect(vincular.body).toMatchObject({ success: false, code: 'FORBIDDEN' });
    const buscar = await a.get(`/api/tutores/${e.tutora}/campus/${e.campusB}/buscar-cuenta?q=ana@b.test`);
    expect(buscar.status).toBe(403);
    const desvincular = await a.post(`/api/tutores/${e.tutora}/campus/${e.campusB}/desvincular`);
    expect(desvincular.status).toBe(403);
    expect(await vinculada(e.tutora, e.campusB)).toBeNull();
  });

  it('una tutora de dos empresas: un vínculo en cada campus, cada uno puesto y quitado por el admin de su empresa', async () => {
    if (!hayBase) return;
    const enA = await comoAdminA().post(`/api/tutores/${e.tutora}/campus/${e.campusA}/vincular`, { moodleUserId: 10 });
    expect(enA.status, JSON.stringify(enA.body)).toBe(200);
    const enB = await comoAdminB().post(`/api/tutores/${e.tutora}/campus/${e.campusB}/vincular`, { moodleUserId: 50 });
    expect(enB.status, JSON.stringify(enB.body)).toBe(200);
    expect(await vinculada(e.tutora, e.campusA)).toBe(10);
    expect(await vinculada(e.tutora, e.campusB)).toBe(50);

    // El admin de A ve que tiene el campus de B, pero no lo puede tocar ni ve su error.
    const panel = enA.body.data.campus;
    expect(panel.find((c) => c.project_id === e.campusA)).toMatchObject({ gestionable: true, estado: 'activa' });
    const deB = (await comoAdminA().get(`/api/tutores/${e.tutora}/campus`)).body.data.campus
      .find((c) => c.project_id === e.campusB);
    expect(deB).toMatchObject({ gestionable: false, error: null });
    expect(deB).not.toHaveProperty('moodle_user_id');

    // La comprobación de cada hora respeta cada vínculo: busca cada cuenta por su id, en su campus.
    const r = await campus.comprobarTutor(e.tutora);
    expect(r.campus.map((c) => c.estado)).toEqual(['activa', 'activa']);
    expect(await vinculada(e.tutora, e.campusA)).toBe(10);
    expect(await vinculada(e.tutora, e.campusB)).toBe(50);

    // El admin de A desvincula la suya: la de B sigue.
    const fuera = await comoAdminA().post(`/api/tutores/${e.tutora}/campus/${e.campusA}/desvincular`);
    expect(fuera.status, JSON.stringify(fuera.body)).toBe(200);
    expect(await vinculada(e.tutora, e.campusA)).toBeNull();
    expect(await vinculada(e.tutora, e.campusB)).toBe(50);
  });

  it('el superadmin, en cualquier campus', async () => {
    if (!hayBase) return;
    const r = await comoSuperadmin().post(`/api/tutores/${e.tutora}/campus/${e.campusA}/vincular`, { moodleUserId: 10 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.campus.every((c) => c.gestionable)).toBe(true);
    expect(await vinculada(e.tutora, e.campusA)).toBe(10);
  });

  it('la cuenta del administrador del sitio no se vincula: ni la del token, aunque dé clase, ni otra que no da clase', async () => {
    if (!hayBase) return;
    const a = comoAdminA();
    const delToken = await a.post(`/api/tutores/${e.tutora2}/campus/${e.campusA}/vincular`, { moodleUserId: 2 });
    expect(delToken.status).toBe(409);
    expect(delToken.body).toMatchObject({ code: 'NO_ES_PROFESORA' });
    expect(delToken.body.error).toMatch(/cuenta con la que el CRM se conecta/);
    const otroAdmin = await a.post(`/api/tutores/${e.tutora2}/campus/${e.campusA}/vincular`, { moodleUserId: 4 });
    expect(otroAdmin.status).toBe(409);
    expect(otroAdmin.body.error).toMatch(/no es profesora de ningún curso/);
    const buscada = await a.get(`/api/tutores/${e.tutora2}/campus/${e.campusA}/buscar-cuenta?q=admin@a.test`);
    expect(buscada.status).toBe(409);
    // La del token de B (crm_servicio), tampoco.
    const servicio = await comoAdminB().post(`/api/tutores/${e.tutora}/campus/${e.campusB}/vincular`, { moodleUserId: 3 });
    expect(servicio.status).toBe(409);
    expect(await vinculada(e.tutora2, e.campusA)).toBeNull();
    expect(await vinculada(e.tutora, e.campusB)).toBe(50);
  });

  it('una cuenta que no es profesora de ningún curso del campus no se vincula ni se ofrece al buscar', async () => {
    if (!hayBase) return;
    const a = comoAdminA();
    const alumna = await a.post(`/api/tutores/${e.tutora2}/campus/${e.campusA}/vincular`, { moodleUserId: 20 });
    expect(alumna.status).toBe(409);
    expect(alumna.body.error).toMatch(/no es profesora de ningún curso de este campus/);
    expect((await a.get(`/api/tutores/${e.tutora2}/campus/${e.campusA}/buscar-cuenta?q=alumna@a.test`)).status).toBe(409);
    // La de una profesora sí, con lo justo para reconocerla; y un correo que no existe, null.
    const ana = await a.get(`/api/tutores/${e.tutora2}/campus/${e.campusA}/buscar-cuenta?q=ana@a.test`);
    expect(ana.status).toBe(200);
    expect(ana.body.data).toEqual({ id: 10, nombre: 'Ana en A', email: 'ana@a.test', suspendido: false });
    const nadie = await a.get(`/api/tutores/${e.tutora2}/campus/${e.campusA}/buscar-cuenta?q=nadie@a.test`);
    expect(nadie.body).toMatchObject({ success: true, data: null });
    // Una profesora de B no lo es de A: en A no existe esa cuenta.
    expect((await a.post(`/api/tutores/${e.tutora2}/campus/${e.campusA}/vincular`, { moodleUserId: 50 })).status).toBe(404);
    expect(await vinculada(e.tutora2, e.campusA)).toBeNull();
  });

  it('vincular en un campus que la tutora no tiene: error claro y no se crea la fila', async () => {
    if (!hayBase) return;
    // CampusA2 es de la empresa del admin, pero a la tutora 2 no se le ha dado.
    const a = comoAdminA();
    const r = await a.post(`/api/tutores/${e.tutora2}/campus/${e.campusA2}/vincular`, { moodleUserId: 10 });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'CAMPUS_NO_ASIGNADO' });
    expect(r.body.error).toMatch(/asígnale primero el campus/);
    expect((await a.get(`/api/tutores/${e.tutora2}/campus/${e.campusA2}/buscar-cuenta?q=ana@a.test`)).status).toBe(409);
    expect((await a.post(`/api/tutores/${e.tutora2}/campus/${e.campusA2}/desvincular`)).status).toBe(409);
    // Tampoco llamando al servicio directamente, sin pasar por la ruta.
    await expect(campus.vincularAMano(e.tutora2, e.campusA2, 10)).rejects.toMatchObject({ statusCode: 409, code: 'CAMPUS_NO_ASIGNADO' });
    expect(await vinculada(e.tutora2, e.campusA2)).toBeUndefined();
  });

  it('con el campus dado pero sin comprobar todavía, tampoco crea la fila', async () => {
    if (!hayBase) return;
    const t = await crearUsuario('tutor');
    await campus.asignarCampus(t, e.campusA);
    await expect(campus.vincularAMano(t, e.campusA, 10)).rejects.toMatchObject({ statusCode: 409, code: 'SIN_COMPROBAR' });
    expect(await vinculada(t, e.campusA)).toBeUndefined();
  });
});

describe('#689 · el administrador del sitio no se vincula aunque dé clase (plugin 1.10.2)', () => {
  it('con el plugin 1.10.2: 409 ADMIN_DEL_SITIO al vincular y al buscar, y no cambia nada', async () => {
    if (!hayBase) return;
    const antes = await vinculada(e.tutora, e.campusB);
    const b = comoAdminB();
    const r = await b.post(`/api/tutores/${e.tutora}/campus/${e.campusB}/vincular`, { moodleUserId: 5 });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body).toMatchObject({ success: false, code: 'ADMIN_DEL_SITIO' });
    expect(r.body.error).toMatch(/administrador del sitio/);
    const buscada = await b.get(`/api/tutores/${e.tutora}/campus/${e.campusB}/buscar-cuenta?q=admin@b.test`);
    expect(buscada.status).toBe(409);
    expect(buscada.body).toMatchObject({ code: 'ADMIN_DEL_SITIO' });
    expect(await vinculada(e.tutora, e.campusB)).toBe(antes);
    // Una profesora que no es administradora, sí.
    const ana = await b.post(`/api/tutores/${e.tutora}/campus/${e.campusB}/vincular`, { moodleUserId: 50 });
    expect(ana.status, JSON.stringify(ana.body)).toBe(200);
  });

  it('con un plugin anterior, sin la función: sigue como antes y lo deja dicho en el log', async () => {
    if (!hayBase) return;
    const t = await crearUsuario('tutor');
    await campus.asignarCampus(t, e.campusA);
    await campus.comprobarTutor(t);
    const aviso = vi.spyOn(logger, 'warn');
    try {
      // El 6 es administrador del sitio, pero el plugin de A no lo puede decir: da clase, se vincula.
      const r = await comoAdminA().post(`/api/tutores/${t}/campus/${e.campusA}/vincular`, { moodleUserId: 6 });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(await vinculada(t, e.campusA)).toBe(6);
      expect(aviso).toHaveBeenCalledWith(expect.objectContaining({ moodleUserId: 6 }), expect.stringMatching(/local_crm_cuenta/));
    } finally {
      aviso.mockRestore();
    }
  });
});
