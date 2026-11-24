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
import { estadoPorRoles } from '../src/modules/tutores/tutor.redaccion.js';
import { redactorasMoodleActivo } from '../src/shared/config/soloEnPruebas.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';

// Como en tutoresVincularCuenta689: el superadmin de estas pruebas (`userId: 0`) no está
// en la base; solo a ese id se le da el mapa de un superadmin, los demás, el de verdad.
vi.mock('../src/modules/permissions/permissions.service.js', async (original) => {
  const real = await original();
  const { resolverPermisos } = await import('../src/modules/permissions/resolver.js');
  const superadmin = { ...resolverPermisos({ role: 'superadmin', roles_extra: [], excepciones: {} }), persona: { id: 0, role: 'superadmin', roles_extra: [], active: true } };
  return { ...real, explicarPermisos: (id, ...resto) => (Number(id) === 0 ? Promise.resolve(superadmin) : real.explicarPermisos(id, ...resto)) };
});

/*
  CRM#1026 · Las tutoras redactoras en Moodle: en su ficha, si su cuenta de cada campus
  está lista y si es profesora de los cursos que redacta (sus productos por colaboración,
  curso pendiente o «Responsable de desarrollarlo», con su curso de Moodle unido).

    · profesora / otro rol / sin matrícula, curso a curso, con el enlace a participantes;
    · «Profesor» (`editingteacher`) es lo correcto, como las tutoras de hoy; «Profesor
      sin permiso de edición» (`teacher`) no deja redactar: no está «lista»;
    · sin cuenta con su correo, cuenta suspendida o administradora del sitio: se dice;
    · los productos sin curso de Moodle, aparte;
    · el admin de una empresa solo ve los campus de la suya;
    · la redactora ve lo suyo en «Mi campus», con el id de su token, y nunca lo de otra;
    · SOLO LEE: ni una función de Moodle que escriba ni un cambio en `tutor_campus`;
    · en producción no se monta sin REDACTORAS_MOODLE_EN_PRODUCCION=1.

  Contra la base local, con un Moodle de mentira (sin red) por campus.
  Porte a ISEIE del 360 (diego-landaeta/CRM#1059), en la línea de #687.
*/

const marca = `t1026${Date.now()}`;
const ids = { users: [], projects: [], issuers: [], products: [] };
let hayBase = true;
let porQueNo = null;
const e = {};

// Las funciones que puede pedir esta comprobación: todas de lectura.
const DE_LECTURA = new Set([
  'core_user_get_users_by_field', 'core_enrol_get_users_courses', 'core_enrol_get_enrolled_users',
  'local_crm_cuenta', 'core_webservice_get_site_info',
]);
const pedidas = [];

// A: la redactora (id 10) es profesora con edición del curso 100 y ALUMNA del 101; el 102
// no lo tiene. El 7 es el administrador del sitio, que también da clase en el 100.
// B: la redactora no tiene cuenta con su correo.
const CAMPUS = {
  'token-a': {
    admins: [7],
    usuarios: {},
    cursos: {},
    matriculados: {},
  },
  'token-b': { admins: [], usuarios: {}, cursos: {}, matriculados: {} },
};

const moodleFalso = vi.fn(async (_url, { body }) => {
  const p = new URLSearchParams(body);
  const json = (datos) => ({ ok: true, status: 200, json: async () => datos });
  const c = CAMPUS[p.get('wstoken')];
  pedidas.push(p.get('wsfunction'));
  if (!c) return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' });
  switch (p.get('wsfunction')) {
    case 'core_webservice_get_site_info':
      return json({ sitename: 'Campus', userid: 2, userissiteadmin: false });
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
      const id = Number(p.get('userid'));
      return json({ existe: Boolean(c.usuarios[id]), siteadmin: c.admins.includes(id) });
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
  if (token) {
    const enc = encrypt(token);
    await query(
      `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
       VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
      [id, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url: `https://${nombre.toLowerCase()}.prueba.local/` })]);
  }
  return id;
}

async function crearProducto(nombre, projectId, responsable, cursos = []) {
  const { rows } = await query(
    'INSERT INTO products (project_id, nombre, responsable_desarrollo_id) VALUES ($1, $2, $3) RETURNING id',
    [projectId, `${nombre} ${marca}`, responsable]);
  const id = Number(rows[0].id);
  ids.products.push(id);
  for (const [campusId, cursoId] of cursos) {
    await query(
      'INSERT INTO moodle_cursos_producto (product_id, project_id, curso_moodle_id, curso_nombre) VALUES ($1, $2, $3, $4)',
      [id, campusId, cursoId, `Curso ${cursoId}`]);
  }
  return id;
}

const darCampus = (userId, projectId) => query(
  'INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true) ON CONFLICT DO NOTHING', [userId, projectId]);

const vinculos = async (tutorId) => (await query(
  'SELECT project_id, estado, moodle_user_id, comprobado_at FROM tutor_campus WHERE tutor_id = $1 ORDER BY project_id', [tutorId])).rows;

beforeAll(async () => {
  try {
    vi.stubGlobal('fetch', moodleFalso);
    e.empresaA = await crearEmpresa('CEDIA');
    e.empresaB = await crearEmpresa('ISEIE');
    e.campusA = await crearCampus('CampusA', e.empresaA, 'token-a');
    e.campusB = await crearCampus('CampusB', e.empresaB, 'token-b');
    e.campusC = await crearCampus('CampusC', e.empresaA, null); // sin Moodle conectado
    e.adminA = await crearUsuario('admin');
    e.adminB = await crearUsuario('admin');
    await darCampus(e.adminA, e.campusA);
    await darCampus(e.adminA, e.campusC);
    await darCampus(e.adminB, e.campusB);

    e.correo = `redactora.${marca}@test.local`;
    e.redactora = await crearUsuario('tutor_redactor', e.correo);
    const a = CAMPUS['token-a'];
    a.usuarios = {
      7: { id: 7, email: `admin.${marca}@test.local`, fullname: 'Admin del sitio', suspended: 0 },
      10: { id: 10, email: e.correo, fullname: 'Redactora en A', suspended: 0 },
    };
    a.cursos = { 10: [100, 101], 7: [100] };
    a.matriculados = {
      100: [{ id: 10, roles: [{ shortname: 'editingteacher' }] }, { id: 7, roles: [{ shortname: 'editingteacher' }] }],
      101: [{ id: 10, roles: [{ shortname: 'student' }] }],
    };

    e.p1 = await crearProducto('Curso de apego', e.campusA, e.redactora, [[e.campusA, 100]]);
    // Suyo por una colaboración activa (sin ser la responsable).
    e.p2 = await crearProducto('Curso de duelo', e.campusA, null, [[e.campusA, 101], [e.campusA, 102]]);
    await query('INSERT INTO tutor_collaborations (tutor_id, product_id, pct) VALUES ($1, $2, 0)', [e.redactora, e.p2]);
    // Suyo por un curso pendiente asignado; el cancelado no cuenta.
    e.p3 = await crearProducto('Curso sin Moodle', e.campusA, null);
    await query(`INSERT INTO cursos_pendientes (project_id, product_id, nombre, tutor_id, estado) VALUES ($1, $2, 'x', $3, 'asignado')`, [e.campusA, e.p3, e.redactora]);
    e.p6 = await crearProducto('Curso cancelado', e.campusA, null, [[e.campusA, 600]]);
    await query(`INSERT INTO cursos_pendientes (project_id, product_id, nombre, tutor_id, estado) VALUES ($1, $2, 'x', $3, 'cancelado')`, [e.campusA, e.p6, e.redactora]);
    e.p4 = await crearProducto('Curso de B', e.campusB, e.redactora, [[e.campusB, 500]]);
    e.p5 = await crearProducto('Curso de C', e.campusC, e.redactora, [[e.campusC, 900]]);
    // De otra persona: no sale.
    e.otra = await crearUsuario('tutor');
    e.pAjeno = await crearProducto('Curso ajeno', e.campusA, e.otra, [[e.campusA, 100]]);

    await campus.asignarCampus(e.redactora, e.campusA);
    await campus.asignarCampus(e.redactora, e.campusB);
    await campus.comprobarTutor(e.redactora);
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const [sql, p] of [
    ['DELETE FROM cursos_pendientes WHERE product_id = ANY($1::int[])', [ids.products]],
    ['DELETE FROM tutor_collaborations WHERE product_id = ANY($1::int[])', [ids.products]],
    ['DELETE FROM products WHERE id = ANY($1::int[])', [ids.products]],
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
const pide = (user) => {
  const token = jwt.sign(user, process.env.JWT_SECRET);
  return { get: (u) => supertest(app).get(u).set('Authorization', `Bearer ${token}`) };
};
const comoSuperadmin = () => pide({ userId: 0, role: 'superadmin' });
const comoAdminA = () => pide({ userId: e.adminA, role: 'admin' });
const comoAdminB = () => pide({ userId: e.adminB, role: 'admin' });
const comoRedactora = () => pide({ userId: e.redactora, role: 'tutor_redactor' });
const comoOtra = () => pide({ userId: e.otra, role: 'tutor' });

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('#1026 · la redactora en Moodle, en su ficha', () => {
  it('curso a curso: profesora, otro rol y sin matrícula, con el enlace a participantes', async () => {
    if (!hayBase) return;
    const r = await comoSuperadmin().get(`/api/tutores/${e.redactora}/redaccion-moodle`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data;
    expect(d.es_redactora).toBe(true);
    expect(d.lista).toBe(false);

    const a = d.campus.find((c) => c.project_id === e.campusA);
    expect(a).toMatchObject({ tiene_campus: true, campus_conectado: true, vinculada_en_crm: true, problemas: [] });
    expect(a.cuenta).toMatchObject({ id: 10, suspendida: false });
    const porCurso = Object.fromEntries(a.cursos.map((c) => [c.curso_moodle_id, c]));
    expect(porCurso[100]).toMatchObject({ estado: 'profesora', product_id: e.p1, por: ['responsable'], enlace: 'https://campusa.prueba.local/user/index.php?id=100' });
    expect(porCurso[101]).toMatchObject({ estado: 'otro_rol', roles: ['student'], product_id: e.p2, por: ['colaboracion'] });
    expect(porCurso[102]).toMatchObject({ estado: 'sin_matricula', product_id: e.p2 });

    // Los productos sin curso de Moodle, aparte; el de otra persona y el pendiente cancelado, en ningún sitio.
    expect(d.sin_curso).toEqual([expect.objectContaining({ product_id: e.p3, por: ['curso_pendiente'] })]);
    expect(JSON.stringify(d)).not.toContain('Curso cancelado');
    expect(JSON.stringify(d)).not.toContain('Curso ajeno');
  });

  it('en B no tiene cuenta con su correo; en C el campus no tiene Moodle ni se lo han asignado', async () => {
    if (!hayBase) return;
    const d = (await comoSuperadmin().get(`/api/tutores/${e.redactora}/redaccion-moodle`)).body.data;
    const b = d.campus.find((c) => c.project_id === e.campusB);
    expect(b.cuenta).toBeNull();
    expect(b.problemas.join(' ')).toContain(`No hay ninguna cuenta en este Moodle con su correo del CRM (${e.correo})`);
    expect(b.cursos.map((c) => c.estado)).toEqual(['sin_matricula']);
    const c = d.campus.find((x) => x.project_id === e.campusC);
    expect(c).toMatchObject({ tiene_campus: false, campus_conectado: false });
    expect(c.problemas.join(' ')).toContain('no está conectado en Integraciones');
    expect(c.problemas.join(' ')).toContain('No tiene este campus');
    expect(c.cursos.map((k) => k.estado)).toEqual(['sin_comprobar']);
  });

  it('el admin de una empresa solo ve los campus de la suya', async () => {
    if (!hayBase) return;
    const deA = (await comoAdminA().get(`/api/tutores/${e.redactora}/redaccion-moodle`)).body.data;
    expect(deA.campus.map((c) => c.project_id).sort()).toEqual([e.campusA, e.campusC].sort());
    const deB = await comoAdminB().get(`/api/tutores/${e.redactora}/redaccion-moodle`);
    expect(deB.status, JSON.stringify(deB.body)).toBe(200);
    expect(deB.body.data.campus.map((c) => c.project_id)).toEqual([e.campusB]);
    expect(deB.body.data.sin_curso).toEqual([]);
  });

  it('la ruta de la ficha es de quien gestiona tutores: la redactora, ni con su id (403)', async () => {
    if (!hayBase) return;
    const r = await comoRedactora().get(`/api/tutores/${e.redactora}/redaccion-moodle`);
    expect(r.status).toBe(403);
  });

  it('la redactora ve lo suyo en «Mi campus», con los avisos dirigidos a ella', async () => {
    if (!hayBase) return;
    const r = await comoRedactora().get('/api/tutores/mi-campus/redaccion-moodle');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data;
    expect(d).toMatchObject({ es_redactora: true, rol_moodle: 'editingteacher', lista: false });
    // Sus tres campus: lo suyo no se recorta por empresa.
    expect(d.campus.map((c) => c.project_id).sort()).toEqual([e.campusA, e.campusB, e.campusC].sort());
    const a = d.campus.find((c) => c.project_id === e.campusA);
    expect(Object.fromEntries(a.cursos.map((c) => [c.curso_moodle_id, c.estado])))
      .toEqual({ 100: 'profesora', 101: 'otro_rol', 102: 'sin_matricula' });
    const b = d.campus.find((c) => c.project_id === e.campusB);
    expect(b.problemas.join(' ')).toContain(`con tu correo del CRM (${e.correo}): pide a coordinación`);
    const c = d.campus.find((x) => x.project_id === e.campusC);
    expect(c.problemas.join(' ')).toContain('No tienes este campus asignado en el CRM');
    expect(d.sin_curso.map((p) => p.product_id)).toEqual([e.p3]);
    expect(JSON.stringify(d)).not.toContain('Curso ajeno');
  });

  it('y no lo de otra: la ficha de otra da 403, y la suya no admite otro id (404 o lo suyo)', async () => {
    if (!hayBase) return;
    expect((await comoRedactora().get(`/api/tutores/${e.otra}/redaccion-moodle`)).status).toBe(403);
    // Un id en la ruta no existe.
    expect((await comoRedactora().get(`/api/tutores/mi-campus/redaccion-moodle/${e.otra}`)).status).toBe(404);
    // Un id en la consulta no cambia nada: sigue siendo la suya.
    const r = await comoRedactora().get(`/api/tutores/mi-campus/redaccion-moodle?id=${e.otra}&tutorId=${e.otra}`);
    expect(r.status).toBe(200);
    const productos = r.body.data.campus.flatMap((c) => c.cursos.map((k) => k.product_id));
    expect(productos).toContain(e.p1);
    expect(productos).not.toContain(e.pAjeno);
  });

  it('otra tutora, en la misma ruta, ve lo suyo y nada de la redactora', async () => {
    if (!hayBase) return;
    const r = await comoOtra().get('/api/tutores/mi-campus/redaccion-moodle');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.es_redactora).toBe(false);
    const productos = r.body.data.campus.flatMap((c) => c.cursos.map((k) => k.product_id));
    expect(productos).toEqual([e.pAjeno]);
    expect(JSON.stringify(r.body.data)).not.toContain(e.correo);
  });

  it('quien no tiene «sus cursos» (un admin) no entra en la de «Mi campus»: 403', async () => {
    if (!hayBase) return;
    expect((await comoAdminA().get('/api/tutores/mi-campus/redaccion-moodle')).status).toBe(403);
  });

  it('cuenta suspendida o del administrador del sitio: se dice y no está lista', async () => {
    if (!hayBase) return;
    const a = CAMPUS['token-a'];
    a.usuarios[10].suspended = 1;
    let d = (await comoSuperadmin().get(`/api/tutores/${e.redactora}/redaccion-moodle`)).body.data;
    expect(d.campus.find((c) => c.project_id === e.campusA).problemas).toContain('Su cuenta de este Moodle está suspendida.');
    a.usuarios[10].suspended = 0;

    a.admins.push(10);
    d = (await comoSuperadmin().get(`/api/tutores/${e.redactora}/redaccion-moodle`)).body.data;
    expect(d.campus.find((c) => c.project_id === e.campusA).problemas.join(' ')).toContain('administrador del sitio');
    a.admins.pop();
  });

  it('«Profesor sin permiso de edición» no deja redactar: no está lista hasta que es «Profesor», como las tutoras', async () => {
    if (!hayBase) return;
    const a = CAMPUS['token-a'];
    a.matriculados[101] = [{ id: 10, roles: [{ shortname: 'teacher' }] }];
    a.cursos[10] = [100, 101, 102];
    a.matriculados[102] = [{ id: 10, roles: [{ shortname: 'student' }, { shortname: 'editingteacher' }] }];
    // Fuera los campus con problemas: el de B (sin cuenta) y el de C (sin Moodle).
    await query('DELETE FROM moodle_cursos_producto WHERE product_id = ANY($1::int[])', [[e.p4, e.p5]]);
    let d = (await comoSuperadmin().get(`/api/tutores/${e.redactora}/redaccion-moodle`)).body.data;
    expect(d.rol_moodle).toBe('editingteacher');
    expect(d.campus.map((c) => c.project_id)).toEqual([e.campusA]);
    expect(d.campus[0].cursos.map((c) => c.estado)).toEqual(['profesora', 'sin_edicion', 'profesora']);
    expect(d.campus[0].cursos[1].roles).toEqual(['teacher']);
    expect(d.lista).toBe(false);

    a.matriculados[101] = [{ id: 10, roles: [{ shortname: 'editingteacher' }] }];
    d = (await comoSuperadmin().get(`/api/tutores/${e.redactora}/redaccion-moodle`)).body.data;
    expect(d.campus[0].cursos.map((c) => c.estado)).toEqual(['profesora', 'profesora', 'profesora']);
    expect(d.lista).toBe(true);
  });

  it('«Gestor» (`manager`) cuenta como profesora solo con MOODLE_ROLES_TUTORA=manager, como en ISEIE', async () => {
    if (!hayBase) return;
    const a = CAMPUS['token-a'];
    const antes = process.env.MOODLE_ROLES_TUTORA;
    a.matriculados[101] = [{ id: 10, roles: [{ shortname: 'manager' }] }];
    try {
      delete process.env.MOODLE_ROLES_TUTORA;
      let d = (await comoSuperadmin().get(`/api/tutores/${e.redactora}/redaccion-moodle`)).body.data;
      expect(d.campus[0].cursos[1]).toMatchObject({ estado: 'otro_rol', roles: ['manager'] });
      expect(d.lista).toBe(false);

      process.env.MOODLE_ROLES_TUTORA = 'manager';
      d = (await comoSuperadmin().get(`/api/tutores/${e.redactora}/redaccion-moodle`)).body.data;
      expect(d.campus[0].cursos.map((c) => c.estado)).toEqual(['profesora', 'profesora', 'profesora']);
      expect(d.lista).toBe(true);
      // Y ella, en «Mi campus», lo ve igual.
      const suya = (await comoRedactora().get('/api/tutores/mi-campus/redaccion-moodle')).body.data;
      expect(suya.campus[0].cursos[1]).toMatchObject({ estado: 'profesora', roles: ['manager'] });
    } finally {
      if (antes === undefined) delete process.env.MOODLE_ROLES_TUTORA;
      else process.env.MOODLE_ROLES_TUTORA = antes;
      a.matriculados[101] = [{ id: 10, roles: [{ shortname: 'editingteacher' }] }];
    }
  });

  it('solo LEE: ninguna función de Moodle que escriba y `tutor_campus` sin tocar', async () => {
    if (!hayBase) return;
    const antes = await vinculos(e.redactora);
    pedidas.length = 0;
    await comoSuperadmin().get(`/api/tutores/${e.redactora}/redaccion-moodle`);
    await comoRedactora().get('/api/tutores/mi-campus/redaccion-moodle');
    expect(pedidas.length).toBeGreaterThan(0);
    expect(pedidas.filter((f) => !DE_LECTURA.has(f))).toEqual([]);
    expect(await vinculos(e.redactora)).toEqual(antes);
  });
});

describe('#1026 · el interruptor', () => {
  it('apagado en producción; encendido en local, en /staging o con REDACTORAS_MOODLE_EN_PRODUCCION=1', () => {
    expect(redactorasMoodleActivo({ NODE_ENV: 'production', CRM_BASE_URL: 'https://x/crm' })).toBe(false);
    expect(redactorasMoodleActivo({ NODE_ENV: 'production', CRM_BASE_URL: 'https://x/staging' })).toBe(true);
    expect(redactorasMoodleActivo({ NODE_ENV: 'production', REDACTORAS_MOODLE_EN_PRODUCCION: '1' })).toBe(true);
    expect(redactorasMoodleActivo({ NODE_ENV: 'development' })).toBe(true);
  });
});

describe('#1026 · qué rol cuenta como profesora', () => {
  it('«Profesor» siempre; los de MOODLE_ROLES_TUTORA si el .env los añade; «Profesor sin edición», nunca', () => {
    expect(estadoPorRoles(['editingteacher'], {})).toBe('profesora');
    expect(estadoPorRoles(['manager'], {})).toBe('otro_rol');
    expect(estadoPorRoles(['manager'], { MOODLE_ROLES_TUTORA: 'manager' })).toBe('profesora');
    expect(estadoPorRoles(['student', 'manager'], { MOODLE_ROLES_TUTORA: 'coursecreator, manager' })).toBe('profesora');
    expect(estadoPorRoles(['teacher'], { MOODLE_ROLES_TUTORA: 'manager' })).toBe('sin_edicion');
    expect(estadoPorRoles(['teacher'], { MOODLE_ROLES_TUTORA: 'teacher' })).toBe('sin_edicion');
    expect(estadoPorRoles(['student'], { MOODLE_ROLES_TUTORA: 'manager' })).toBe('otro_rol');
  });
});
