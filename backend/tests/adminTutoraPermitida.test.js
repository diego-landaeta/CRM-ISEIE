import {
  describe, it, expect, beforeAll, afterAll, vi,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';
import * as campus from '../src/modules/tutores/tutor.campus.js';
import { miCampus } from '../src/modules/tutores/tutor.micampus.js';
import { calificar } from '../src/modules/tutores/tutor.correccion.js';

/*
  La administradora del sitio que da clase, cuando el campus la PERMITE (CRM-ISEIE#773, gemela
  de CRM#1118; plugin local_crm 1.11.7, Campus-Moodle#21).

  Con la excepción de la 339, «Mi campus» decía «responde y corrige desde Moodle». Con la
  1.11.7, el campus puede tenerla en «Administradoras que dan clase» y `local_crm_cuenta`
  lo dice con `permitida`. Entonces:

    · al enlazarla, y en cada comprobación, se guarda en `tutor_campus.admin_sitio_permitida`;
    · permitida: ni «Mi campus» ni corregir dicen «desde Moodle», y la nota va por el plugin;
    · el campus la quita de la lista: en la siguiente comprobación vuelve a «desde Moodle»;
    · el campus no contesta, o tiene un plugin anterior: se queda como estaba;
    · «Vincular de nuevo» lo olvida con la excepción.

  Contra la base local, con un Moodle de mentira (sin red).
*/

const marca = `atp${Date.now()}`;
const ids = { users: [], projects: [], issuers: [] };
let hayBase = true;
let porQueNo = null;
const e = {};

// El 3 es la cuenta del token. El 5, la administradora del sitio que da clase en el curso 500.
const C = {
  delToken: 3,
  admins: [5],
  permitidas: new Set(),
  cuenta: 'bien', // 'bien' | 'vieja' (plugin anterior a la 1.11.7, sin `permitida`) | 'cae'
  usuarios: {
    3: { id: 3, email: 'crm@campus.test', fullname: 'crm_servicio', suspended: 0 },
    5: { id: 5, email: `admin.${marca}@campus.test`, fullname: 'Admin que da clase', suspended: 0 },
  },
  matriculados: {
    500: [
      { id: 5, fullname: 'Admin que da clase', roles: [{ shortname: 'editingteacher' }] },
      { id: 60, fullname: 'Alumno', roles: [{ shortname: 'student' }] },
    ],
  },
};

const json = (datos) => ({ ok: true, status: 200, json: async () => datos });
const moodleFalso = vi.fn(async (_url, { body }) => {
  const p = new URLSearchParams(body);
  if (p.get('wstoken') !== 'token-campus') return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' });
  switch (p.get('wsfunction')) {
    case 'core_webservice_get_site_info':
      return json({ sitename: 'Campus', userid: C.delToken, userissiteadmin: false });
    case 'core_user_get_users_by_field': {
      const u = Object.values(C.usuarios).find((x) => String(x[p.get('field')]) === p.get('values[0]'));
      return json(u ? [u] : []);
    }
    case 'core_enrol_get_users_courses':
      return json(p.get('userid') === '5' ? [{ id: 500, fullname: 'Curso 500' }] : []);
    case 'core_enrol_get_enrolled_users':
      return json(C.matriculados[p.get('courseid')] || []);
    case 'local_crm_cuenta': {
      if (C.cuenta === 'cae') return { ok: false, status: 503, json: async () => ({}) };
      const id = Number(p.get('userid'));
      const existe = Boolean(C.usuarios[id]);
      const r = { existe, siteadmin: existe && C.admins.includes(id) };
      if (C.cuenta === 'bien') r.permitida = r.siteadmin && C.permitidas.has(id);
      return json(r);
    }
    case 'mod_assign_get_assignments':
      return json({ courses: [{ id: 500, assignments: [{ id: 900, cmid: 9000, name: 'Tarea', grade: 10, teamsubmission: 0 }] }], warnings: [] });
    case 'local_crm_calificar':
      return json({ ok: true, nota: Number(p.get('nota')), maxima: 10, comentario: false });
    default:
      return json({ exception: 'moodle_exception', errorcode: 'accessexception', message: 'Access control exception' });
  }
});
const llamadas = (funcion) => moodleFalso.mock.calls
  .map(([, { body }]) => Object.fromEntries(new URLSearchParams(body)))
  .filter((p) => p.wsfunction === funcion);

async function crearUsuario(role) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active)
     VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${role} ${marca}`, `${role}.${ids.users.length}.${marca}@test.local`, role]);
  ids.users.push(rows[0].id);
  return Number(rows[0].id);
}

const permitidaEnLaBase = async () => {
  const { rows } = await query(
    'SELECT admin_sitio_permitida FROM tutor_campus WHERE tutor_id = $1 AND project_id = $2', [e.tutora, e.campus]);
  return rows[0]?.admin_sitio_permitida;
};
const enLaFicha = async () => (await campus.campusDelTutor(e.tutora)).find((c) => c.project_id === e.campus);
const enMiCampus = async () => (await miCampus(e.tutora, { refrescar: true })).campus.find((x) => x.projectId === e.campus);

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
    e.gestor = await crearUsuario('admin');
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

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('la administradora del sitio que da clase y el campus que la permite (plugin 1.11.7)', () => {
  it('enlazada como excepción sin estar en la lista del campus: responde y corrige desde Moodle, como hasta ahora', async () => {
    if (!hayBase) return;
    const r = await campus.vincularAMano(e.tutora, e.campus, 5, { excepcionAdminDelSitio: true, porQuien: e.gestor });
    expect(r).toMatchObject({ adminDelSitio: true, adminPermitida: false });
    expect(await permitidaEnLaBase()).toBe(false);
    expect(await campus.soloDesdeMoodle(e.tutora, e.campus)).toBe(true);
    expect(await enLaFicha()).toMatchObject({ admin_sitio_excepcion: true, admin_sitio_permitida: false });
    expect(await enMiCampus()).toMatchObject({ soloDesdeMoodle: true });
  });

  it('el campus la añade a «Administradoras que dan clase»: la comprobación se entera y deja de ser «desde Moodle»', async () => {
    if (!hayBase) return;
    C.permitidas.add(5);
    await campus.comprobarTutor(e.tutora, { soloProyectos: [e.campus] });
    expect(await permitidaEnLaBase()).toBe(true);
    expect(await campus.soloDesdeMoodle(e.tutora, e.campus)).toBe(false);
    expect(await enLaFicha()).toMatchObject({ admin_sitio_excepcion: true, admin_sitio_permitida: true });
    const c = await enMiCampus();
    expect(c).toMatchObject({ soloDesdeMoodle: false });
    expect(c.cursos.map((k) => k.id)).toEqual([500]);
  });

  it('permitida: la nota va por el plugin, a su nombre', async () => {
    if (!hayBase) return;
    moodleFalso.mockClear();
    const r = await calificar(e.tutora, e.campus, 500, 900, { alumnoId: 60, nota: 7, comentario: '' });
    expect(r).toMatchObject({ nota: 7, maxima: 10 });
    expect(llamadas('local_crm_calificar')).toEqual([expect.objectContaining({ desde: '5', tarea: '900', alumno: '60', nota: '7' })]);
  });

  it('si el campus no contesta, o tiene un plugin anterior a la 1.11.7, se queda como estaba', async () => {
    if (!hayBase) return;
    C.cuenta = 'cae';
    await campus.comprobarTutor(e.tutora, { soloProyectos: [e.campus] });
    expect(await permitidaEnLaBase()).toBe(true);
    // Un plugin anterior contesta sin `permitida`: eso sí es un «no».
    C.cuenta = 'vieja';
    await campus.comprobarTutor(e.tutora, { soloProyectos: [e.campus] });
    expect(await permitidaEnLaBase()).toBe(false);
    C.cuenta = 'bien';
    await campus.comprobarTutor(e.tutora, { soloProyectos: [e.campus] });
    expect(await permitidaEnLaBase()).toBe(true);
  });

  it('el campus la quita de la lista: vuelve a «desde Moodle» y corregir no llama al campus', async () => {
    if (!hayBase) return;
    C.permitidas.delete(5);
    await campus.comprobarTutor(e.tutora, { soloProyectos: [e.campus] });
    expect(await permitidaEnLaBase()).toBe(false);
    expect(await campus.soloDesdeMoodle(e.tutora, e.campus)).toBe(true);
    moodleFalso.mockClear();
    await expect(calificar(e.tutora, e.campus, 500, 900, { alumnoId: 60, nota: 5, comentario: '' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'RESPONDE_DESDE_MOODLE' });
    expect(llamadas('local_crm_calificar')).toEqual([]);
  });

  it('enlazada cuando el campus ya la permite: permitida desde el primer momento', async () => {
    if (!hayBase) return;
    C.permitidas.add(5);
    const r = await campus.vincularAMano(e.tutora, e.campus, 5, { excepcionAdminDelSitio: true, porQuien: e.gestor });
    expect(r).toMatchObject({ adminDelSitio: true, adminPermitida: true });
    expect(await permitidaEnLaBase()).toBe(true);
    expect(await campus.soloDesdeMoodle(e.tutora, e.campus)).toBe(false);
  });

  it('«Vincular de nuevo» olvida la cuenta, la excepción y el permiso', async () => {
    if (!hayBase) return;
    await campus.desvincularCuenta(e.tutora, e.campus);
    const { rows: [f] } = await query(
      `SELECT moodle_user_id, admin_sitio_excepcion_at, admin_sitio_permitida
         FROM tutor_campus WHERE tutor_id = $1 AND project_id = $2`, [e.tutora, e.campus]);
    expect(f).toMatchObject({ moodle_user_id: null, admin_sitio_excepcion_at: null, admin_sitio_permitida: false });
    expect((await enLaFicha()).admin_sitio_permitida).toBe(false);
  });
});
