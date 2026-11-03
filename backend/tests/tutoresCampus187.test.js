import {
  describe, it, expect, beforeAll, afterAll, vi,
} from 'vitest';
import { vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';
import { verifyToken } from '../src/shared/middleware/auth.js';
import {
  estadoDeLaMatricula, usuarioPorCorreo, infoDelCampus, urlDelCampus, MoodleError,
} from '../src/shared/services/moodle.client.js';
import { testMoodle } from '../src/modules/integrations/integrations.controller.js';
import * as campus from '../src/modules/tutores/tutor.campus.js';
import tutorRoutes from '../src/modules/tutores/tutor.routes.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';

// Los permisos se leen de la base (#423). Estas pruebas piden como un superadmin
// que no está en la base (`userId: 0`): para no crear uno en la base compartida,
// solo a ese id se le da el mapa de un superadmin; los demás, el de verdad.
vi.mock('../src/modules/permissions/permissions.service.js', async (original) => {
  const real = await original();
  const { resolverPermisos } = await import('../src/modules/permissions/resolver.js');
  const superadmin = { ...resolverPermisos({ role: 'superadmin', roles_extra: [], excepciones: {} }), persona: { id: 0, role: 'superadmin', roles_extra: [], active: true } };
  return { ...real, explicarPermisos: (id, ...resto) => (Number(id) === 0 ? Promise.resolve(superadmin) : real.explicarPermisos(id, ...resto)) };
});

/**
 * Consultas de alumnos, fase 1 (#187), contra la base de verdad.
 *
 * Las tres pruebas que pide la issue:
 *   · una empresa cubre un proyecto creado después;
 *   · un tutor sin matrícula no recibe consultas;
 *   · un tutor no ve ventas.
 *
 * Y lo que las sostiene: el cliente de Moodle (sin red: un `fetch` de mentira
 * que contesta como Moodle), la prueba de Integraciones y la comprobación de
 * la matrícula que cambia de activa a baja.
 */

const marca = `t187${Date.now()}`;
const ids = { users: [], projects: [], issuers: [] };
let hayBase = true;
let porQueNo = null;
let empresa = null;
let campusA = null;
let tutor = null;

/** Un Moodle de mentira: contesta a las dos funciones como lo haría uno de verdad. */
function moodleFalso(usuariosPorCorreo = {}, { funciones = ['core_webservice_get_site_info', 'core_user_get_users_by_field'], token = 'bueno' } = {}) {
  return vi.fn(async (_url, { body }) => {
    const p = new URLSearchParams(body);
    const json = (datos) => ({ ok: true, status: 200, json: async () => datos });
    if (p.get('wstoken') !== token) {
      return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' });
    }
    if (p.get('wsfunction') === 'core_webservice_get_site_info') {
      return json({ sitename: 'Campus de prueba', release: '4.5.12 (Build: 20260101)', functions: funciones.map((name) => ({ name })) });
    }
    if (p.get('wsfunction') === 'core_user_get_users_by_field') {
      const u = usuariosPorCorreo[p.get('values[0]')];
      return json(u ? [u] : []);
    }
    return json({ exception: 'moodle_exception', errorcode: 'accessexception', message: 'Access control exception' });
  });
}

async function crearUsuario(role, extra = null) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, roles_extra, active)
     VALUES ($1, $2, 'x', $3, COALESCE($4::user_role[], '{}'), true) RETURNING id`,
    [`${role} ${marca}`, `${role}.${ids.users.length}.${marca}@test.local`, role, extra]
  );
  ids.users.push(rows[0].id);
  return Number(rows[0].id);
}

async function crearCampus(nombre, issuerId) {
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active, sociedad_emisora_id)
     VALUES ($1, $2, $3, true, $4) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre.toLowerCase()}-${marca}-${ids.projects.length}`, `k-${marca}-${ids.projects.length}`, issuerId]
  );
  ids.projects.push(rows[0].id);
  return Number(rows[0].id);
}

async function conectarMoodle(projectId, token = 'bueno') {
  const enc = encrypt(token);
  await query(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, $5)
     ON CONFLICT (project_id, provider) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value,
       iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag, active = true`,
    [projectId, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url: 'https://campus.prueba.local' })]
  );
}

beforeAll(async () => {
  try {
    const t = await query("SELECT to_regclass('public.tutor_empresas') AS a, to_regclass('public.tutor_campus') AS b");
    if (!t.rows[0].a || !t.rows[0].b) throw new Error('Falta la migración 208 (tutor_empresas / tutor_campus).');
    const e = await query(
      `INSERT INTO invoice_issuers (razon_social, nif, pais, activo) VALUES ($1, $2, 'España', true) RETURNING id`,
      [`Empresa ${marca}`, `NIF${marca}`.slice(0, 20)]
    );
    empresa = Number(e.rows[0].id);
    ids.issuers.push(empresa);
    campusA = await crearCampus('CampusA', empresa);
    tutor = await crearUsuario('tutor');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
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

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

// ─── El cliente de Moodle ────────────────────────────────────────────────────
describe('cliente de Moodle (#187)', () => {
  it('la dirección del campus, limpia aunque la peguen entera', () => {
    expect(urlDelCampus('iseih.com/campus/')).toBe('https://iseih.com/campus');
    expect(urlDelCampus('https://iseih.com/campus/webservice/rest/server.php?wstoken=x')).toBe('https://iseih.com/campus');
  });

  it('el estado de la matrícula: activa, pendiente o baja', () => {
    expect(estadoDeLaMatricula({ id: 1, suspendido: false })).toBe('activa');
    expect(estadoDeLaMatricula({ id: 1, suspendido: true })).toBe('baja');
    expect(estadoDeLaMatricula(null)).toBe('pendiente');
    expect(estadoDeLaMatricula(null, 'pendiente')).toBe('pendiente');
    // Lo era y ya no: le han dado de baja en el campus.
    expect(estadoDeLaMatricula(null, 'activa')).toBe('baja');
  });

  it('busca por correo y dice si está suspendido', async () => {
    const fetchImpl = moodleFalso({ 'ana@campus.es': { id: 7, suspended: 1, fullname: 'Ana' } });
    const u = await usuarioPorCorreo({ url: 'campus.es', token: 'bueno' }, 'Ana@Campus.es', { fetchImpl });
    expect(u).toEqual({ id: 7, suspendido: true, nombre: 'Ana' });
    expect(await usuarioPorCorreo({ url: 'campus.es', token: 'bueno' }, 'nadie@campus.es', { fetchImpl })).toBeNull();
  });

  it('un token malo dice qué pasa, no «error»', async () => {
    const fetchImpl = moodleFalso({}, { token: 'otro' });
    await expect(infoDelCampus({ url: 'campus.es', token: 'bueno' }, { fetchImpl }))
      .rejects.toThrow(/token del campus no vale/);
    await expect(infoDelCampus({ url: 'campus.es', token: 'bueno' }, { fetchImpl }))
      .rejects.toBeInstanceOf(MoodleError);
  });

  it('Integraciones · «Probar conexión»: OK, y avisa si al token le falta la función de usuarios', async () => {
    const ok = await testMoodle('bueno', 'campus.es', { fetchImpl: moodleFalso() });
    expect(ok.ok).toBe(true);
    expect(ok.message).toMatch(/Campus de prueba · Moodle 4\.5\.12/);
    const falta = await testMoodle('bueno', 'campus.es', { fetchImpl: moodleFalso({}, { funciones: ['core_webservice_get_site_info'] }) });
    expect(falta.ok).toBe(false);
    expect(falta.message).toMatch(/core_user_get_users_by_field/);
  });
});

// ─── Las tres pruebas de la issue ────────────────────────────────────────────
describe('#187 · una empresa cubre un proyecto creado después', () => {
  it('sin copiar filas: el campus nuevo de la empresa le llega solo', async () => {
    if (!hayBase) return;
    await campus.asignarEmpresa(tutor, empresa, null);
    expect((await campus.campusDelTutor(tutor)).map((c) => c.project_id)).toEqual([campusA]);

    const campusB = await crearCampus('CampusB', empresa);
    const ahora = await campus.campusDelTutor(tutor);
    expect(ahora.map((c) => c.project_id).sort()).toEqual([campusA, campusB].sort());
    expect(ahora.every((c) => c.via === 'empresa')).toBe(true);
    // No se ha copiado nada a user_projects: se resuelve al consultar.
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM user_projects WHERE user_id = $1', [tutor]);
    expect(rows[0].n).toBe(0);

    // Y al quitar la empresa, dejan de llegarle.
    await campus.quitarEmpresa(tutor, empresa);
    expect(await campus.campusDelTutor(tutor)).toEqual([]);
  });
});

describe('#187 · un tutor sin matrícula no recibe consultas', () => {
  it('pendiente o de baja no; activa sí; y «No disponible» tampoco', async () => {
    if (!hayBase) return;
    const t = await crearUsuario('tutor');
    const p = await crearCampus('CampusC', null);
    await campus.asignarCampus(t, p);
    await conectarMoodle(p);
    const reciben = async () => (await campus.tutoresQueRecibenConsultas(p)).map((x) => x.id);

    // Su correo no es usuario del campus: pendiente de matrícula.
    let r = await campus.comprobarTutor(t, { fetchImpl: moodleFalso({}) });
    expect(r.campus[0].estado).toBe('pendiente');
    expect(await reciben()).not.toContain(t);

    // Le dan de alta en el campus: activa, y ya recibe.
    const { rows } = await query('SELECT email FROM users WHERE id = $1', [t]);
    r = await campus.comprobarTutor(t, { fetchImpl: moodleFalso({ [rows[0].email]: { id: 99, suspended: 0 } }) });
    expect(r.campus[0].estado).toBe('activa');
    expect(await reciben()).toContain(t);

    // De vacaciones: no recibe, aunque esté matriculado.
    await campus.ponerDisponible(t, false, 'Vacaciones');
    expect(await reciben()).not.toContain(t);
    await campus.ponerDisponible(t, true);
    expect(await reciben()).toContain(t);

    // Le dan de baja en el campus: se marca y deja de recibir.
    r = await campus.comprobarTutor(t, { fetchImpl: moodleFalso({}) });
    expect(r.campus[0].estado).toBe('baja');
    expect(await reciben()).not.toContain(t);
  });

  it('un campus que no contesta no da de baja a nadie', async () => {
    if (!hayBase) return;
    const t = await crearUsuario('tutor');
    const p = await crearCampus('CampusD', null);
    await campus.asignarCampus(t, p);
    await conectarMoodle(p);
    const { rows } = await query('SELECT email FROM users WHERE id = $1', [t]);
    await campus.comprobarTutor(t, { fetchImpl: moodleFalso({ [rows[0].email]: { id: 5, suspended: 0 } }) });
    const caido = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const r = await campus.comprobarTutor(t, { fetchImpl: caido });
    expect(r.campus[0].estado).toBe('activa');
    expect(r.campus[0].error).toMatch(/No se ha podido llegar al campus/);
  });

  it('al abrir la ficha se vuelve a comprobar solo si la última comprobación es vieja', async () => {
    if (!hayBase) return;
    const t = await crearUsuario('tutor');
    const p = await crearCampus('CampusF', null);
    await campus.asignarCampus(t, p);
    await conectarMoodle(p);
    const { rows } = await query('SELECT email FROM users WHERE id = $1', [t]);
    const matriculado = moodleFalso({ [rows[0].email]: { id: 7, suspended: 0 } });
    await campus.comprobarTutor(t, { fetchImpl: matriculado });

    // Recién comprobado: no se pregunta otra vez al campus.
    const deBaja = moodleFalso({ [rows[0].email]: { id: 7, suspended: 1 } });
    expect((await campus.comprobarSiHaceFalta(t, { fetchImpl: deBaja })).resultados).toEqual([]);
    expect(deBaja).not.toHaveBeenCalled();

    // Hace rato: sí, y se ve la baja sin pulsar «Comprobar en los campus».
    await query("UPDATE tutor_campus SET comprobado_at = NOW() - INTERVAL '1 hour' WHERE tutor_id = $1", [t]);
    const r = await campus.comprobarSiHaceFalta(t, { fetchImpl: deBaja });
    expect(r.resultados).toEqual([expect.objectContaining({ project_id: p, estado: 'baja' })]);
    expect(r.campus[0].estado).toBe('baja');
  });

  it('sin el campus conectado no se inventa un estado', async () => {
    if (!hayBase) return;
    const t = await crearUsuario('tutor');
    const p = await crearCampus('CampusE', null);
    await campus.asignarCampus(t, p);
    const r = await campus.comprobarTutor(t, { fetchImpl: moodleFalso({}) });
    expect(r.resultados[0]).toMatchObject({ sin_conectar: true, estado: null });
    expect(r.campus[0]).toMatchObject({ campus_conectado: false, estado: null });
  });
});

describe('#187 · un tutor no ve ventas (en el servidor)', () => {
  const pasa = (user, url) => {
    let error = null;
    const req = { headers: { authorization: `Bearer ${jwt.sign(user, process.env.JWT_SECRET)}` }, originalUrl: url };
    verifyToken(req, {}, (e) => { error = e || null; });
    return error ? error.statusCode : 'ok';
  };

  it('ventas, prospectos, facturas y finanzas: 403, aunque la ruta solo pida token', () => {
    const t = { userId: 1, role: 'tutor', roles_extra: [] };
    for (const url of ['/api/conversions?projectId=1', '/api/leads', '/api/sales/resumen', '/api/invoices', '/api/accounting/income', '/api/products']) {
      expect(pasa(t, url), url).toBe(403);
    }
  });

  it('lo suyo sí: su perfil, sus cursos y comisiones, sus avisos', () => {
    const t = { userId: 1, role: 'tutor', roles_extra: [] };
    for (const url of ['/api/auth/me', '/api/tutores/colaboraciones', '/api/tutores/comisiones/resumen', '/api/notifications', '/api/users/mis-avisos', '/api/tutores/1/campus']) {
      expect(pasa(t, url), url).toBe('ok');
    }
  });

  it('a quien además es gestora no se le cierra nada; el colaborador, igual que antes', () => {
    expect(pasa({ userId: 1, role: 'gestor', roles_extra: ['tutor'] }, '/api/conversions')).toBe('ok');
    expect(pasa({ userId: 1, role: 'tutor', roles_extra: ['gestor'] }, '/api/leads')).toBe('ok');
    expect(pasa({ userId: 1, role: 'colaborador', roles_extra: [] }, '/api/tasks')).toBe('ok');
    expect(pasa({ userId: 1, role: 'colaborador', roles_extra: [] }, '/api/leads')).toBe(403);
    expect(pasa({ userId: 1, role: 'colaborador', roles_extra: [] }, '/api/tutores/colaboraciones')).toBe(403);
  });
});

// ─── La ficha: lo que ve y quién puede tocarlo ───────────────────────────────
describe('#187 · la ficha del tutor (API)', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/tutores', tutorRoutes);
  app.use(errorHandler);
  const pide = (user) => {
    const token = jwt.sign(user, process.env.JWT_SECRET);
    return {
      get: (u) => supertest(app).get(u).set('Authorization', `Bearer ${token}`),
      post: (u, b) => supertest(app).post(u).send(b).set('Authorization', `Bearer ${token}`),
      del: (u) => supertest(app).delete(u).set('Authorization', `Bearer ${token}`),
      patch: (u, b) => supertest(app).patch(u).send(b).set('Authorization', `Bearer ${token}`),
    };
  };

  it('el superadmin da una empresa entera y la ficha la enseña con sus campus', async () => {
    if (!hayBase) return;
    const sa = pide({ userId: 0, role: 'superadmin' });
    const r = await sa.post(`/api/tutores/${tutor}/empresas`, { issuerId: empresa });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.empresas.map((e) => e.issuer_id)).toEqual([empresa]);
    expect(r.body.data.campus.map((c) => c.project_id)).toContain(campusA);
    const v = await sa.get(`/api/tutores/${tutor}/campus`);
    expect(v.body.data.disponible).toBe(true);
    await sa.del(`/api/tutores/${tutor}/empresas/${empresa}`);
  });

  it('un admin no da una empresa entera si no lleva todos sus campus', async () => {
    if (!hayBase) return;
    const admin = await crearUsuario('admin');
    await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [admin, campusA]);
    // El tutor tiene que ser «de sus campus» para que pueda tocarlo.
    await campus.asignarCampus(tutor, campusA);
    const r = await pide({ userId: admin, role: 'admin' }).post(`/api/tutores/${tutor}/empresas`, { issuerId: empresa });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/todos sus campus/);
  });

  it('«No disponible» con su motivo, y validación con un aviso que se entiende', async () => {
    if (!hayBase) return;
    const sa = pide({ userId: 0, role: 'superadmin' });
    const r = await sa.patch(`/api/tutores/${tutor}/disponible`, { disponible: false, motivo: 'Baja médica' });
    expect(r.body.data).toMatchObject({ disponible: false, motivo_no_disponible: 'Baja médica' });
    const mal = await sa.post(`/api/tutores/${tutor}/empresas`, { issuerId: 'x' });
    expect(mal.status).toBe(400);
    expect(mal.body.error).toMatch(/Elige una empresa/);
    await sa.patch(`/api/tutores/${tutor}/disponible`, { disponible: true });
  });

  it('el tutor ve su propio panel, pero no toca nada', async () => {
    if (!hayBase) return;
    const yo = pide({ userId: tutor, role: 'tutor' });
    expect((await yo.get(`/api/tutores/${tutor}/campus`)).status).toBe(200);
    expect((await yo.post(`/api/tutores/${tutor}/empresas`, { issuerId: empresa })).status).toBe(403);
  });
});
