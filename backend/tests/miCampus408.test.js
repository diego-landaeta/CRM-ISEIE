import {
  describe, it, expect, vi, beforeAll, afterAll,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM-ISEIE#408 (gemela de CRM#681): «Mi campus» de la tutora, por la API.
 *
 *   · GET /api/tutores/mi-campus, con el permiso de sus cursos (`tutores.mis_cursos`):
 *     una gestora sin él, 403; sin sesión, 401.
 *   · Solo lo suyo: el id sale de la sesión; un `?tutorId=` de otra no cambia nada.
 *   · Por curso donde es PROFESORA en Moodle: sus alumnos con último acceso y % hecho,
 *     sus dudas abiertas en Consultas y las entregas sin corregir, cada una con el
 *     enlace al calificador de Moodle (aquí no se corrige desde el CRM: eso es el plugin, #406).
 *   · Lo que tiene por desarrollar (Cursos pendientes, #336), sin lo cerrado ni lo de otra.
 *   · Los campus asignados en los que su cuenta de Moodle no está, con el motivo.
 *
 * Contra la base LOCAL y con un Moodle de mentira (un `fetch` que contesta según la función).
 */

vi.mock('../src/modules/tutores/tutor.campus.js', async (importOriginal) => ({
  ...(await importOriginal()),
  conexionDelCampus: vi.fn(async () => ({ url: 'https://campus408.test', token: 'token-408' })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const { default: tutorRoutes } = await import('../src/modules/tutores/tutor.routes.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const MARCA = `mc408${Date.now().toString(36)}`;
const AHORA_S = Math.floor(Date.now() / 1000);

// ─── El Moodle de mentira ──────────────────────────────────────────────────────
// Tutora 1 = 801: profesora en el curso 50 (con seguimiento) y ALUMNA en el 51 (no cuenta).
const CURSOS_DE = {
  801: [{ id: 50, fullname: 'Curso de prueba', enablecompletion: true }, { id: 51, fullname: 'Curso donde es alumna', enablecompletion: true }],
  910: [{ id: 50, enablecompletion: true, progress: 62.6 }],
  911: [{ id: 50, enablecompletion: true, progress: null }],
};
const MATRICULADOS = {
  50: [
    { id: 801, fullname: 'Tutora 801', roles: [{ shortname: 'editingteacher' }] },
    { id: 910, fullname: 'Ana Prueba', email: 'ana@alumnos.test', roles: [{ shortname: 'student' }], lastcourseaccess: AHORA_S - 3600 },
    { id: 911, fullname: 'Beto Prueba', roles: [{ shortname: 'student' }], lastcourseaccess: 0 },
  ],
  51: [{ id: 801, fullname: 'Tutora 801', roles: [{ shortname: 'student' }] }],
};
const TAREAS = { 50: [{ id: 97, cmid: 17, name: 'Tarea final', grade: 10, duedate: AHORA_S + 86400 }] };
const ENTREGAS = { 97: [{ userid: 910, status: 'submitted', gradingstatus: 'notgraded', timemodified: AHORA_S - 7200 }] };

const lista = (params, prefijo) => Object.entries(params).filter(([k]) => k.startsWith(prefijo)).map(([, v]) => Number(v));
vi.stubGlobal('fetch', vi.fn(async (url, { body } = {}) => {
  const params = Object.fromEntries(new URLSearchParams(body));
  const f = params.wsfunction;
  let r = {};
  if (f === 'core_enrol_get_users_courses') r = CURSOS_DE[Number(params.userid)] || [];
  if (f === 'core_enrol_get_enrolled_users') r = MATRICULADOS[Number(params.courseid)] || [];
  if (f === 'mod_assign_get_assignments') r = { courses: lista(params, 'courseids').map((id) => ({ id, assignments: TAREAS[id] || [] })) };
  if (f === 'mod_assign_get_submissions') r = { assignments: lista(params, 'assignmentids').map((id) => ({ assignmentid: id, submissions: ENTREGAS[id] || [] })) };
  if (f === 'mod_assign_get_grades') r = { assignments: lista(params, 'assignmentids').map((id) => ({ assignmentid: id, grades: [] })) };
  return { ok: true, status: 200, json: async () => r };
}));

// ─── La base: un campus conectado, otro sin su cuenta, dos tutoras y una gestora ─
const ids = { users: [], projects: [] };
const g = {};
async function usuario(role, n) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA}.test`, role]);
  ids.users.push(Number(u.id));
  return Number(u.id);
}
async function campus(n) {
  const [p] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`${n} ${MARCA}`, `${n.toLowerCase()}-${MARCA}`, `k-${n}-${MARCA}`]);
  ids.projects.push(Number(p.id));
  return Number(p.id);
}

beforeAll(async () => {
  g.campus = await campus('Conectado');
  g.otro = await campus('SinCuenta');
  g.t1 = await usuario('tutor', 'UNO');
  g.t2 = await usuario('tutor', 'DOS');
  g.gestora = await usuario('gestor', 'GESTORA');
  await q(`INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'activa', 801)`, [g.t1, g.campus]);
  await q(`INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'pendiente', NULL)`, [g.t1, g.otro]);
  await q(`INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'activa', 802)`, [g.t2, g.campus]);
  // Dudas: una de un alumno del curso, otra de alguien que no está en sus cursos, una ya
  // respondida y una de la otra tutora.
  const duda = (tutor, alumno, nombre, estado = 'abierta') => q(
    `INSERT INTO consultas (project_id, tutor_id, alumno_moodle_id, alumno_nombre, estado, entrada_at)
     VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '3 hours') RETURNING id`, [g.campus, tutor, alumno, nombre, estado]);
  [{ id: g.dudaAna }] = await duda(g.t1, 910, 'Ana Prueba');
  [{ id: g.dudaFuera }] = await duda(g.t1, 999, 'Alguien de fuera');
  await duda(g.t1, 911, 'Beto Prueba', 'respondida');
  await duda(g.t2, 910, 'Ana Prueba');
  // Por desarrollar: uno suyo con fecha, uno suyo cerrado y uno de la otra tutora.
  const pendiente = (tutor, nombre, estado) => q(
    `INSERT INTO cursos_pendientes (project_id, nombre, tutor_id, estado, fecha_comprometida)
     VALUES ($1, $2, $3, $4, CURRENT_DATE + 10) RETURNING id`, [g.campus, `${nombre} ${MARCA}`, tutor, estado]);
  [{ id: g.pendiente }] = await pendiente(g.t1, 'Máster suyo', 'en_desarrollo');
  await pendiente(g.t1, 'Curso cerrado', 'cerrado');
  await pendiente(g.t2, 'Curso de la otra', 'asignado');
}, 60000);

afterAll(async () => {
  for (const [sql, p] of [
    ['DELETE FROM cursos_pendientes WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM consultas WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM tutor_campus WHERE tutor_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM activity_log WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]],
  ]) {
    try { await q(sql, p); } catch { /* sigue limpiando */ }
  }
  await pool.end();
}, 60000);

const app = express();
app.use(express.json());
app.use('/api/tutores', tutorRoutes);
app.use(errorHandler);
const como = (userId, role) => ({ Authorization: `Bearer ${jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: '5m' })}` });
const get = (url, userId, role = 'tutor') => supertest(app).get(url).set(como(userId, role));

describe('#408 · GET /api/tutores/mi-campus', () => {
  it('sin sesión, 401; una gestora sin el permiso de sus cursos, 403', async () => {
    expect((await supertest(app).get('/api/tutores/mi-campus')).status).toBe(401);
    expect((await get('/api/tutores/mi-campus', g.gestora, 'gestor')).status).toBe(403);
  });

  it('la tutora ve su campus: solo los cursos donde es profesora, con alumnos, % hecho y último acceso', async () => {
    const r = await get('/api/tutores/mi-campus?refrescar=1', g.t1);
    expect(r.status).toBe(200);
    const [c] = r.body.data.campus;
    expect(r.body.data.campus).toHaveLength(1);
    expect(c.projectId).toBe(g.campus);
    expect(c.cursos.map((k) => k.id)).toEqual([50]);
    const [curso] = c.cursos;
    expect(curso.url).toBe('https://campus408.test/course/view.php?id=50');
    const alumnos = Object.fromEntries(curso.alumnos.map((a) => [a.nombre, a]));
    expect(Object.keys(alumnos)).toEqual(['Ana Prueba', 'Beto Prueba']);
    expect(alumnos['Ana Prueba'].progreso).toBe(63);
    expect(alumnos['Ana Prueba'].ultimoAcceso).toBeTruthy();
    // Sin dato de Moodle es «—» (null), no 0 %; y quien nunca entró, sin fecha.
    expect(alumnos['Beto Prueba'].progreso).toBeNull();
    expect(alumnos['Beto Prueba'].ultimoAcceso).toBeNull();
  });

  it('las entregas sin corregir, con el enlace al calificador de Moodle de cada una', async () => {
    const r = await get('/api/tutores/mi-campus', g.t1);
    const [tarea] = r.body.data.campus[0].cursos[0].tareas;
    expect(tarea.nombre).toBe('Tarea final');
    expect(tarea.corregirUrl).toBe('https://campus408.test/mod/assign/view.php?id=17&action=grading');
    expect(tarea.sinCorregir).toHaveLength(1);
    expect(tarea.sinCorregir[0]).toMatchObject({
      alumnoId: 910, alumno: 'Ana Prueba',
      corregirUrl: 'https://campus408.test/mod/assign/view.php?id=17&action=grader&userid=910',
    });
  });

  it('sus dudas abiertas en su curso; las de alumnos de fuera, aparte; ni respondidas ni de otra tutora', async () => {
    const r = await get('/api/tutores/mi-campus', g.t1);
    const [c] = r.body.data.campus;
    expect(c.cursos[0].dudas.map((d) => d.consultaId)).toEqual([g.dudaAna]);
    expect(c.dudasSinCurso.map((d) => d.consultaId)).toEqual([g.dudaFuera]);
  });

  it('lo que tiene por desarrollar, sin lo cerrado ni lo de otra tutora', async () => {
    const r = await get('/api/tutores/mi-campus', g.t1);
    expect(r.body.data.pendientes.map((p) => p.id)).toEqual([g.pendiente]);
    expect(r.body.data.pendientes[0]).toMatchObject({ estado: 'en_desarrollo', avance: { foto: false, video: false, modulos: 0 } });
    expect(r.body.data.pendientes[0].fechaComprometida).toBeTruthy();
  });

  it('el campus asignado sin su cuenta de Moodle sale aparte, con el motivo', async () => {
    const r = await get('/api/tutores/mi-campus', g.t1);
    expect(r.body.data.sinConectar.map((s) => s.projectId)).toEqual([g.otro]);
    expect(r.body.data.sinConectar[0].motivo).toMatch(/Moodle/);
  });

  it('solo lo suyo: un ?tutorId= de otra tutora no cambia nada', async () => {
    const r = await get(`/api/tutores/mi-campus?refrescar=1&tutorId=${g.t1}`, g.t2);
    expect(r.status).toBe(200);
    const [c] = r.body.data.campus;
    // La 802 no es profesora en ningún curso del Moodle de mentira: ni cursos ni dudas de la 1.
    expect(c.cursos).toEqual([]);
    expect(c.dudasSinCurso.map((d) => d.consultaId)).not.toContain(g.dudaAna);
    expect(r.body.data.pendientes.map((p) => p.id)).not.toContain(g.pendiente);
    expect(r.body.data.sinConectar).toEqual([]);
  });
});
