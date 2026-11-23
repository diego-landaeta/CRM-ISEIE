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
 * CRM-ISEIE#687 · Las tutoras redactoras (Diego, 23/11/2026): «habilitar su panel de
 * Trello separado, y que el admin pueda filtrar por los dos equipos, sus
 * facturas…».
 *
 *   · Un equipo de tipo «redactoras» (migración 325): solo entran ellas y quien
 *     lo dirige (un admin); a una redactora no se la mete en uno de desarrollo,
 *     ni a alguien de desarrollo en el de ellas. A la desactivada sí se la mete
 *     en el suyo: entra al activarla.
 *   · Cada una ve lo suyo y la encargada lo de su equipo: una miembro no ve la
 *     tarea de otra miembro, ni en la lista ni abriéndola por su número.
 *   · El super admin filtra el tablero y el historial por tipo de equipo, y las
 *     fichas de colaboradores por equipo; las redactoras sin ficha salen aparte.
 *
 *   cd backend && npx vitest run tests/tutorasRedactoras687.test.js
 */

const request = supertest(app);
const MARCA = `TRED_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];
const U = {};
const T = {};
const ids = { issuers: [], projects: [], colaboradores: [] };
let empresa;
let campus;
const equipo = {};
const cargo = {};
const tarea = {};

async function persona(clave, role, { campus: cs = [], empresas = [], active = true } = {}) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role, active)
     VALUES ($1, $2, 'x', $3, $4) RETURNING id, email`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}_${MARCA.toLowerCase()}@test.local`, role, active]);
  for (const c of cs) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
  for (const e of empresas) await q('INSERT INTO user_empresas (user_id, issuer_id) VALUES ($1, $2)', [u.id, e]);
  U[clave] = u;
  T[clave] = jwt.sign({ userId: u.id, email: u.email, role, roles_extra: [], customRoleId: null }, process.env.JWT_SECRET, { expiresIn: '1h' });
}
const como = (c) => ({ Authorization: `Bearer ${T[c]}` });
const meter = (c, team, cargoId) => request.put(`/api/tasks/teams/${equipo[team].id}/members/${U[c].id}`).set(como('admin')).send({ team_role_id: cargoId });
// Solo las de esta prueba: la base del CI trae datos de serie.
const titulos = (r) => (r.body.data || []).filter((t) => t.title.startsWith(`${MARCA} `)).map((t) => t.title.replace(`${MARCA} `, '')).sort();

beforeAll(async () => {
  empresa = (await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} CEDIA`, `${MARCA}-C`])).id;
  ids.issuers.push(empresa);
  campus = (await one('INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [`${MARCA} A`, `${MARCA.toLowerCase()}-a`, `${MARCA}-A`, empresa])).id;
  ids.projects.push(campus);

  await persona('admin', 'admin', { campus: [campus] });
  await persona('superadmin', 'superadmin');
  await persona('dev', 'colaborador', { empresas: [empresa] });
  await persona('jefa', 'tutor_redactor', { empresas: [empresa] });
  await persona('red1', 'tutor_redactor', { empresas: [empresa] });
  await persona('red2', 'tutor_redactor', { empresas: [empresa] });
  // Dada de alta y apagada hasta tener el chat de Moodle (11/11/2026).
  await persona('apagada', 'tutor_redactor', { empresas: [empresa], active: false });
}, 60000);

afterAll(async () => {
  const us = Object.values(U).map((u) => u.id);
  await q('DELETE FROM tasks WHERE created_by = ANY($1::int[]) OR assigned_to = ANY($1::int[])', [us]);
  await q('DELETE FROM task_teams WHERE issuer_id = ANY($1::int[])', [ids.issuers]);
  await q('DELETE FROM colaborador_empresas WHERE colaborador_id = ANY($1::int[])', [ids.colaboradores]);
  await q('DELETE FROM colaboradores WHERE id = ANY($1::int[])', [ids.colaboradores]);
  await q('DELETE FROM admin_notifications WHERE target_user_ids && $1::int[]', [us]);
  await q('DELETE FROM user_empresas WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [us]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

describe('el equipo de tutoras redactoras', () => {
  it('el admin crea el de desarrollo y el de redactoras', async () => {
    for (const [k, body] of [['dev', { name: 'Desarrollo' }], ['red', { name: 'Tutoras redactoras', tipo: 'redactoras' }]]) {
      const r = await request.post('/api/tasks/teams').set(como('admin')).send({ issuer_id: empresa, ...body });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      equipo[k] = r.body.data;
      cargo[k] = Object.fromEntries(r.body.data.cargos.map((c) => [c.name, c.id]));
    }
    expect(equipo.dev.tipo).toBe('colaboradores');
    expect(equipo.red.tipo).toBe('redactoras');
  });

  it('una redactora no entra en el de desarrollo, ni alguien de desarrollo en el de ellas', async () => {
    const cand = async (t) => (await request.get(`/api/tasks/teams/${equipo[t].id}/candidates`).set(como('admin'))).body.data.map((u) => u.id);
    const deDev = await cand('dev');
    const deRed = await cand('red');
    expect(deDev).toContain(U.dev.id);
    expect(deDev).not.toContain(U.red1.id);
    expect(deRed).toEqual(expect.arrayContaining([U.jefa.id, U.red1.id, U.red2.id, U.apagada.id]));
    expect(deRed).not.toContain(U.dev.id);

    const a = await meter('red1', 'dev', cargo.dev.Miembro);
    expect(a.status).toBe(400);
    expect(a.body.error).toMatch(/desarrollo/);
    const b = await meter('dev', 'red', cargo.red.Miembro);
    expect(b.status).toBe(400);
    expect(b.body.error).toMatch(/redactoras/);
  });

  it('ellas entran en el suyo; también la desactivada, para cuando se active', async () => {
    expect((await meter('jefa', 'red', cargo.red.Encargado)).status).toBe(200);
    expect((await meter('red1', 'red', cargo.red.Miembro)).status).toBe(200);
    expect((await meter('red2', 'red', cargo.red.Miembro)).status).toBe(200);
    expect((await meter('apagada', 'red', cargo.red.Miembro)).status).toBe(200);
    expect((await meter('dev', 'dev', cargo.dev.Miembro)).status).toBe(200);
  });
});

describe('su tablero aparte', () => {
  it('cada tarea cae en el equipo de quien la lleva', async () => {
    const crear = async (c, body) => {
      const r = await request.post('/api/tasks').set(como(c)).send({ ...body, title: `${MARCA} ${body.title}` });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.data;
    };
    tarea.dev = await crear('dev', { title: 'de desarrollo' });
    tarea.red1 = await crear('jefa', { title: 'para red1', assigned_to: U.red1.id });
    tarea.red2 = await crear('jefa', { title: 'para red2', assigned_to: U.red2.id });
    expect(tarea.dev.team_id).toBe(equipo.dev.id);
    expect(tarea.red1.team_id).toBe(equipo.red.id);
    expect(tarea.red2.team_id).toBe(equipo.red.id);
  });

  it('una miembro ve lo suyo y no la tarea de otra miembro ni las de desarrollo', async () => {
    for (const ver of ['equipo', 'todo', 'mias']) {
      const r = await request.get('/api/tasks').query({ ver }).set(como('red1'));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(titulos(r), ver).toEqual(['para red1']);
    }
    expect((await request.get(`/api/tasks/${tarea.red1.id}`).set(como('red1'))).status).toBe(200);
    expect([403, 404]).toContain((await request.get(`/api/tasks/${tarea.red2.id}`).set(como('red1'))).status);
    expect([403, 404]).toContain((await request.get(`/api/tasks/${tarea.dev.id}`).set(como('red1'))).status);
  });

  it('la encargada ve las de su equipo, y nada de desarrollo', async () => {
    const r = await request.get('/api/tasks').query({ ver: 'equipo' }).set(como('jefa'));
    expect(r.status).toBe(200);
    expect(titulos(r)).toEqual(['para red1', 'para red2']);
    expect([403, 404]).toContain((await request.get(`/api/tasks/${tarea.dev.id}`).set(como('jefa'))).status);
  });

  it('el de desarrollo no ve el tablero de las redactoras', async () => {
    expect(titulos(await request.get('/api/tasks').query({ ver: 'equipo' }).set(como('dev')))).toEqual(['de desarrollo']);
    expect([403, 404]).toContain((await request.get(`/api/tasks/${tarea.red1.id}`).set(como('dev'))).status);
  });

  it('el super admin filtra el tablero y el historial por tipo de equipo', async () => {
    const de = (team_tipo) => request.get('/api/tasks').query({ ver: 'todo', team_tipo }).set(como('superadmin'));
    expect(titulos(await de('redactoras'))).toEqual(['para red1', 'para red2']);
    expect(titulos(await de('colaboradores'))).toEqual(['de desarrollo']);
    expect((await de('otro')).status).toBe(400);

    const h = await request.get('/api/tasks/historial').query({ ver: 'todo', team_tipo: 'redactoras' }).set(como('superadmin'));
    expect(h.status, JSON.stringify(h.body)).toBe(200);
    const filas = Array.isArray(h.body.data) ? h.body.data : (h.body.data?.tareas || []);
    expect(filas.every((t) => t.team_id === null || t.team_id !== equipo.dev.id)).toBe(true);
  });
});

describe('sus fichas de colaboradora', () => {
  const API = '/api/facturas-colaborador';

  beforeAll(async () => {
    const ficha = async (nombre, area, userId) => {
      const c = await one(
        `INSERT INTO colaboradores (nombre, email, area, user_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [`${MARCA} ${nombre}`, `${nombre}_${MARCA.toLowerCase()}@test.local`, area, userId]);
      await q('INSERT INTO colaborador_empresas (colaborador_id, issuer_id) VALUES ($1, $2)', [c.id, empresa]);
      ids.colaboradores.push(c.id);
    };
    await ficha('ficha-red1', 'otra', U.red1.id);
    // Sin usuario todavía: es redactora por su área.
    await ficha('ficha-sin-usuario', 'redaccion', null);
    await ficha('ficha-dev', 'desarrollo', U.dev.id);
  });

  const nombres = (r) => (r.body.data || []).filter((c) => c.nombre.startsWith(`${MARCA} `)).map((c) => c.nombre.replace(`${MARCA} `, '')).sort();

  it('el filtro por equipo separa las de redactoras de las de desarrollo', async () => {
    const de = (equipoF) => request.get(`${API}/colaboradores`).query({ estado: 'todos', q: MARCA, equipo: equipoF }).set(como('superadmin'));
    const red = await de('redactoras');
    expect(red.status, JSON.stringify(red.body)).toBe(200);
    expect(nombres(red)).toEqual(['ficha-red1', 'ficha-sin-usuario']);
    expect(red.body.data.every((c) => c.equipo === 'redactoras')).toBe(true);
    expect(nombres(await de('desarrollo'))).toEqual(['ficha-dev']);
    expect((await de('otro')).status).toBe(400);
  });

  it('las redactoras sin ficha salen aparte, también la desactivada', async () => {
    const r = await request.get(`${API}/colaboradores/redactoras-sin-ficha`).set(como('superadmin'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const suyas = r.body.data.map((u) => u.id);
    expect(suyas).toEqual(expect.arrayContaining([U.jefa.id, U.red2.id, U.apagada.id]));
    expect(suyas).not.toContain(U.red1.id);
    expect(suyas).not.toContain(U.dev.id);
    // Una redactora no gestiona fichas.
    expect((await request.get(`${API}/colaboradores/redactoras-sin-ficha`).set(como('red1'))).status).toBe(403);
  });
});

describe('la cabecera de una redactora (Consultas sin 403)', () => {
  it('le deja preguntar si le suena una llamada, como al tutor', async () => {
    const r = await request.get('/api/whatsapp/sonando').set(como('red1'));
    expect(r.status).not.toBe(403);
  });
});
