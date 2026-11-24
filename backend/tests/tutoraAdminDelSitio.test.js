import {
  describe, it, expect, beforeAll, afterAll, vi,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';
import * as campus from '../src/modules/tutores/tutor.campus.js';
import { miCampus } from '../src/modules/tutores/tutor.micampus.js';
import { calificar } from '../src/modules/tutores/tutor.correccion.js';
import tutorRoutes from '../src/modules/tutores/tutor.routes.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';
import { logger } from '../src/shared/utils/logger.js';

/*
  La cuenta de administración del sitio, COMO EXCEPCIÓN (Diego, 24/11: una tutora que solo
  tiene esa cuenta en un campus y da clase con ella «es necesario que entre»).

    · Sin confirmar: el 409 ADMIN_DEL_SITIO de siempre, al buscar y al vincular, y ahora
      con la cuenta y el aviso para poder confirmarlo. No cambia nada.
    · Confirmado (`excepcionAdminDelSitio: true`, quien tiene `tutores.gestionar`): se
      enlaza, queda anotado cuándo y quién y en el registro. Solo si da clase con ella.
    · La comprobación de cada hora no lo deshace; «Vincular de nuevo» y vincular otra
      cuenta, sí. Y su correo no la enlaza sola a la cuenta de administración.
    · «Mi campus» la lee y dice «responde y corrige desde Moodle»; poner nota desde el CRM
      contesta eso mismo en vez de intentarlo (el plugin no califica como el administrador).

  Contra la base local, con un Moodle de mentira (sin red), plugin 1.10.2.
*/

const marca = `tads${Date.now()}`;
const ids = { users: [], projects: [], issuers: [] };
let hayBase = true;
let porQueNo = null;
const e = {};

// El 3 es la cuenta del token (crm_servicio). El 5 es el administrador del sitio y da clase
// en el curso 500; el 7, otro administrador que no da clase; el 50, una profesora normal.
const ADMIN_CORREO = `admin.${marca}@campus.test`;
const C = {
  delToken: 3,
  admins: [5, 7],
  usuarios: {
    3: { id: 3, email: 'crm@campus.test', fullname: 'crm_servicio', suspended: 0 },
    5: { id: 5, email: ADMIN_CORREO, fullname: 'Admin que da clase', suspended: 0 },
    7: { id: 7, email: 'otro.admin@campus.test', fullname: 'Otro admin', suspended: 0 },
    50: { id: 50, email: 'profe@campus.test', fullname: 'Profe', suspended: 0 },
  },
  cursos: { 5: [500], 50: [500], 7: [] },
  matriculados: {
    500: [
      { id: 5, fullname: 'Admin que da clase', roles: [{ shortname: 'editingteacher' }] },
      { id: 50, fullname: 'Profe', roles: [{ shortname: 'teacher' }] },
      { id: 60, fullname: 'Alumno', roles: [{ shortname: 'student' }] },
    ],
  },
};

const moodleFalso = vi.fn(async (_url, { body }) => {
  const p = new URLSearchParams(body);
  const json = (datos) => ({ ok: true, status: 200, json: async () => datos });
  if (p.get('wstoken') !== 'token-campus') return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' });
  switch (p.get('wsfunction')) {
    case 'core_webservice_get_site_info':
      return json({ sitename: 'Campus', userid: C.delToken, userissiteadmin: false });
    case 'core_user_get_users_by_field': {
      const u = Object.values(C.usuarios).find((x) => String(x[p.get('field')]) === p.get('values[0]'));
      return json(u ? [u] : []);
    }
    case 'core_enrol_get_users_courses':
      return json((C.cursos[p.get('userid')] || []).map((id) => ({ id, fullname: `Curso ${id}` })));
    case 'core_enrol_get_enrolled_users':
      return json(C.matriculados[p.get('courseid')] || []);
    case 'local_crm_cuenta': {
      const id = Number(p.get('userid'));
      const existe = Boolean(C.usuarios[id]);
      return json({ existe, siteadmin: existe && C.admins.includes(id) });
    }
    default:
      return json({ exception: 'moodle_exception', errorcode: 'accessexception', message: 'Access control exception' });
  }
});

async function crearUsuario(role, email = null) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active)
     VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${role} ${marca}`, email || `${role}.${ids.users.length}.${marca}@test.local`, role]);
  ids.users.push(rows[0].id);
  return Number(rows[0].id);
}

const fila = async (tutorId, projectId) => {
  const { rows } = await query(
    `SELECT estado, moodle_user_id, error, admin_sitio_excepcion_at, admin_sitio_excepcion_por
       FROM tutor_campus WHERE tutor_id = $1 AND project_id = $2`, [tutorId, projectId]);
  const r = rows[0];
  return r ? {
    ...r,
    moodle_user_id: r.moodle_user_id == null ? null : Number(r.moodle_user_id),
    admin_sitio_excepcion_por: r.admin_sitio_excepcion_por == null ? null : Number(r.admin_sitio_excepcion_por),
  } : undefined;
};

beforeAll(async () => {
  try {
    vi.stubGlobal('fetch', moodleFalso);
    const { rows: [emp] } = await query(
      `INSERT INTO invoice_issuers (razon_social, nif, pais, activo) VALUES ($1, $2, 'España', true) RETURNING id`,
      [`Empresa ${marca}`, `E${marca}`.slice(0, 20)]);
    ids.issuers.push(emp.id);
    const { rows: [pr] } = await query(
      `INSERT INTO projects (nombre, slug, webhook_api_key, active, sociedad_emisora_id)
       VALUES ($1, $2, $3, true, $4) RETURNING id`,
      [`Campus ${marca}`, `campus-${marca}`, `k-${marca}`, emp.id]);
    e.campus = Number(pr.id);
    ids.projects.push(e.campus);
    const enc = encrypt('token-campus');
    await query(
      `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
       VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
      [e.campus, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url: 'https://campus.prueba.local' })]);
    e.admin = await crearUsuario('admin');
    await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [e.admin, e.campus]);
    // Su correo del CRM no está en el campus: queda «pendiente» y se vincula a mano.
    e.tutora = await crearUsuario('tutor');
    await campus.asignarCampus(e.tutora, e.campus);
    await campus.comprobarTutor(e.tutora);
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const [sql, p] of [
    ['DELETE FROM tutor_campus WHERE tutor_id = ANY($1::int[])', [ids.users]],
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
const comoAdmin = () => {
  const token = jwt.sign({ userId: e.admin, role: 'admin' }, process.env.JWT_SECRET);
  return {
    get: (u) => supertest(app).get(u).set('Authorization', `Bearer ${token}`),
    post: (u, b = {}) => supertest(app).post(u).send(b).set('Authorization', `Bearer ${token}`),
  };
};
const vincular = (cuerpo) => comoAdmin().post(`/api/tutores/${e.tutora}/campus/${e.campus}/vincular`, cuerpo);

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('la cuenta de administración del sitio, como excepción confirmada', () => {
  it('sin confirmar: 409 ADMIN_DEL_SITIO al buscar y al vincular, con la cuenta y el aviso, y no cambia nada', async () => {
    if (!hayBase) return;
    const buscada = await comoAdmin().get(`/api/tutores/${e.tutora}/campus/${e.campus}/buscar-cuenta?q=${encodeURIComponent(ADMIN_CORREO)}`);
    expect(buscada.status, JSON.stringify(buscada.body)).toBe(409);
    expect(buscada.body).toMatchObject({
      success: false,
      code: 'ADMIN_DEL_SITIO',
      data: { cuenta: { id: 5, nombre: 'Admin que da clase', email: ADMIN_CORREO }, aviso: campus.AVISO_EXCEPCION_ADMIN },
    });
    for (const cuerpo of [{ moodleUserId: 5 }, { moodleUserId: 5, excepcionAdminDelSitio: 'true' }, { moodleUserId: 5, excepcionAdminDelSitio: 1 }]) {
      const r = await vincular(cuerpo);
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body).toMatchObject({ code: 'ADMIN_DEL_SITIO' });
      expect(r.body.error).toMatch(/administrador del sitio/);
    }
    expect(await fila(e.tutora, e.campus)).toMatchObject({ moodle_user_id: null, admin_sitio_excepcion_at: null });
  });

  it('la excepción solo vale para quien da clase con esa cuenta', async () => {
    if (!hayBase) return;
    const r = await vincular({ moodleUserId: 7, excepcionAdminDelSitio: true });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'NO_ES_PROFESORA' });
    // Ni la cuenta del token, con excepción o sin ella.
    expect((await vincular({ moodleUserId: 3, excepcionAdminDelSitio: true })).body).toMatchObject({ code: 'NO_ES_PROFESORA' });
    expect((await fila(e.tutora, e.campus)).moodle_user_id).toBeNull();
  });

  it('confirmada: se enlaza, queda anotado quién y cuándo y en el registro, y la ficha lo enseña', async () => {
    if (!hayBase) return;
    const aviso = vi.spyOn(logger, 'warn');
    try {
      const r = await vincular({ moodleUserId: 5, excepcionAdminDelSitio: true });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.admin_del_sitio).toBe(true);
      expect(r.body.data.campus.find((c) => c.project_id === e.campus)).toMatchObject({ estado: 'activa', admin_sitio_excepcion: true });
      expect(aviso).toHaveBeenCalledWith(
        expect.objectContaining({ tutorId: e.tutora, moodleUserId: 5, porQuien: e.admin }),
        expect.stringMatching(/administración del sitio.*excepción/));
    } finally {
      aviso.mockRestore();
    }
    const f = await fila(e.tutora, e.campus);
    expect(f).toMatchObject({ estado: 'activa', moodle_user_id: 5, error: null, admin_sitio_excepcion_por: e.admin });
    expect(f.admin_sitio_excepcion_at).toBeTruthy();
    expect(await campus.soloDesdeMoodle(e.tutora, e.campus)).toBe(true);
  });

  it('la comprobación de cada hora no la deshace', async () => {
    if (!hayBase) return;
    const antes = await fila(e.tutora, e.campus);
    await campus.comprobarTutor(e.tutora);
    await campus.comprobarTutor(e.tutora, { soloProyectos: [e.campus] });
    const despues = await fila(e.tutora, e.campus);
    expect(despues).toMatchObject({ estado: 'activa', moodle_user_id: 5, error: null, admin_sitio_excepcion_por: e.admin });
    expect(new Date(despues.admin_sitio_excepcion_at).getTime()).toBe(new Date(antes.admin_sitio_excepcion_at).getTime());
  });

  it('«Mi campus» la lee y dice que responde y corrige desde Moodle', async () => {
    if (!hayBase) return;
    const datos = await miCampus(e.tutora, { refrescar: true });
    const c = datos.campus.find((x) => x.projectId === e.campus);
    expect(c).toMatchObject({ soloDesdeMoodle: true });
    expect(c.cursos.map((k) => k.id)).toEqual([500]);
    expect(c.cursos[0].alumnos.map((a) => a.id)).toEqual([60]);
  });

  it('poner nota desde el CRM contesta «corrige desde Moodle» sin llamar al campus para calificar', async () => {
    if (!hayBase) return;
    moodleFalso.mockClear();
    await expect(calificar(e.tutora, e.campus, 500, 900, { alumnoId: 60, nota: 5, comentario: '' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'RESPONDE_DESDE_MOODLE', message: campus.SOLO_DESDE_MOODLE });
    const funciones = moodleFalso.mock.calls.map(([, { body }]) => new URLSearchParams(body).get('wsfunction'));
    expect(funciones).not.toContain('local_crm_calificar');
  });

  it('vincular otra cuenta (no administradora) quita la excepción', async () => {
    if (!hayBase) return;
    const r = await vincular({ moodleUserId: 50 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.admin_del_sitio).toBe(false);
    expect(await fila(e.tutora, e.campus)).toMatchObject({ moodle_user_id: 50, admin_sitio_excepcion_at: null, admin_sitio_excepcion_por: null });
    expect(await campus.soloDesdeMoodle(e.tutora, e.campus)).toBe(false);
  });

  it('su correo no la enlaza sola a la cuenta de administración: «Vincular de nuevo» la deja pendiente con el motivo', async () => {
    if (!hayBase) return;
    // Otra tutora cuyo correo del CRM ES el de la cuenta de administración del campus.
    const t = await crearUsuario('tutor', ADMIN_CORREO);
    await campus.asignarCampus(t, e.campus);
    await campus.comprobarTutor(t);
    expect(await fila(t, e.campus)).toMatchObject({ estado: 'pendiente', moodle_user_id: null, error: campus.ADMIN_SIN_EXCEPCION });
    // Confirmada, entra; y «Vincular de nuevo» olvida la cuenta Y la excepción.
    const tok = jwt.sign({ userId: e.admin, role: 'admin' }, process.env.JWT_SECRET);
    const ok = await supertest(app).post(`/api/tutores/${t}/campus/${e.campus}/vincular`)
      .send({ moodleUserId: 5, excepcionAdminDelSitio: true }).set('Authorization', `Bearer ${tok}`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await campus.soloDesdeMoodle(t, e.campus)).toBe(true);
    const deNuevo = await supertest(app).post(`/api/tutores/${t}/campus/${e.campus}/desvincular`).set('Authorization', `Bearer ${tok}`);
    expect(deNuevo.status, JSON.stringify(deNuevo.body)).toBe(200);
    expect(await fila(t, e.campus)).toMatchObject({
      estado: 'pendiente', moodle_user_id: null, error: campus.ADMIN_SIN_EXCEPCION, admin_sitio_excepcion_at: null,
    });
  });
});
