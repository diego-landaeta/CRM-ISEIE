import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Brevo simulado: mover una tarea a «Hecha» no manda nada de verdad.
vi.mock('../src/shared/services/brevo.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendEmail: vi.fn(async () => ({ sent: true, messageId: '<prueba>' })),
}));

const supertest = (await import('supertest')).default;
const jwt = (await import('jsonwebtoken')).default;
const app = (await import('../src/app.js')).default;
const pool = (await import('../src/shared/config/db.js')).default;

/**
 * Un solo tablero con filtros (Diego, 27/10/2026):
 *
 *   «Esto tiene que tener fecha de cuándo se creó y cuándo se terminó, y
 *   clasificarla en vistas por día, semana y mes, PERO QUE SEA UN SOLO TABLERO
 *   TODO Y YA CON FILTROS, NO MÚLTIPLES TABLEROS.»
 *
 *   · Ver: «Mis tareas» (lleva, supervisa o creó), «Mi equipo» (y lo de sus
 *     equipos) o «Todo» (lo que su permiso le deja). El filtro nunca abre más.
 *   · Periodo: entra lo que se creó, se terminó o vence dentro, y lo abierto
 *     creado antes de que acabe. Días de la oficina (Madrid).
 *   · completed_at se pone al pasar a «Hecha» y se quita al volver atrás.
 *
 *   cd backend && npx vitest run tests/tareasTableroUnico.test.js
 */

const request = supertest(app);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MARCA = `TUNI_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];
const U = {};
const T = {};
const E = {};
const P = {};
const K = {}; // las tareas, por clave
const ids = { issuers: [], projects: [] };
let equipo;

async function persona(clave, role, { campus = [], empresas = [] } = {}) {
  const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, email`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}_${MARCA.toLowerCase()}@test.local`, role]);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, P[c]]);
  for (const e of empresas) await q('INSERT INTO user_empresas (user_id, issuer_id) VALUES ($1, $2)', [u.id, E[e]]);
  U[clave] = u;
  T[clave] = jwt.sign({ userId: u.id, email: u.email, role, roles_extra: [], customRoleId: null }, process.env.JWT_SECRET, { expiresIn: '1h' });
}
const como = (c) => ({ Authorization: `Bearer ${T[c]}` });

/** Una tarea con sus fechas puestas a mano (en hora de Madrid cuando lleva +02). */
async function tarea(clave, { status = 'por_hacer', creada, terminada = null, vence = null, de = 'diana', prioridad = 'media', team = null }) {
  const t = await one(
    `INSERT INTO tasks (title, status, priority, assigned_to, created_by, created_at, updated_at, completed_at, due_date, team_id)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9) RETURNING id`,
    [`${MARCA} ${clave}`, status, prioridad, U[de].id, U.superadmin.id, creada, terminada, vence, team]
  );
  K[clave] = t.id;
}

/** Las claves de lo que devuelve el tablero (solo las tareas de esta prueba). */
async function tablero(c, params = {}) {
  const r = await request.get('/api/tasks').query(params).set(como(c));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data.filter((t) => t.title.startsWith(MARCA)).map((t) => t.title.slice(MARCA.length + 1)).sort();
}

// La semana del lunes 5 al domingo 11 de octubre de 2026 (horario de verano, +02).
const SEMANA = { periodo_desde: '2026-10-05', periodo_hasta: '2026-10-11' };

beforeAll(async () => {
  for (const clave of ['CEDIA', 'OTRA']) {
    const s = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} ${clave}`, `${MARCA}-${clave}`]);
    ids.issuers.push(s.id);
    E[clave] = s.id;
  }
  for (const [c, s] of [['A', 'CEDIA'], ['O', 'OTRA']]) {
    const p = await one('INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c.toLowerCase()}`, `${MARCA}-${c}`, E[s]]);
    ids.projects.push(p.id);
    P[c] = p.id;
  }
  await persona('superadmin', 'superadmin');
  await persona('admin', 'admin', { campus: ['A'] });
  for (const c of ['diana', 'pedro']) await persona(c, 'colaborador', { empresas: ['CEDIA'] });
  await persona('ajeno', 'colaborador', { empresas: ['OTRA'] });

  const r = await request.post('/api/tasks/teams').set(como('admin')).send({ issuer_id: E.CEDIA, name: `${MARCA} Desarrollo`, color: 'blue' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  equipo = r.body.data;
  const miembro = equipo.cargos.find((c) => c.name === 'Miembro').id;
  for (const c of ['diana']) {
    const m = await request.put(`/api/tasks/teams/${equipo.id}/members/${U[c].id}`).set(como('admin')).send({ team_role_id: miembro });
    expect(m.status, JSON.stringify(m.body)).toBe(200);
  }

  // Los cuatro casos de «entra en el periodo», y los que no entran.
  await tarea('creada', { status: 'hecha', creada: '2026-10-07T10:00:00+02', terminada: '2026-10-20T10:00:00+02', prioridad: 'alta' });
  await tarea('terminada', { status: 'hecha', creada: '2026-09-01T10:00:00+02', terminada: '2026-10-09T12:00:00+02' });
  await tarea('vence', { status: 'hecha', creada: '2026-09-01T10:00:00+02', terminada: '2026-09-02T10:00:00+02', vence: '2026-10-10T23:59:00+02' });
  await tarea('abierta', { status: 'en_curso', creada: '2026-09-01T10:00:00+02', prioridad: 'alta' });
  await tarea('fuera', { status: 'hecha', creada: '2026-09-01T10:00:00+02', terminada: '2026-09-03T10:00:00+02' });
  await tarea('futura', { status: 'en_curso', creada: '2026-10-20T10:00:00+02' });
  // Los bordes, en hora de Madrid: el domingo a las 23:30 es de la semana; el lunes a las 00:30, no.
  await tarea('domingo_noche', { status: 'hecha', creada: '2026-10-11T23:30:00+02', terminada: '2026-10-11T23:40:00+02' });
  await tarea('lunes_madrugada', { status: 'hecha', creada: '2026-10-12T00:30:00+02', terminada: '2026-10-12T00:40:00+02' });
  // De otra persona, de su equipo y de otra empresa.
  await tarea('de_pedro', { status: 'en_curso', creada: '2026-10-06T10:00:00+02', de: 'pedro', prioridad: 'alta' });
  await tarea('de_pedro_en_equipo', { status: 'por_hacer', creada: '2026-10-06T10:00:00+02', de: 'pedro', team: equipo.id });
  await tarea('de_ajeno', { status: 'en_curso', creada: '2026-10-06T10:00:00+02', de: 'ajeno' });
  await tarea('del_admin', { status: 'en_curso', creada: '2026-10-06T10:00:00+02', de: 'admin' });
});

afterAll(async () => {
  const us = Object.values(U).map((u) => u.id);
  await q('DELETE FROM tasks WHERE created_by = ANY($1::int[]) OR assigned_to = ANY($1::int[])', [us]);
  await q('DELETE FROM task_teams WHERE issuer_id = ANY($1::int[])', [ids.issuers]);
  await q('DELETE FROM admin_notifications WHERE target_user_ids && $1::int[]', [us]);
  await q('DELETE FROM user_empresas WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [us]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

describe('el periodo: día, semana y mes', () => {
  it('semana: entra lo creado, lo terminado, lo que vence y lo abierto creado antes; lo de fuera, no', async () => {
    expect(await tablero('superadmin', { ver: 'todo', assigned_to: U.diana.id, ...SEMANA })).toEqual(
      ['abierta', 'creada', 'domingo_noche', 'terminada', 'vence']
    );
  });

  it('día: el 9 de octubre, lo que se terminó ese día y lo que seguía abierto', async () => {
    expect(await tablero('superadmin', { ver: 'todo', assigned_to: U.diana.id, periodo_desde: '2026-10-09', periodo_hasta: '2026-10-09' }))
      .toEqual(['abierta', 'terminada']);
  });

  it('mes: octubre entero, también lo creado el 20 y la madrugada del lunes 12', async () => {
    expect(await tablero('superadmin', { ver: 'todo', assigned_to: U.diana.id, periodo_desde: '2026-10-01', periodo_hasta: '2026-10-31' }))
      .toEqual(['abierta', 'creada', 'domingo_noche', 'futura', 'lunes_madrugada', 'terminada', 'vence']);
  });

  it('sin periodo («Todo»), todas', async () => {
    expect((await tablero('superadmin', { ver: 'todo', assigned_to: U.diana.id })).length).toBe(8);
  });

  it('un periodo a medias o al revés es 400', async () => {
    expect((await request.get('/api/tasks').query({ periodo_desde: '2026-10-05' }).set(como('superadmin'))).status).toBe(400);
    expect((await request.get('/api/tasks').query({ periodo_desde: '2026-10-11', periodo_hasta: '2026-10-05' }).set(como('superadmin'))).status).toBe(400);
    expect((await request.get('/api/tasks').query({ ver: 'todos' }).set(como('superadmin'))).status).toBe(400);
  });
});

describe('los filtros se combinan', () => {
  it('semana + prioridad alta: de Diana, solo las altas de la semana', async () => {
    expect(await tablero('superadmin', { ver: 'todo', assigned_to: U.diana.id, priority: 'alta', ...SEMANA }))
      .toEqual(['abierta', 'creada']);
  });

  it('semana + alta sin persona: también la de Pedro, y no la de otra empresa para el admin', async () => {
    expect(await tablero('admin', { ver: 'todo', priority: 'alta', ...SEMANA })).toEqual(['abierta', 'creada', 'de_pedro']);
  });

  it('semana + equipo: solo lo de ese equipo', async () => {
    expect(await tablero('admin', { ver: 'todo', team_id: equipo.id, ...SEMANA })).toEqual(['de_pedro_en_equipo']);
  });
});

describe('Ver: mis tareas, mi equipo, todo', () => {
  it('el admin con «Todo» ve su empresa, no la otra; con «Mis tareas», solo lo suyo', async () => {
    const todo = await tablero('admin', { ver: 'todo' });
    expect(todo).toContain('de_pedro');
    expect(todo).toContain('abierta');
    expect(todo).not.toContain('de_ajeno');
    expect(await tablero('admin', { ver: 'mias' })).toEqual(['del_admin']);
  });

  it('«Mi equipo» suma lo de sus equipos: Diana ve la de Pedro del equipo, no la otra de Pedro', async () => {
    const mias = await tablero('diana', { ver: 'mias' });
    expect(mias).not.toContain('de_pedro_en_equipo');
    const equipoDiana = await tablero('diana', { ver: 'equipo' });
    expect(equipoDiana).toContain('de_pedro_en_equipo');
    expect(equipoDiana).not.toContain('de_pedro');
  });

  it('un colaborador con «Todo» sigue viendo solo lo que le deja su ámbito: el filtro nunca abre más', async () => {
    const todo = await tablero('diana', { ver: 'todo' });
    expect(todo).toEqual(await tablero('diana', { ver: 'equipo' }));
    expect(todo).not.toContain('de_pedro');
    expect(todo).not.toContain('de_ajeno');
    expect(todo).not.toContain('del_admin');
    // Pedir a otra persona no la abre.
    expect(await tablero('diana', { ver: 'todo', assigned_to: U.pedro.id })).toEqual(['de_pedro_en_equipo']);
    expect(await tablero('diana', { ver: 'todo', assigned_to: U.ajeno.id })).toEqual([]);
    // Ni cambiar de empresa arriba.
    expect(await tablero('diana', { ver: 'todo', issuerId: E.OTRA })).toEqual(todo);
  });

  it('sin `ver`, lo de antes: `mias=true` es «Mis tareas» y nada es «Todo»', async () => {
    expect(await tablero('admin', { mias: 'true' })).toEqual(['del_admin']);
    expect(await tablero('admin', {})).toEqual(await tablero('admin', { ver: 'todo' }));
  });
});

describe('la fecha de terminada', () => {
  it('se pone al pasar a «Hecha», con quién la cerró, y se quita al volver atrás', async () => {
    const c = await request.post('/api/tasks').set(como('diana')).send({ title: `${MARCA} cerrar` });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const id = c.body.data.id;
    expect(c.body.data.completed_at).toBeNull();

    const hecha = await request.patch(`/api/tasks/${id}/move`).set(como('superadmin')).send({ status: 'hecha' });
    expect(hecha.status, JSON.stringify(hecha.body)).toBe(200);
    const d1 = (await request.get(`/api/tasks/${id}`).set(como('diana'))).body.data;
    expect(d1.completed_at).not.toBeNull();
    expect(d1.completed_by).toBe(U.superadmin.id);
    expect(d1.completed_by_name).toBe(`${MARCA} superadmin`);
    expect(d1.created_by_name).toBe(`${MARCA} diana`);

    const atras = await request.patch(`/api/tasks/${id}/move`).set(como('superadmin')).send({ status: 'en_curso' });
    expect(atras.status, JSON.stringify(atras.body)).toBe(200);
    const d2 = (await request.get(`/api/tasks/${id}`).set(como('diana'))).body.data;
    expect(d2.completed_at).toBeNull();
    expect(d2.completed_by).toBeNull();
  });

  it('aprobando desde «Por revisar» también: la fecha y quién la aprobó', async () => {
    const c = await request.post('/api/tasks').set(como('diana')).send({ title: `${MARCA} aprobar` });
    const id = c.body.data.id;
    expect((await request.patch(`/api/tasks/${id}/move`).set(como('diana')).send({ status: 'en_revision' })).status).toBe(200);
    const a = await request.patch(`/api/tasks/${id}/approve`).set(como('superadmin'));
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const d = (await request.get(`/api/tasks/${id}`).set(como('diana'))).body.data;
    expect(d.status).toBe('hecha');
    expect(d.completed_at).not.toBeNull();
    expect(d.completed_by).toBe(U.superadmin.id);
  });

  it('la migración 241 cuadra lo de antes: hecha sin fecha toma la del historial; abierta con fecha, se borra', async () => {
    const sinFecha = await one(
      `INSERT INTO tasks (title, status, assigned_to, created_by, updated_at) VALUES ($1, 'hecha', $2, $2, '2026-10-15T09:00:00Z') RETURNING id`,
      [`${MARCA} sin fecha`, U.diana.id]);
    await q(`INSERT INTO task_events (task_id, user_id, event_type, details, created_at)
             VALUES ($1, $2, 'status_changed', '{"old_status":"en_revision","new_status":"hecha"}', '2026-10-14T08:00:00Z')`,
    [sinFecha.id, U.superadmin.id]);
    const sinHistorial = await one(
      `INSERT INTO tasks (title, status, assigned_to, created_by, updated_at) VALUES ($1, 'hecha', $2, $2, '2026-10-16T09:00:00Z') RETURNING id`,
      [`${MARCA} sin historial`, U.diana.id]);
    const colgada = await one(
      `INSERT INTO tasks (title, status, assigned_to, created_by, completed_at) VALUES ($1, 'en_curso', $2, $2, NOW()) RETURNING id`,
      [`${MARCA} colgada`, U.diana.id]);

    await pool.query(fs.readFileSync(path.join(AQUI, '..', 'migrations', '241_tareas_fecha_terminada.sql'), 'utf8'));
    const fecha = async (id) => (await one('SELECT completed_at FROM tasks WHERE id = $1', [id])).completed_at;
    expect((await fecha(sinFecha.id)).toISOString()).toBe('2026-10-14T08:00:00.000Z');
    expect((await fecha(sinHistorial.id)).toISOString()).toBe('2026-10-16T09:00:00.000Z');
    expect(await fecha(colgada.id)).toBeNull();
    // Lo que ya estaba bien no se toca.
    expect((await fecha(K.terminada)).toISOString()).toBe('2026-10-09T10:00:00.000Z');
  });
});
