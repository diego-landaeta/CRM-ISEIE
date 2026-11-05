import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Brevo simulado: no sale ningún correo de verdad.
vi.mock('../src/shared/services/brevo.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendEmail: vi.fn(async () => ({ sent: true, messageId: '<prueba>' })),
}));

const supertest = (await import('supertest')).default;
const jwt = (await import('jsonwebtoken')).default;
const app = (await import('../src/app.js')).default;
const pool = (await import('../src/shared/config/db.js')).default;

/**
 * El tablero de tutores (Diego, 04/11/2026): «un tablero de tutores separado del
 * de colaboradores». Quien lleva las colaboraciones de los profesores (aquí
 * «colab», colaboradora que además es tutora) ve sus DOS tableros por separado;
 * un tutor ve el suyo y no el de desarrollo; una gestora sigue sin tablero.
 *
 *   · Un equipo es de tipo «colaboradores» o «tutores» (migración 273).
 *   · A un tutor solo se le mete en uno de tutores; también si es de la empresa
 *     solo por `tutor_empresas`, sin campus propio.
 *   · El tutor trae de serie «Ver su tablero» y «Editar tareas», y el corte del
 *     tutor (`RUTAS_DEL_TUTOR`) deja pasar /api/tasks.
 *
 *   cd backend && npx vitest run tests/tableroDeTutores.test.js
 */

const request = supertest(app);
const MARCA = `TTUT_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];
const U = {};
const T = {};
const ids = { issuers: [], projects: [] };
let empresa;
let campus;
const equipo = {};
const cargo = {};
const tarea = {};

async function persona(clave, role, { roles_extra = [], campus: cs = [], empresas = [], tutorEmpresas = [], colaboraciones = false } = {}) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role, roles_extra, gestor_colaboraciones)
     VALUES ($1, $2, 'x', $3, $4::user_role[], $5) RETURNING id, email`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}_${MARCA.toLowerCase()}@test.local`, role, roles_extra, colaboraciones]);
  for (const c of cs) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
  for (const e of empresas) await q('INSERT INTO user_empresas (user_id, issuer_id) VALUES ($1, $2)', [u.id, e]);
  for (const e of tutorEmpresas) await q('INSERT INTO tutor_empresas (tutor_id, issuer_id) VALUES ($1, $2)', [u.id, e]);
  U[clave] = u;
  T[clave] = jwt.sign({ userId: u.id, email: u.email, role, roles_extra, customRoleId: null }, process.env.JWT_SECRET, { expiresIn: '1h' });
}
const como = (c) => ({ Authorization: `Bearer ${T[c]}` });
const meter = (c, team, cargoId) => request.put(`/api/tasks/teams/${equipo[team].id}/members/${U[c].id}`).set(como('admin')).send({ team_role_id: cargoId });
const titulos = (r) => (r.body.data || []).map((t) => t.title.replace(`${MARCA} `, '')).sort();

beforeAll(async () => {
  empresa = (await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} CEDIA`, `${MARCA}-C`])).id;
  ids.issuers.push(empresa);
  campus = (await one('INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [`${MARCA} A`, `${MARCA.toLowerCase()}-a`, `${MARCA}-A`, empresa])).id;
  ids.projects.push(campus);

  await persona('admin', 'admin', { campus: [campus] });
  await persona('dev', 'colaborador', { empresas: [empresa] });
  // La que lleva las colaboraciones: colaboradora y además tutora.
  await persona('colab', 'colaborador', { roles_extra: ['tutor'], empresas: [empresa], colaboraciones: true });
  await persona('tutor', 'tutor', { campus: [campus] });
  // De la empresa solo por `tutor_empresas`: sin campus propio.
  await persona('tutorEmpresa', 'tutor', { tutorEmpresas: [empresa] });
  await persona('tutorSuelto', 'tutor', { campus: [campus] });
  await persona('gestora', 'gestor', { campus: [campus] });
}, 60000);

afterAll(async () => {
  const us = Object.values(U).map((u) => u.id);
  await q('DELETE FROM tasks WHERE created_by = ANY($1::int[]) OR assigned_to = ANY($1::int[])', [us]);
  await q('DELETE FROM task_teams WHERE issuer_id = ANY($1::int[])', [ids.issuers]);
  await q('DELETE FROM admin_notifications WHERE target_user_ids && $1::int[]', [us]);
  await q('DELETE FROM tutor_empresas WHERE tutor_id = ANY($1::int[])', [us]);
  await q('DELETE FROM user_empresas WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [us]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

describe('equipos de tutores', () => {
  it('el admin crea el de desarrollo (colaboradores, por defecto) y el de tutores', async () => {
    for (const [k, body] of [['dev', { name: 'Desarrollo y SEO' }], ['tut', { name: 'Tutores', tipo: 'tutores' }]]) {
      const r = await request.post('/api/tasks/teams').set(como('admin')).send({ issuer_id: empresa, ...body });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      equipo[k] = r.body.data;
      cargo[k] = Object.fromEntries(r.body.data.cargos.map((c) => [c.name, c.id]));
    }
    expect(equipo.dev.tipo).toBe('colaboradores');
    expect(equipo.tut.tipo).toBe('tutores');
  });

  it('a un tutor solo se le mete en el de tutores; también al que es de la empresa por tutor_empresas', async () => {
    expect((await meter('tutor', 'dev', cargo.dev.Miembro)).status).toBe(400);
    const cand = (t) => request.get(`/api/tasks/teams/${equipo[t].id}/candidates`).set(como('admin'));
    const deDev = (await cand('dev')).body.data.map((u) => u.id);
    const deTut = (await cand('tut')).body.data.map((u) => u.id);
    expect(deDev).not.toContain(U.tutor.id);
    expect(deTut).toEqual(expect.arrayContaining([U.tutor.id, U.tutorEmpresa.id, U.colab.id]));
    // La gestora no tiene tablero: ni en uno ni en otro.
    expect(deTut).not.toContain(U.gestora.id);
    expect((await meter('gestora', 'tut', cargo.tut.Miembro)).status).toBe(400);

    expect((await meter('tutor', 'tut', cargo.tut.Miembro)).status).toBe(200);
    expect((await meter('tutorEmpresa', 'tut', cargo.tut.Miembro)).status).toBe(200);
    expect((await meter('colab', 'tut', cargo.tut.Encargado)).status).toBe(200);
    expect((await meter('colab', 'dev', cargo.dev.Miembro)).status).toBe(200);
    expect((await meter('dev', 'dev', cargo.dev.Encargado)).status).toBe(200);
  });

  it('quien lleva las colaboraciones está en los dos equipos, cada uno con su tipo', async () => {
    const r = await request.get('/api/tasks/teams/mine').set(como('colab'));
    expect(r.status).toBe(200);
    expect(r.body.data.map((e) => [e.team_name, e.team_tipo]).sort()).toEqual([['Desarrollo y SEO', 'colaboradores'], ['Tutores', 'tutores']]);
    const t = await request.get('/api/tasks/teams/mine').set(como('tutor'));
    expect(t.status).toBe(200);
    expect(t.body.data.map((e) => e.team_name)).toEqual(['Tutores']);
  });
});

describe('las tareas de cada tablero', () => {
  it('cada una cae en el equipo de quien la lleva, también en un tutor sin campus', async () => {
    const crear = async (c, body) => {
      const r = await request.post('/api/tasks').set(como(c)).send({ ...body, title: `${MARCA} ${body.title}` });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.data;
    };
    tarea.dev = await crear('dev', { title: 'de desarrollo' });
    tarea.tutor = await crear('colab', { title: 'para el tutor', assigned_to: U.tutor.id });
    tarea.tutorEmpresa = await crear('colab', { title: 'para el tutor de empresa', assigned_to: U.tutorEmpresa.id });
    expect(tarea.dev.team_id).toBe(equipo.dev.id);
    expect(tarea.tutor.team_id).toBe(equipo.tut.id);
    expect(tarea.tutorEmpresa.team_id).toBe(equipo.tut.id);
  });

  it('el tutor ve su tablero de tutores y no el de desarrollo', async () => {
    const r = await request.get('/api/tasks').query({ ver: 'equipo' }).set(como('tutor'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(titulos(r)).toEqual(['para el tutor', 'para el tutor de empresa']);
    // «Todo» no le abre más: no tiene «Ver todo».
    expect(titulos(await request.get('/api/tasks').query({ ver: 'todo' }).set(como('tutor')))).toEqual(['para el tutor', 'para el tutor de empresa']);
    expect([403, 404]).toContain((await request.get(`/api/tasks/${tarea.dev.id}`).set(como('tutor'))).status);
    expect((await request.get(`/api/tasks/${tarea.tutor.id}`).set(como('tutor'))).status).toBe(200);
  });

  it('el tutor mueve la suya, pero no la de otro tutor del equipo', async () => {
    expect((await request.patch(`/api/tasks/${tarea.tutor.id}/move`).set(como('tutor')).send({ status: 'en_curso' })).status).toBe(200);
    expect((await request.patch(`/api/tasks/${tarea.tutorEmpresa.id}/move`).set(como('tutor')).send({ status: 'en_curso' })).status).toBe(403);
  });

  it('quien lleva las colaboraciones ve los dos tableros, cada uno por su equipo', async () => {
    const de = (team) => request.get('/api/tasks').query({ ver: 'equipo', team_id: team }).set(como('colab'));
    expect(titulos(await de(equipo.tut.id))).toEqual(['para el tutor', 'para el tutor de empresa']);
    expect(titulos(await de(equipo.dev.id))).toEqual(['de desarrollo']);
  });

  it('el de desarrollo no ve el de tutores', async () => {
    expect(titulos(await request.get('/api/tasks').query({ ver: 'equipo' }).set(como('dev')))).toEqual(['de desarrollo']);
  });

  it('una gestora sigue sin tablero', async () => {
    expect((await request.get('/api/tasks').set(como('gestora'))).status).toBe(403);
    expect((await request.get('/api/tasks/teams/mine').set(como('gestora'))).status).toBe(403);
  });

  it('un tutor fuera del equipo entra a un tablero vacío y no se le puede dar una tarea', async () => {
    const r = await request.get('/api/tasks').query({ ver: 'equipo' }).set(como('tutorSuelto'));
    expect(r.status).toBe(200);
    expect(titulos(r)).toEqual([]);
    const a = await request.post('/api/tasks').set(como('admin')).send({ title: `${MARCA} no`, assigned_to: U.tutorSuelto.id });
    expect(a.status).toBe(400);
  });
});
