import {
  describe, it, expect, beforeAll, afterAll, beforeEach, vi,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';
import leadRoutes from '../src/modules/leads/lead.routes.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';
import { cursosDe, notasDelAlumno } from '../src/shared/services/moodle.client.js';
import { estadoDelCurso, diasSinAccesoMaximos, olvidarAvances } from '../src/modules/leads/avance-moodle.js';

// El interruptor del plugin (PLUGIN_MOODLE_EN_PRODUCCION), para poder apagarlo en una prueba.
const interruptor = vi.hoisted(() => ({ activo: true }));
vi.mock('../src/shared/config/soloEnPruebas.js', async (original) => ({
  ...(await original()),
  pluginMoodleActivo: () => interruptor.activo,
}));

vi.mock('../src/modules/permissions/permissions.service.js', async (original) => {
  const real = await original();
  const { resolverPermisos } = await import('../src/modules/permissions/resolver.js');
  const superadmin = { ...resolverPermisos({ role: 'superadmin', roles_extra: [], excepciones: {} }), persona: { id: 0, role: 'superadmin', roles_extra: [], active: true } };
  return { ...real, explicarPermisos: (id, ...resto) => (Number(id) === 0 ? Promise.resolve(superadmin) : real.explicarPermisos(id, ...resto)) };
});

/*
  #532 · El avance en Moodle en la ficha del alumno: último acceso, % hecho y notas.

    · Por la conexión de siempre (la de Consultas y «Mi campus»), con funciones de solo
      lectura; el % es el de `cursosDe` (`progresoDeMoodle`), no otro cálculo.
    · Un curso sin finalización activada dice «sin seguimiento» (null), no 0 %.
    · Estado: terminado · sin acceso (nunca o más de X días) · activo.
    · Notas de cada actividad y la final; las ocultas y las vacías no salen. Con un plugin
      anterior a la 1.10.9 (sin la función) se avisa y el resto sale.
    · Permisos: los de la ficha (la gestora, solo los suyos) y, además, solo sus campus.
    · Caché corta por campus y alumno; «refrescar» vuelve a preguntar.
    · Con el plugin sin aprobar en producción, `disponible: false` y no se llama a nadie.

  Contra la base LOCAL desechable y con dos Moodle de mentira (sin red).
*/

const marca = `t532${Date.now()}`;
const ids = { users: [], projects: [], leads: [], products: [] };
let hayBase = true;
let porQueNo = null;
const e = {};

const AHORA_S = Math.floor(Date.now() / 1000);
const haceDias = (d) => AHORA_S - d * 86400;
const CORREO = `alumna.${marca}@campus.test`;

// token-a: plugin al día (con notas). token-b: plugin viejo (sin la función de notas).
const CAMPUS = {
  'token-a': {
    usuarios: [{ id: 900, email: CORREO, fullname: 'Alumna de prueba', suspended: 0, lastaccess: haceDias(2) }],
    cursos: [
      { id: 30, fullname: 'Curso con seguimiento', enablecompletion: true, progress: 40.4, completed: false, lastaccess: haceDias(2) },
      { id: 31, fullname: 'Curso sin seguimiento', enablecompletion: false, progress: 75, completed: false, lastaccess: haceDias(30) },
      { id: 32, fullname: 'Curso terminado', enablecompletion: 1, progress: 100, completed: true, lastaccess: haceDias(60) },
      { id: 33, fullname: 'Curso sin entrar', enablecompletion: 1, progress: 0, completed: false, lastaccess: 0 },
    ],
    notas: {
      30: [
        { id: 1, itemname: 'Tarea 1', itemtype: 'mod', itemmodule: 'assign', graderaw: 8, gradeformatted: '8,00', grademax: 10, percentageformatted: '80,00 %' },
        { id: 2, itemname: 'Cuestionario', itemtype: 'mod', itemmodule: 'quiz', graderaw: null, gradeformatted: '-', grademax: 10 },
        { id: 3, itemname: 'Oculta', itemtype: 'mod', itemmodule: 'assign', graderaw: 2, gradeformatted: '2,00', grademax: 10, gradeishidden: true },
        { id: 4, itemname: null, itemtype: 'course', graderaw: 8, gradeformatted: '8,00', grademax: 10, percentageformatted: '80,00 %' },
      ],
    },
  },
  'token-b': {
    usuarios: [{ id: 77, email: CORREO, fullname: 'Alumna de prueba', suspended: 0, lastaccess: haceDias(1) }],
    cursos: [{ id: 5, fullname: 'Curso en B', enablecompletion: true, progress: 10, lastaccess: haceDias(1) }],
    notas: null,
  },
};

const llamadas = [];
const moodleFalso = vi.fn(async (_url, { body }) => {
  const p = new URLSearchParams(body);
  const json = (datos) => ({ ok: true, status: 200, json: async () => datos });
  const c = CAMPUS[p.get('wstoken')];
  llamadas.push(p.get('wsfunction'));
  if (!c) return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' });
  switch (p.get('wsfunction')) {
    case 'core_user_get_users_by_field': {
      const u = c.usuarios.find((x) => String(x[p.get('field')]) === p.get('values[0]'));
      return json(u ? [u] : []);
    }
    case 'core_enrol_get_users_courses':
      return json(c.cursos);
    case 'gradereport_user_get_grade_items': {
      if (!c.notas) return json({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Access control exception' });
      const userid = Number(p.get('userid'));
      return json({ usergrades: [{ courseid: Number(p.get('courseid')), userid, gradeitems: c.notas[p.get('courseid')] || [] }], warnings: [] });
    }
    default:
      return json({ exception: 'moodle_exception', errorcode: 'accessexception', message: 'Access control exception' });
  }
});

async function crearUsuario(role) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${role} ${marca}`, `${role}.${ids.users.length}.${marca}@test.local`, role]);
  ids.users.push(rows[0].id);
  return Number(rows[0].id);
}

async function crearCampus(nombre, token) {
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre.toLowerCase()}-${marca}`, `k-${marca}-${ids.projects.length}`]);
  const id = Number(rows[0].id);
  ids.projects.push(id);
  if (token) {
    const enc = encrypt(token);
    await query(
      `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
       VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
      [id, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url: `https://${nombre.toLowerCase()}.campus.test/` })]);
  }
  return id;
}

async function crearLead(projectId, responsableId, email) {
  const { rows } = await query(
    'INSERT INTO leads (nombre, email, project_id, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [`Alumna ${marca}`, email, projectId, responsableId]);
  ids.leads.push(rows[0].id);
  return Number(rows[0].id);
}

const darCampus = (userId, projectId) => query(
  'INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true) ON CONFLICT DO NOTHING', [userId, projectId]);

beforeAll(async () => {
  try {
    vi.stubGlobal('fetch', moodleFalso);
    e.campusA = await crearCampus('CampusA', 'token-a');
    e.campusB = await crearCampus('CampusB', 'token-b');
    e.sinMoodle = await crearCampus('SinMoodle', null);
    e.gestora = await crearUsuario('gestor');
    e.otra = await crearUsuario('gestor');
    await darCampus(e.gestora, e.campusA);
    await darCampus(e.otra, e.campusA);
    e.lead = await crearLead(e.campusA, e.gestora, CORREO);
    e.sinCorreo = await crearLead(e.campusA, e.gestora, null);
    // Una venta en B (otro campus del alumno) y otra en un campus sin Moodle (no sale).
    await query(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total) VALUES ($1, $2, 'Curso B', 100)`, [e.lead, e.campusB]);
    await query(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total) VALUES ($1, $2, 'Otro', 100)`, [e.lead, e.sinMoodle]);
    // La fecha de matrícula del curso 30: la venta de su producto (#767, moodle_cursos_producto).
    const { rows: [prod] } = await query(
      'INSERT INTO products (nombre, project_id) VALUES ($1, $2) RETURNING id', [`Producto ${marca}`, e.campusA]);
    ids.products.push(prod.id);
    await query('INSERT INTO moodle_cursos_producto (product_id, project_id, curso_moodle_id) VALUES ($1, $2, 30)', [prod.id, e.campusA]);
    await query(
      `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, fecha_conversion)
       VALUES ($1, $2, 'Curso A', $3, 100, '2026-09-15')`, [e.lead, e.campusA, prod.id]);
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const [sql, p] of [
    ['DELETE FROM conversions WHERE lead_id = ANY($1::int[])', [ids.leads]],
    ['DELETE FROM moodle_cursos_producto WHERE product_id = ANY($1::int[])', [ids.products]],
    ['DELETE FROM products WHERE id = ANY($1::int[])', [ids.products]],
    ['DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM project_integrations WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM activity_log WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
}, 120_000);

beforeEach(() => {
  olvidarAvances();
  llamadas.length = 0;
});

const app = express();
app.use(express.json());
app.use('/api/leads', leadRoutes);
app.use(errorHandler);
const pide = (user) => {
  const token = jwt.sign(user, process.env.JWT_SECRET);
  return (u) => supertest(app).get(u).set('Authorization', `Bearer ${token}`);
};
const comoSuperadmin = () => pide({ userId: 0, role: 'superadmin' });
const comoGestora = () => pide({ userId: e.gestora, role: 'gestor' });
const comoOtra = () => pide({ userId: e.otra, role: 'gestor' });

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('#532 · el estado del alumno en un curso', () => {
  const ahora = new Date('2026-11-18T12:00:00Z');
  const dias = (d) => new Date(ahora.getTime() - d * 86_400_000);
  it('terminado manda sobre el acceso; sin entrar nunca es «sin acceso» sin días; más de X días, «sin acceso»', () => {
    expect(estadoDelCurso({ terminado: true, ultimoAcceso: null }, { ahora, maximo: 14 })).toEqual({ estado: 'terminado', dias: null });
    expect(estadoDelCurso({ terminado: false, ultimoAcceso: null }, { ahora, maximo: 14 })).toEqual({ estado: 'sin_acceso', dias: null });
    expect(estadoDelCurso({ terminado: false, ultimoAcceso: dias(15) }, { ahora, maximo: 14 })).toEqual({ estado: 'sin_acceso', dias: 15 });
    expect(estadoDelCurso({ terminado: false, ultimoAcceso: dias(14) }, { ahora, maximo: 14 })).toEqual({ estado: 'activo', dias: 14 });
  });
  it('los días se cambian con AVANCE_MOODLE_DIAS_SIN_ACCESO; un valor raro deja los 14', () => {
    expect(diasSinAccesoMaximos({})).toBe(14);
    expect(diasSinAccesoMaximos({ AVANCE_MOODLE_DIAS_SIN_ACCESO: '30' })).toBe(30);
    expect(diasSinAccesoMaximos({ AVANCE_MOODLE_DIAS_SIN_ACCESO: 'x' })).toBe(14);
    expect(diasSinAccesoMaximos({ AVANCE_MOODLE_DIAS_SIN_ACCESO: '0' })).toBe(14);
  });
});

describe('#532 · lo que se lee de Moodle', () => {
  const conexion = { url: 'https://campusa.campus.test', token: 'token-a' };
  it('cursosDe dice si lo terminó, además del % (sin seguimiento, null)', async () => {
    const cursos = await cursosDe(conexion, 900);
    expect(cursos.find((k) => k.id === 32)).toMatchObject({ terminado: true, progreso: 100 });
    expect(cursos.find((k) => k.id === 30)).toMatchObject({ terminado: false, progreso: 40 });
    expect(cursos.find((k) => k.id === 31).progreso).toBeNull();
  });
  it('notasDelAlumno: las calificadas y la final; ni las ocultas ni las vacías', async () => {
    const n = await notasDelAlumno(conexion, 30, 900);
    expect(n.final).toMatchObject({ nota: 8, texto: '8,00', maxima: 10 });
    expect(n.actividades).toHaveLength(1);
    expect(n.actividades[0]).toMatchObject({ nombre: 'Tarea 1', tipo: 'assign', nota: 8, texto: '8,00', porcentaje: '80,00 %' });
    expect(llamadas).toContain('gradereport_user_get_grade_items');
  });
});

describe('#532 · GET /api/leads/:id/campus', () => {
  it('superadmin: cada campus con Moodle del alumno, curso a curso, con %, estado, notas y fecha de matrícula', async () => {
    if (!hayBase) return;
    const r = await comoSuperadmin()(`/api/leads/${e.lead}/campus`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data;
    expect(d.disponible).toBe(true);
    expect(d.diasSinAccesoMaximos).toBe(14);
    // A (el de su ficha) y B (el de una venta); el campus sin Moodle, no.
    expect(d.campus.map((c) => c.projectId).sort()).toEqual([e.campusA, e.campusB].sort());

    const a = d.campus.find((c) => c.projectId === e.campusA);
    expect(a.error).toBeNull();
    expect(a.avisoNotas).toBeNull();
    expect(a.alumno).toMatchObject({ moodleId: 900, perfilUrl: 'https://campusa.campus.test/user/profile.php?id=900' });
    expect(a.alumno.ultimoAcceso).toBeTruthy();
    const curso = (id) => a.cursos.find((k) => k.id === id);
    expect(curso(30)).toMatchObject({ progreso: 40, seguimiento: true, estado: 'activo', diasSinAcceso: 2, url: 'https://campusa.campus.test/course/view.php?id=30' });
    expect(String(curso(30).matriculadoEl)).toMatch(/^2026-09-1[45]/);
    expect(curso(30).notas.final.texto).toBe('8,00');
    expect(curso(30).notas.actividades.map((x) => x.nombre)).toEqual(['Tarea 1']);
    // Sin finalización: «sin seguimiento», nunca 0 %.
    expect(curso(31)).toMatchObject({ progreso: null, seguimiento: false, estado: 'sin_acceso', diasSinAcceso: 30, matriculadoEl: null });
    expect(curso(32)).toMatchObject({ estado: 'terminado', terminado: true });
    expect(curso(33)).toMatchObject({ estado: 'sin_acceso', diasSinAcceso: null, ultimoAcceso: null, progreso: 0 });
  });

  it('con un plugin anterior a la 1.10.9 (sin la función de notas) lo dice una vez y el resto sale', async () => {
    if (!hayBase) return;
    const r = await comoSuperadmin()(`/api/leads/${e.lead}/campus`);
    const b = r.body.data.campus.find((c) => c.projectId === e.campusB);
    expect(b.error).toBeNull();
    expect(b.avisoNotas).toMatch(/1\.10\.9/);
    expect(b.cursos[0]).toMatchObject({ id: 5, progreso: 10, notas: null });
  });

  it('se guarda unos minutos: la segunda vez no llama al campus; «refrescar» sí', async () => {
    if (!hayBase) return;
    await comoSuperadmin()(`/api/leads/${e.lead}/campus`);
    const primera = llamadas.length;
    expect(primera).toBeGreaterThan(0);
    await comoSuperadmin()(`/api/leads/${e.lead}/campus`);
    expect(llamadas.length).toBe(primera);
    await comoSuperadmin()(`/api/leads/${e.lead}/campus?refrescar=1`);
    expect(llamadas.length).toBeGreaterThan(primera);
  });

  it('la gestora ve el de su alumna solo en SUS campus; otra gestora, 403 y sin llamar a Moodle', async () => {
    if (!hayBase) return;
    const suya = await comoGestora()(`/api/leads/${e.lead}/campus`);
    expect(suya.status, JSON.stringify(suya.body)).toBe(200);
    expect(suya.body.data.campus.map((c) => c.projectId)).toEqual([e.campusA]);
    llamadas.length = 0;
    const ajena = await comoOtra()(`/api/leads/${e.lead}/campus`);
    expect(ajena.status).toBe(403);
    expect(llamadas).toHaveLength(0);
  });

  it('sin correo no se busca en el campus y se dice por qué', async () => {
    if (!hayBase) return;
    const r = await comoGestora()(`/api/leads/${e.sinCorreo}/campus`);
    expect(r.status).toBe(200);
    expect(r.body.data.campus[0].error).toMatch(/no tiene correo/);
    expect(llamadas).toHaveLength(0);
  });

  it('con el plugin sin aprobar en producción: disponible false y ninguna llamada al campus', async () => {
    if (!hayBase) return;
    interruptor.activo = false;
    try {
      const r = await comoSuperadmin()(`/api/leads/${e.lead}/campus`);
      expect(r.status).toBe(200);
      expect(r.body.data).toEqual({ disponible: false, campus: [] });
      expect(llamadas).toHaveLength(0);
    } finally {
      interruptor.activo = true;
    }
  });
});
