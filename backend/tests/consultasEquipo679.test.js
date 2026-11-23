import {
  describe, it, expect, beforeAll, afterAll, afterEach, vi,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';
import * as servicio from '../src/modules/consultas/consultas.service.js';
import { contextoDeLaConsulta } from '../src/modules/consultas/consultas.contexto.js';
import consultasModule from '../src/modules/consultas/index.js';

/**
 * Lo que ayuda al equipo a organizarse en Consultas (#679), contra la base de verdad y
 * con un Moodle de mentira que contesta como uno de verdad:
 *
 *   · notas internas: solo el equipo, nunca salen al campus;
 *   · respuestas guardadas: las personales son de cada una; las del campus, de coordinación;
 *   · la ficha del alumno junto al chat: sus cursos, sus entregas sin corregir (con el
 *     enlace para corregirlas EN MOODLE) y sus otras consultas.
 *
 *   npx vitest run tests/consultasEquipo679.test.js
 */

const marca = `t679e${Date.now()}`;
const ids = { users: [], projects: [] };
let hayBase = true;
let porQueNo = null;
let alumnoN = 70000;
let conversacionN = 80000;
let mensajeN = 9000000;

// ─── El Moodle de mentira ────────────────────────────────────────────────────

/** Lo que cada campus de mentira sabe, por su dirección. */
const campusFalsos = new Map();
const envios = [];
const llamadas = [];

function campusFalso(url) {
  const c = {
    url,
    // curso → [{ id, rol, ultimoAcceso? }]
    cursos: new Map(),
    // curso → [{ id, cmid, nombre, nota }]
    tareas: new Map(),
    // tarea → [{ alumno, estado, corregida, at }]
    entregas: new Map(),
    // tarea → [{ alumno, nota, at }]
    notas: new Map(),
    caido: false,
  };
  campusFalsos.set(url, c);
  return c;
}

const json = (d) => ({ ok: true, status: 200, json: async () => d });
const segundos = (d) => Math.floor(d.getTime() / 1000);
const listaDe = (p, nombre) => [...p.entries()].filter(([k]) => k.startsWith(`${nombre}[`)).map(([, v]) => Number(v));

vi.stubGlobal('fetch', vi.fn(async (url, { body } = {}) => {
  const base = String(url).replace(/\/webservice\/rest\/server\.php$/, '');
  const c = campusFalsos.get(base);
  if (!c) return json([]);
  if (c.caido) throw new TypeError('fetch failed');
  const p = new URLSearchParams(body);
  const f = p.get('wsfunction');
  llamadas.push(f);
  if (f === 'core_enrol_get_users_courses') {
    const uid = Number(p.get('userid'));
    return json([...c.cursos.entries()]
      .filter(([, gente]) => gente.some((g) => g.id === uid))
      .map(([id, gente]) => {
        const yo = gente.find((g) => g.id === uid);
        return { id, fullname: `Curso ${id}`, lastaccess: yo.ultimoAcceso ? segundos(yo.ultimoAcceso) : 0 };
      }));
  }
  if (f === 'core_enrol_get_enrolled_users') {
    // El reparto por curso (#724, parte 2) pregunta quién es profesora del curso: sin esto,
    // la consulta del curso 41 se quedaba sin tutora y Laura no la veía.
    return json((c.cursos.get(Number(p.get('courseid'))) || [])
      .map((g) => ({ id: g.id, fullname: `Usuario ${g.id}`, roles: [{ shortname: g.rol }] })));
  }
  if (f === 'mod_assign_get_assignments') {
    return json({
      courses: listaDe(p, 'courseids').map((id) => ({
        id,
        assignments: (c.tareas.get(id) || []).map((t) => ({ id: t.id, cmid: t.cmid, name: t.nombre, grade: t.nota ?? 10, duedate: 0 })),
      })),
      warnings: [],
    });
  }
  if (f === 'mod_assign_get_submissions') {
    return json({
      assignments: listaDe(p, 'assignmentids').map((id) => ({
        assignmentid: id,
        submissions: (c.entregas.get(id) || []).map((e) => ({
          userid: e.alumno, status: e.estado || 'submitted', gradingstatus: e.corregida ? 'graded' : 'notgraded',
          timemodified: segundos(e.at),
        })),
      })),
    });
  }
  if (f === 'mod_assign_get_grades') {
    return json({
      assignments: listaDe(p, 'assignmentids').map((id) => ({
        assignmentid: id,
        grades: (c.notas.get(id) || []).map((n) => ({ userid: n.alumno, grade: String(n.nota), timemodified: segundos(n.at) })),
      })),
    });
  }
  if (f === 'core_message_send_instant_messages') {
    envios.push({ base, para: Number(p.get('messages[0][touserid]')), texto: p.get('messages[0][text]') });
    return json([{ msgid: 1, conversationid: 1 }]);
  }
  return json([]);
}));

// ─── Datos ───────────────────────────────────────────────────────────────────

async function crearUsuario(role) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${role} ${ids.users.length} ${marca}`, `${role}.${ids.users.length}.${marca}@test.local`, role]);
  ids.users.push(rows[0].id);
  return Number(rows[0].id);
}

/** Un campus conectado a su Moodle de mentira, con «Leer las consultas» encendido. */
async function crearCampus(nombre) {
  const n = ids.projects.length;
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre.toLowerCase()}-${marca}-${n}`, `k-${marca}-${n}`]);
  const p = Number(rows[0].id);
  ids.projects.push(p);
  const url = `https://${marca}-${n}.campus.test`;
  const enc = encrypt('token-del-campus');
  await query(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
    [p, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url, consultas: true, consultas_desde: '2026-01-01T00:00:00Z' })]);
  return { id: p, moodle: campusFalso(url) };
}

/** Una tutora del campus, con su cuenta de Moodle vinculada. */
async function tutora(projectId, moodleId) {
  const t = await crearUsuario('tutor');
  await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [t, projectId]);
  await query(`INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'activa', $3)`,
    [t, projectId, moodleId]);
  return t;
}

/** Lo que manda el alumno desde «Entrar al chat» de un curso. */
const delAlumno = (projectId, cursoId, extra = {}) => {
  alumnoN += 1;
  conversacionN += 1;
  return {
    projectId, conversacionId: conversacionN, alumno: { moodleId: alumnoN, nombre: `Alumno ${alumnoN}` },
    curso: cursoId ? { moodleId: cursoId, nombre: null } : null,
    texto: 'No me abre la tarea 2', externoId: (mensajeN += 1), escritoAt: new Date(), ...extra,
  };
};

beforeAll(async () => {
  try {
    const t = await query(`SELECT to_regclass('public.consultas') AS a, to_regclass('public.moodle_plugin_campus') AS b,
                                  to_regclass('public.consulta_notas') AS c, to_regclass('public.respuestas_guardadas') AS d`);
    if (!t.rows[0].a || !t.rows[0].b || !t.rows[0].c || !t.rows[0].d) throw new Error('Faltan las migraciones 245 y 247.');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterEach(() => { envios.length = 0; llamadas.length = 0; });

afterAll(async () => {
  for (const [sql, p] of [
    ['DELETE FROM respuestas_guardadas WHERE creado_por = ANY($1::int[]) OR project_id = ANY($2::int[])', [ids.users, ids.projects]],
    ['DELETE FROM consultas WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM tutor_campus WHERE tutor_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM project_integrations WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM activity_log WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
  vi.unstubAllGlobals();
});

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

// ─── Notas internas y respuestas guardadas (API) ─────────────────────────────

const app = express();
app.use(express.json());
app.use(consultasModule.prefix, consultasModule.router);
app.use(errorHandler);
const como = (user) => {
  const token = jwt.sign(user, process.env.JWT_SECRET);
  const con = (r) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (u) => con(supertest(app).get(u)),
    post: (u, b) => con(supertest(app).post(u).send(b)),
    put: (u, b) => con(supertest(app).put(u).send(b)),
    del: (u) => con(supertest(app).delete(u)),
  };
};

describe('#679 · notas internas', () => {
  it('la tutora de la consulta anota; la nota sale en la ficha, con su autora, y NO va al campus', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('Notas');
    const laura = await tutora(campus.id, 601);
    const r = await servicio.entraMensajeDelAlumno(delAlumno(campus.id, null), { tutorPreferido: laura, avisar: false });
    const yo = como({ userId: laura, role: 'tutor' });
    const res = await yo.post(`/api/consultas/${r.consulta.id}/notas`, { texto: '  Le pasé el enlace del tema 2; si vuelve, revisar la entrega.  ' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ texto: 'Le pasé el enlace del tema 2; si vuelve, revisar la entrega.', autor_user_id: laura });
    expect(envios).toHaveLength(0);
    const ficha = await yo.get(`/api/consultas/${r.consulta.id}`);
    expect(ficha.status).toBe(200);
    expect(ficha.body.data.notas.map((n) => n.texto)).toContain('Le pasé el enlace del tema 2; si vuelve, revisar la entrega.');
  });

  it('vacía o de más de 4000 caracteres, no se guarda', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('NotasMal');
    const laura = await tutora(campus.id, 611);
    const r = await servicio.entraMensajeDelAlumno(delAlumno(campus.id, null), { tutorPreferido: laura, avisar: false });
    const yo = como({ userId: laura, role: 'tutor' });
    expect((await yo.post(`/api/consultas/${r.consulta.id}/notas`, { texto: '   ' })).status).toBe(400);
    expect((await yo.post(`/api/consultas/${r.consulta.id}/notas`, { texto: 'x'.repeat(4001) })).status).toBe(400);
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM consulta_notas WHERE consulta_id = $1', [r.consulta.id]);
    expect(rows[0].n).toBe(0);
  });

  it('una tutora que no lleva la consulta no puede anotar (ni saber que existe)', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('NotasAjena');
    const laura = await tutora(campus.id, 621);
    const otra = await tutora(campus.id, 622);
    const r = await servicio.entraMensajeDelAlumno(delAlumno(campus.id, null), { tutorPreferido: laura, avisar: false });
    const res = await como({ userId: otra, role: 'tutor' }).post(`/api/consultas/${r.consulta.id}/notas`, { texto: 'hola' });
    expect(res.status).toBe(404);
  });

  it('un id que no es un número es 404, no un 500 de Postgres', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('NotasId');
    const laura = await tutora(campus.id, 631);
    const yo = como({ userId: laura, role: 'tutor' });
    expect((await yo.post('/api/consultas/abc/notas', { texto: 'hola' })).status).toBe(404);
    expect((await yo.get('/api/consultas/abc/contexto')).status).toBe(404);
  });
});

describe('#679 · respuestas guardadas', () => {
  it('las personales son de cada tutora: otra no las ve, ni las cambia, ni las borra', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('Resp');
    const laura = await tutora(campus.id, 701);
    const carmen = await tutora(campus.id, 702);
    const yo = como({ userId: laura, role: 'tutor' });
    const ella = como({ userId: carmen, role: 'tutor' });
    const creada = await yo.post('/api/consultas/respuestas', { titulo: 'Plazo de entrega', texto: 'El plazo es el domingo a las 23:59.' });
    expect(creada.status).toBe(200);
    const mia = creada.body.data.find((x) => x.titulo === 'Plazo de entrega');
    expect(mia).toMatchObject({ personal: true });
    expect((await ella.get('/api/consultas/respuestas')).body.data.some((x) => x.id === mia.id)).toBe(false);
    expect((await ella.put(`/api/consultas/respuestas/${mia.id}`, { titulo: 'X', texto: 'Y' })).status).toBe(404);
    expect((await ella.del(`/api/consultas/respuestas/${mia.id}`)).status).toBe(404);
    const cambiada = await yo.put(`/api/consultas/respuestas/${mia.id}`, { titulo: 'Plazo', texto: 'Domingo, 23:59.' });
    expect(cambiada.body.data.find((x) => x.id === mia.id)).toMatchObject({ titulo: 'Plazo', texto: 'Domingo, 23:59.' });
    expect((await yo.del(`/api/consultas/respuestas/${mia.id}`)).status).toBe(200);
  });

  it('las del campus: una tutora no puede crearlas; coordinación sí, y las ven las tutoras de ese campus (no las de otro)', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('RespCampus');
    const otroCampus = await crearCampus('RespOtro');
    const laura = await tutora(campus.id, 711);
    const deOtro = await tutora(otroCampus.id, 712);
    const coordina = await crearUsuario('superadmin');
    const res = await como({ userId: laura, role: 'tutor' }).post('/api/consultas/respuestas', { titulo: 'Bienvenida', texto: 'Hola', projectId: campus.id });
    expect(res.status).toBe(403);
    const ok = await como({ userId: coordina, role: 'superadmin' }).post('/api/consultas/respuestas', { titulo: 'Bienvenida del campus', texto: 'Bienvenida al curso.', projectId: campus.id });
    expect(ok.status).toBe(200);
    const laVe = (await como({ userId: laura, role: 'tutor' }).get('/api/consultas/respuestas')).body.data;
    expect(laVe.find((x) => x.titulo === 'Bienvenida del campus')).toMatchObject({ personal: false, project_id: campus.id });
    const noLaVe = (await como({ userId: deOtro, role: 'tutor' }).get('/api/consultas/respuestas')).body.data;
    expect(noLaVe.some((x) => x.titulo === 'Bienvenida del campus')).toBe(false);
    // Y la tutora tampoco la puede tocar.
    const r = laVe.find((x) => x.titulo === 'Bienvenida del campus');
    expect((await como({ userId: laura, role: 'tutor' }).del(`/api/consultas/respuestas/${r.id}`)).status).toBe(403);
  });

  it('las que tenía en el navegador pasan a su cuenta sin duplicar por título (y las vacías se saltan)', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('Importar');
    const laura = await tutora(campus.id, 721);
    const yo = como({ userId: laura, role: 'tutor' });
    await yo.post('/api/consultas/respuestas', { titulo: 'Saludo', texto: 'Hola, ¿en qué te ayudo?' });
    const r = await yo.post('/api/consultas/respuestas/importar', { respuestas: [
      { titulo: 'saludo', texto: 'repetida por título' },
      { titulo: 'Despedida', texto: 'Un saludo.' },
      { titulo: '', texto: 'sin título' },
    ] });
    expect(r.status).toBe(200);
    expect(r.body.data.importadas).toBe(1);
    expect(r.body.data.respuestas.filter((x) => x.personal).map((x) => x.titulo).sort()).toEqual(['Despedida', 'Saludo']);
  });

  it('un id de respuesta que no es un número es 404, no un 500 de Postgres', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('RespId');
    const laura = await tutora(campus.id, 731);
    const yo = como({ userId: laura, role: 'tutor' });
    expect((await yo.put('/api/consultas/respuestas/abc', { titulo: 'X', texto: 'Y' })).status).toBe(404);
    expect((await yo.del('/api/consultas/respuestas/abc')).status).toBe(404);
  });
});

// ─── La ficha del alumno junto al chat ───────────────────────────────────────

describe('#679 · la ficha del alumno (contextoDeLaConsulta)', () => {
  /*
    El alumno está en el curso 41 (con Laura). En ese curso hay tres tareas:
      · 501, entregada y sin corregir                → sale;
      · 502, entregada y ya corregida                → no sale;
      · 503, corregida y vuelta a entregar después   → sale otra vez.
    Otro alumno tiene 501 entregada: no es de esta ficha.
  */
  async function escenario() {
    const campus = await crearCampus('Ficha');
    const laura = await tutora(campus.id, 1001);
    const primera = delAlumno(campus.id, 41);
    const alumno = primera.alumno.moodleId;
    const hace = (dias) => new Date(Date.now() - dias * 86_400_000);
    campus.moodle.cursos.set(41, [{ id: 1001, rol: 'editingteacher' }, { id: alumno, rol: 'student', ultimoAcceso: hace(2) }, { id: 4242, rol: 'student' }]);
    campus.moodle.cursos.set(42, [{ id: 1001, rol: 'editingteacher' }]);
    campus.moodle.tareas.set(41, [
      { id: 501, cmid: 9001, nombre: 'Tarea 1' },
      { id: 502, cmid: 9002, nombre: 'Tarea 2' },
      { id: 503, cmid: 9003, nombre: 'Tarea 3' },
    ]);
    campus.moodle.entregas.set(501, [{ alumno, at: hace(3) }, { alumno: 4242, at: hace(3) }]);
    campus.moodle.entregas.set(502, [{ alumno, at: hace(5), corregida: true }]);
    campus.moodle.notas.set(502, [{ alumno, nota: 8, at: hace(4) }]);
    campus.moodle.entregas.set(503, [{ alumno, at: hace(1), corregida: true }]);
    campus.moodle.notas.set(503, [{ alumno, nota: 4, at: hace(6) }]);

    // Una consulta anterior del mismo alumno, ya cerrada, y la de ahora.
    const antes = await servicio.entraMensajeDelAlumno(primera, { tutorPreferido: laura, avisar: false });
    await query(`UPDATE consultas SET estado = 'cerrada', cerrada_at = NOW() WHERE id = $1`, [antes.consulta.id]);
    const ahora = await servicio.entraMensajeDelAlumno(
      { ...primera, conversacionId: (conversacionN += 1), externoId: (mensajeN += 1), texto: '¿Me corriges la tarea 1?' },
      { tutorPreferido: laura, avisar: false });
    expect(ahora.consulta.id).not.toBe(antes.consulta.id);
    return { campus, laura, alumno, antes: antes.consulta, consulta: ahora.consulta };
  }

  it('sus cursos, sus entregas sin corregir con el enlace de Moodle para corregirlas, y sus otras consultas', async () => {
    if (!hayBase) return;
    const { campus, laura, alumno, antes, consulta } = await escenario();
    const url = campus.moodle.url;
    const ficha = await contextoDeLaConsulta(consulta, { quien: 'tutor', userId: laura, refrescar: true });

    expect(ficha.error).toBeNull();
    expect(ficha.campusUrl).toBe(url);
    expect(ficha.perfilUrl).toBe(`${url}/user/profile.php?id=${alumno}`);
    // El curso, con cuándo entró por última vez.
    expect(ficha.cursos).toHaveLength(1);
    expect(ficha.cursos[0]).toMatchObject({ id: 41, nombre: 'Curso 41', url: `${url}/course/view.php?id=41` });
    expect(ficha.cursos[0].ultimoAcceso).toBeInstanceOf(Date);
    // Las tareas sin corregir: la 501 y la 503 (vuelta a entregar), no la 502; y solo las suyas.
    expect(ficha.entregas.map((e) => e.tareaId).sort()).toEqual([501, 503]);
    const t1 = ficha.entregas.find((e) => e.tareaId === 501);
    expect(t1).toMatchObject({ tarea: 'Tarea 1', curso: 'Curso 41', cursoId: 41 });
    // Se corrige en Moodle: el enlace es el del calificador del campus, para ese alumno.
    expect(t1.corregirUrl).toBe(`${url}/mod/assign/view.php?id=9001&action=grader&userid=${alumno}`);
    for (const e of ficha.entregas) expect(e.corregirUrl.startsWith(`${url}/mod/assign/view.php?`)).toBe(true);
    // La consulta anterior del mismo alumno.
    expect(ficha.anteriores.map((a) => a.id)).toEqual([Number(antes.id)]);
    expect(ficha.anteriores[0].estado).toBe('cerrada');
    // Solo lee: nada de calificar.
    expect(llamadas.some((f) => /calificar|save_grade/.test(f))).toBe(false);
  });

  it('por la API: su tutora la ve; otra tutora del campus, «no encontrada»', async () => {
    if (!hayBase) return;
    const { campus, laura, consulta } = await escenario();
    const otra = await tutora(campus.id, 1002);
    const res = await como({ userId: laura, role: 'tutor' }).get(`/api/consultas/${consulta.id}/contexto`);
    expect(res.status).toBe(200);
    expect(res.body.data.entregas.map((e) => e.tareaId).sort()).toEqual([501, 503]);
    expect((await como({ userId: otra, role: 'tutor' }).get(`/api/consultas/${consulta.id}/contexto`)).status).toBe(404);
  });

  it('con el campus caído lo dice, y las consultas anteriores salen igual', async () => {
    if (!hayBase) return;
    const { campus, laura, antes, consulta } = await escenario();
    campus.moodle.caido = true;
    const ficha = await contextoDeLaConsulta(consulta, { quien: 'tutor', userId: laura, refrescar: true });
    expect(ficha.error).toMatch(/campus/);
    expect(ficha.cursos).toEqual([]);
    expect(ficha.entregas).toEqual([]);
    expect(ficha.anteriores.map((a) => a.id)).toEqual([Number(antes.id)]);
  });
});
