import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool from '../src/shared/config/db.js';
import { findResumenDelDia } from '../src/modules/tasks/tasks.resumen.model.js';
import { cerrarLasEnRevision } from '../src/modules/tasks/tasks.cierre-en-revision.js';

/**
 * CRM-ISEIE#419 (gemela CRM-ISEIE#419) · la regla del último comentario (Diego y
 * Carlos, 10/11/2026), contra la base de verdad:
 *
 *   A · quien hace la tarea la pasa a «Hecha» él mismo, y queda quién y cuándo;
 *       quien no la lleva ni la supervisa, no.
 *   B · quien la creó, el supervisor o un admin la devuelven a «En curso» con un
 *       comentario; quien no, no.
 *   C · programación: el programador la manda a revisar y la cierra su
 *       supervisor (Diego). Ni el programador ni un admin la cierran.
 *   D · «Historial de tareas»: lo cerrado, con quién lo hizo, quién lo cerró y
 *       cuándo; por persona, equipo y periodo; cada uno, lo de su alcance.
 *   E · Carlos (superadmin) no tiene bandeja ni contador de «por aprobar».
 *   F · la migración de datos: las que estaban «En revisión» se cierran con la
 *       fecha de su último movimiento; se puede simular y pasar dos veces.
 *
 *   npm --prefix backend run db:preparar
 *   cd backend && npx vitest run tests/tareasHistorial419.test.js
 */

const request = supertest(app);
const MARCA = `T419_${Date.now().toString(36)}`;

const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];

const U = {};
const T = {};
const E = {};
const P = {};
const EQ = {};
const ids = { issuers: [], projects: [], teams: [] };

async function persona(clave, role, { campus = [], empresas = [] } = {}) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, email, role`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}_${MARCA.toLowerCase()}@test.local`, role]
  );
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, P[c]]);
  for (const e of empresas) await q('INSERT INTO user_empresas (user_id, issuer_id) VALUES ($1, $2)', [u.id, E[e]]);
  U[clave] = u;
  T[clave] = jwt.sign({ userId: u.id, email: u.email, role, roles_extra: [], customRoleId: null },
    process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function equipo(clave, empresa, { programacion = false, miembros = [] } = {}) {
  const t = await one(
    'INSERT INTO task_teams (issuer_id, name, de_programacion) VALUES ($1, $2, $3) RETURNING id',
    [E[empresa], `${MARCA} ${clave}`, programacion]
  );
  ids.teams.push(t.id);
  EQ[clave] = t.id;
  const enc = await one(`INSERT INTO task_team_roles (team_id, name, level) VALUES ($1, 'Encargado', 2) RETURNING id`, [t.id]);
  const mie = await one(`INSERT INTO task_team_roles (team_id, name, level) VALUES ($1, 'Miembro', 1) RETURNING id`, [t.id]);
  for (const [quien, cargo] of miembros) {
    await q('INSERT INTO task_team_members (team_id, user_id, team_role_id) VALUES ($1, $2, $3)',
      [t.id, U[quien].id, cargo === 'encargado' ? enc.id : mie.id]);
  }
}

const como = (clave) => ({ Authorization: `Bearer ${T[clave]}` });
const mover = (quien, id, status) => request.patch(`/api/tasks/${id}/move`).set(como(quien)).send({ status });
const devolver = (quien, id, comment = 'No está bien') => request.patch(`/api/tasks/${id}/return`).set(como(quien)).send({ comment });
const historial = (quien, query = '') => request.get(`/api/tasks/historial${query}`).set(como(quien));

async function crear(quien, body) {
  const res = await request.post('/api/tasks').set(como(quien)).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  for (const clave of ['UNO', 'OTRA']) {
    const s = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} ${clave}`, `${MARCA}-${clave}`]);
    ids.issuers.push(s.id);
    E[clave] = s.id;
  }
  for (const [c, s] of [['A', 'UNO'], ['Z', 'OTRA']]) {
    const p = await one(
      'INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c.toLowerCase()}`, `${MARCA}-${c}`, E[s]]
    );
    ids.projects.push(p.id);
    P[c] = p.id;
  }
  await persona('carlos', 'superadmin');
  await persona('admin', 'admin', { campus: ['A'] });
  await persona('admin2', 'admin', { campus: ['A'] });
  // Diego supervisa a los programadores: aquí, un colaborador encargado del equipo,
  // para que se vea que lo decide ser su supervisor, no su rol.
  await persona('diego', 'colaborador', { empresas: ['UNO'] });
  await persona('dev1', 'colaborador', { empresas: ['UNO'] });
  await persona('dev2', 'colaborador', { empresas: ['UNO'] });
  await persona('seo1', 'colaborador', { empresas: ['UNO'] });
  await persona('seo2', 'colaborador', { empresas: ['UNO'] });
  await persona('ajeno', 'colaborador', { empresas: ['OTRA'] });

  await equipo('Desarrollo', 'UNO', { programacion: true, miembros: [['diego', 'encargado'], ['dev1'], ['dev2']] });
  await equipo('SEO', 'UNO', { miembros: [['seo1'], ['seo2']] });
}, 60000);

afterAll(async () => {
  const usuarios = Object.values(U).map((u) => u.id);
  await q('DELETE FROM tasks WHERE created_by = ANY($1::int[]) OR assigned_to = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM task_teams WHERE id = ANY($1::int[])', [ids.teams]);
  await q('DELETE FROM admin_notifications WHERE target_user_ids && $1::int[]', [usuarios]);
  await q('DELETE FROM user_empresas WHERE user_id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

describe('A · quien la hace la pasa a «Hecha»', () => {
  let t;
  beforeAll(async () => {
    t = await crear('admin', { title: `${MARCA} Textos de la home`, assigned_to: U.seo1.id });
  });

  it('el responsable la cierra sin pasar por «En revisión», y queda quién y cuándo', async () => {
    const antes = Date.now();
    const res = await mover('seo1', t.id, 'hecha');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe('hecha');
    expect(res.body.data.completed_by).toBe(U.seo1.id);
    expect(new Date(res.body.data.completed_at).getTime()).toBeGreaterThanOrEqual(antes - 2000);
    const ev = await one(
      `SELECT user_id, details FROM task_events WHERE task_id = $1 AND event_type = 'status_changed' ORDER BY id DESC LIMIT 1`, [t.id]);
    expect(ev.user_id).toBe(U.seo1.id);
    expect(ev.details).toMatchObject({ old_status: 'por_hacer', new_status: 'hecha' });
    // A quien la creó le llega a la campana, para devolverla si no está bien.
    const aviso = await one(
      `SELECT title FROM admin_notifications WHERE $1 = ANY(target_user_ids) AND type = 'task_estado_cambiado' AND metadata->>'task_id' = $2`,
      [U.admin.id, String(t.id)]);
    expect(aviso?.title).toMatch(/^Tarea cerrada/);
  });

  it('la ficha y el tablero le dicen al responsable que puede cerrarla', async () => {
    const otra = await crear('admin', { title: `${MARCA} Metadescripciones`, assigned_to: U.seo1.id });
    const ficha = await request.get(`/api/tasks/${otra.id}`).set(como('seo1'));
    expect(ficha.body.data.permisos).toMatchObject({ cerrar: true, mover: true });
    const tablero = await request.get('/api/tasks?ver=mias').set(como('seo1'));
    expect(tablero.body.data.find((x) => x.id === otra.id)?.puede_cerrar).toBe(true);
    // Su compañero de equipo la ve, pero no la cierra.
    const delCompa = await request.get(`/api/tasks/${otra.id}`).set(como('seo2'));
    expect(delCompa.status).toBe(200);
    expect(delCompa.body.data.permisos).toMatchObject({ cerrar: false, devolver: false });
  });

  it('quien no es responsable, ni la creó, ni la supervisa, ni es admin, no la cierra', async () => {
    const otra = await crear('admin', { title: `${MARCA} Enlazado interno`, assigned_to: U.seo1.id });
    expect((await mover('seo2', otra.id, 'hecha')).status).toBe(403);
    expect((await request.patch(`/api/tasks/${otra.id}/approve`).set(como('seo2'))).status).toBe(403);
    expect([403, 404]).toContain((await mover('ajeno', otra.id, 'hecha')).status);
    expect((await one('SELECT status FROM tasks WHERE id = $1', [otra.id])).status).toBe('por_hacer');
  });
});

describe('B · devolver a «En curso» con un comentario', () => {
  let t;
  beforeAll(async () => {
    t = await crear('admin', { title: `${MARCA} Ficha del máster`, assigned_to: U.seo1.id });
    expect((await mover('seo1', t.id, 'hecha')).status).toBe(200);
  });

  it('su compañero (ni la creó ni la supervisa ni es admin) no la devuelve', async () => {
    expect((await devolver('seo2', t.id)).status).toBe(403);
    expect((await devolver('seo1', t.id)).status).toBe(403);
  });

  it('quien la creó la devuelve: vuelve a «En curso» con el comentario y se le avisa a quien la lleva', async () => {
    const res = await devolver('admin', t.id, 'Falta el temario del módulo 3');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe('en_curso');
    expect(res.body.data.completed_at).toBeNull();
    const c = await one('SELECT user_id, content FROM task_comments WHERE task_id = $1 ORDER BY id DESC LIMIT 1', [t.id]);
    expect(c).toEqual({ user_id: U.admin.id, content: 'Falta el temario del módulo 3' });
    const aviso = await one(
      `SELECT message FROM admin_notifications WHERE $1 = ANY(target_user_ids) AND type = 'task_devuelta' AND metadata->>'task_id' = $2`,
      [U.seo1.id, String(t.id)]);
    expect(aviso?.message).toBe('Falta el temario del módulo 3');
  });

  it('un admin que no la creó también la devuelve (tiene «Devolver tareas»)', async () => {
    expect((await mover('seo1', t.id, 'hecha')).status).toBe(200);
    const res = await devolver('admin2', t.id, 'Revisa las faltas');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe('en_curso');
  });

  it('lo que no está «Hecha» ni «En revisión» no se devuelve: 409', async () => {
    expect((await devolver('admin', t.id)).status).toBe(409);
  });
});

describe('C · programación: la cierra Diego, su supervisor', () => {
  let t;
  beforeAll(async () => {
    t = await crear('admin', { title: `${MARCA} Endpoint de facturas`, assigned_to: U.dev1.id, supervisor_id: U.diego.id });
    expect(t.team_id).toBe(EQ.Desarrollo);
    expect(t.de_programacion).toBe(true);
  });

  it('el programador no la pasa a «Hecha» (ni al crearla), ni la aprueba: la manda a revisar', async () => {
    const res = await mover('dev1', t.id, 'hecha');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/programación/);
    const ficha = await request.get(`/api/tasks/${t.id}`).set(como('dev1'));
    expect(ficha.body.data.permisos).toMatchObject({ cerrar: false, mover: true });
    expect((await request.post('/api/tasks').set(como('dev1')).send({ title: `${MARCA} Ya hecha`, status: 'hecha' })).status).toBe(403);
    expect((await mover('dev1', t.id, 'en_revision')).status).toBe(200);
    expect((await request.patch(`/api/tasks/${t.id}/approve`).set(como('dev1'))).status).toBe(403);
  });

  it('un admin con la clave no la cierra (no es su supervisor), aunque la haya creado', async () => {
    expect((await request.patch(`/api/tasks/${t.id}/approve`).set(como('admin'))).status).toBe(403);
    expect((await request.patch(`/api/tasks/${t.id}/approve`).set(como('admin2'))).status).toBe(403);
  });

  it('Diego, su supervisor, la cierra; y queda que la cerró él', async () => {
    const res = await request.patch(`/api/tasks/${t.id}/approve`).set(como('diego'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe('hecha');
    expect(res.body.data.completed_by).toBe(U.diego.id);
    // El programador no la reabre; Diego sí.
    expect((await mover('dev1', t.id, 'en_curso')).status).toBe(403);
  });
});

describe('D · Historial de tareas', () => {
  let deSeo;
  let deDev;
  beforeAll(async () => {
    deSeo = await crear('seo2', { title: `${MARCA} Historial SEO` });
    expect((await mover('seo2', deSeo.id, 'hecha')).status).toBe(200);
    deDev = await crear('admin', { title: `${MARCA} Historial Dev`, assigned_to: U.dev2.id, supervisor_id: U.diego.id });
    expect((await mover('dev2', deDev.id, 'en_revision')).status).toBe(200);
    expect((await mover('diego', deDev.id, 'hecha')).status).toBe(200);
  });

  it('lista lo cerrado, de lo último a lo primero, con quién lo hizo, quién lo cerró y cuándo', async () => {
    const res = await historial('admin', `?ver=todo&issuerId=${E.UNO}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.pagination).toMatchObject({ page: 1 });
    const filas = res.body.data.filter((x) => [deSeo.id, deDev.id].includes(x.id));
    expect(filas.map((x) => x.id)).toEqual([deDev.id, deSeo.id]);
    expect(filas[0]).toMatchObject({
      assigned_to: U.dev2.id, assigned_to_name: `${MARCA} dev2`,
      completed_by: U.diego.id, completed_by_name: `${MARCA} diego`,
      team_name: `${MARCA} Desarrollo`, de_programacion: true,
    });
    expect(filas[0].completed_at).toBeTruthy();
    expect(filas[1]).toMatchObject({ completed_by: U.seo2.id, team_name: `${MARCA} SEO` });
    // Solo lo hecho: lo que sigue abierto no sale.
    expect(res.body.data.every((x) => x.completed_at)).toBe(true);
  });

  it('se filtra por persona, por equipo y por periodo (el día del cierre)', async () => {
    const porPersona = await historial('admin', `?ver=todo&assigned_to=${U.dev2.id}`);
    expect(porPersona.body.data.map((x) => x.id)).toEqual([deDev.id]);
    const porEquipo = await historial('admin', `?ver=todo&team_id=${EQ.SEO}`);
    expect(porEquipo.body.data.map((x) => x.id)).toContain(deSeo.id);
    expect(porEquipo.body.data.map((x) => x.id)).not.toContain(deDev.id);
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid' }).format(new Date());
    const deHoy = await historial('admin', `?ver=todo&desde=${hoy}&hasta=${hoy}&team_id=${EQ.SEO}`);
    expect(deHoy.body.data.map((x) => x.id)).toContain(deSeo.id);
    const deAntes = await historial('admin', `?ver=todo&desde=2020-01-01&hasta=2020-01-31&team_id=${EQ.SEO}`);
    expect(deAntes.body.data).toEqual([]);
    expect((await historial('admin', '?desde=2026-02-01&hasta=2026-01-01')).status).toBe(400);
  });

  it('respeta el alcance: cada uno lo suyo y lo de su equipo; el admin, su empresa; de otra empresa, nada', async () => {
    // seo1, del equipo SEO: lo de seo2 (su equipo) sí; lo de Desarrollo, no.
    const seo1 = (await historial('seo1')).body.data.map((x) => x.id);
    expect(seo1).toContain(deSeo.id);
    expect(seo1).not.toContain(deDev.id);
    // «Mis tareas»: solo lo suyo.
    expect((await historial('seo1', '?ver=mias')).body.data.map((x) => x.id)).not.toContain(deSeo.id);
    // dev1, de Desarrollo: lo de su equipo; lo de SEO, no. «Todo» sin «Ver todo» no abre más.
    const dev1 = (await historial('dev1', '?ver=todo')).body.data.map((x) => x.id);
    expect(dev1).toContain(deDev.id);
    expect(dev1).not.toContain(deSeo.id);
    // De otra empresa, nada.
    const ajeno = (await historial('ajeno', '?ver=todo')).body.data.map((x) => x.id);
    expect(ajeno).not.toContain(deSeo.id);
    expect(ajeno).not.toContain(deDev.id);
  });

  it('pagina', async () => {
    const res = await historial('admin', `?ver=todo&issuerId=${E.UNO}&limit=1&page=2`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ page: 2, limit: 1 });
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(2);
  });
});

describe('E · Carlos no aprueba tareas', () => {
  it('no hay bandeja ni contador de «por aprobar» (las rutas de «Por revisar» ya no existen)', async () => {
    expect((await request.get('/api/tasks/review').set(como('carlos'))).status).not.toBe(200);
    expect((await request.get('/api/tasks/review/count').set(como('carlos'))).status).not.toBe(200);
  });

  it('aunque supervise una tarea que no es de programación y esté «En revisión», su resumen no le pide revisarla', async () => {
    const t = await crear('carlos', { title: `${MARCA} Supervisa Carlos`, assigned_to: U.seo2.id, supervisor_id: U.carlos.id });
    expect((await mover('seo2', t.id, 'en_revision')).status).toBe(200);
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());
    const datos = await findResumenDelDia(U.carlos.id, hoy, 'America/Caracas');
    expect(datos.falta.revisar.map((x) => x.id)).not.toContain(t.id);
    // Y a Diego, que supervisa programación, sí le sale lo suyo.
    const p = await crear('admin', { title: `${MARCA} Para Diego`, assigned_to: U.dev1.id, supervisor_id: U.diego.id });
    expect((await mover('dev1', p.id, 'en_revision')).status).toBe(200);
    const deDiego = await findResumenDelDia(U.diego.id, hoy, 'America/Caracas');
    expect(deDiego.falta.revisar.map((x) => x.id)).toContain(p.id);
  });
});

describe('F · migración de datos: las que estaban «En revisión» se cierran', () => {
  let conMovimiento;
  let sinEventos;
  let archivada;
  const movidaEl = new Date('2026-11-01T10:00:00.000Z');
  const tocadaEl = new Date('2026-10-20T08:30:00.000Z');

  beforeAll(async () => {
    conMovimiento = await one(
      `INSERT INTO tasks (title, status, assigned_to, created_by) VALUES ($1, 'en_revision', $2, $3) RETURNING id`,
      [`${MARCA} vieja con movimiento`, U.seo1.id, U.admin.id]);
    await q(`INSERT INTO task_events (task_id, user_id, event_type, details, created_at)
             VALUES ($1, $2, 'status_changed', '{"old_status":"en_curso","new_status":"en_revision"}', $3)`,
    [conMovimiento.id, U.seo1.id, movidaEl]);
    await q(`INSERT INTO task_events (task_id, user_id, event_type, details, created_at)
             VALUES ($1, $2, 'comment', '{}', $3)`, [conMovimiento.id, U.admin.id, new Date('2026-11-02T10:00:00.000Z')]);
    // Sin responsable ni eventos: la cierra quien la creó, con su última actualización.
    sinEventos = await one(
      `INSERT INTO tasks (title, status, assigned_to, created_by, updated_at) VALUES ($1, 'en_revision', NULL, $2, $3) RETURNING id`,
      [`${MARCA} vieja sin eventos`, U.admin.id, tocadaEl]);
    archivada = await one(
      `INSERT INTO tasks (title, status, assigned_to, created_by, archived_at) VALUES ($1, 'en_revision', $2, $2, NOW()) RETURNING id`,
      [`${MARCA} archivada`, U.seo1.id]);
  });

  const nuestras = () => [conMovimiento.id, sinEventos.id, archivada.id];

  it('simular: cuenta y no cambia nada', async () => {
    const db = await pool.connect();
    try {
      const r = await cerrarLasEnRevision(db, { soloTareas: nuestras() });
      expect(r.aplicado).toBe(false);
      expect(r.total).toBe(2);
      expect(r.tareas.map((x) => x.id)).toEqual([conMovimiento.id, sinEventos.id]);
    } finally { db.release(); }
    const estados = await q('SELECT status, completed_at FROM tasks WHERE id = ANY($1::int[])', [nuestras()]);
    expect(estados.every((x) => x.status === 'en_revision' && x.completed_at === null)).toBe(true);
    expect(await q(`SELECT 1 FROM task_events WHERE task_id = ANY($1::int[]) AND details->>'action' = 'cierre_419'`, [nuestras()])).toEqual([]);
  });

  it('aplicar: «Hecha» con la fecha de su último movimiento y su evento a nombre del responsable', async () => {
    const db = await pool.connect();
    try {
      const r = await cerrarLasEnRevision(db, { aplicar: true, soloTareas: nuestras() });
      expect(r).toMatchObject({ aplicado: true, total: 2 });
    } finally { db.release(); }
    const a = await one('SELECT status, completed_at FROM tasks WHERE id = $1', [conMovimiento.id]);
    expect(a.status).toBe('hecha');
    expect(new Date(a.completed_at).toISOString()).toBe(movidaEl.toISOString());
    const b = await one('SELECT status, completed_at FROM tasks WHERE id = $1', [sinEventos.id]);
    expect(b.status).toBe('hecha');
    expect(new Date(b.completed_at).toISOString()).toBe(tocadaEl.toISOString());
    expect((await one('SELECT status FROM tasks WHERE id = $1', [archivada.id])).status).toBe('en_revision');

    const ev = await one(`SELECT user_id, details, created_at FROM task_events
                           WHERE task_id = $1 AND event_type = 'status_changed' ORDER BY id DESC LIMIT 1`, [conMovimiento.id]);
    expect(ev.user_id).toBe(U.seo1.id);
    expect(ev.details).toMatchObject({ old_status: 'en_revision', new_status: 'hecha', action: 'cierre_419' });
    expect(new Date(ev.created_at).toISOString()).toBe(movidaEl.toISOString());
    // Y la ficha dice quién la cerró: el responsable; sin responsable, quien la creó.
    expect((await request.get(`/api/tasks/${conMovimiento.id}`).set(como('admin'))).body.data.completed_by).toBe(U.seo1.id);
    expect((await request.get(`/api/tasks/${sinEventos.id}`).set(como('admin'))).body.data.completed_by).toBe(U.admin.id);
    // Sin avisos: no es que alguien las cierre hoy.
    expect(await q(`SELECT 1 FROM admin_notifications WHERE metadata->>'task_id' = ANY($1::text[])`,
      [[String(conMovimiento.id), String(sinEventos.id)]])).toEqual([]);
  });

  it('pasarla dos veces no hace nada', async () => {
    const db = await pool.connect();
    try {
      const r = await cerrarLasEnRevision(db, { aplicar: true, soloTareas: nuestras() });
      expect(r.total).toBe(0);
    } finally { db.release(); }
    const eventos = await q(`SELECT 1 FROM task_events WHERE task_id = ANY($1::int[]) AND details->>'action' = 'cierre_419'`, [nuestras()]);
    expect(eventos).toHaveLength(2);
  });
});
