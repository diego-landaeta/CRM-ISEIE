import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Brevo simulado: se ve qué correo se habría mandado, sin mandar nada.
const sendEmail = vi.fn(async () => ({ sent: true, messageId: '<prueba>' }));
vi.mock('../src/shared/services/brevo.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendEmail,
}));

const supertest = (await import('supertest')).default;
const jwt = (await import('jsonwebtoken')).default;
const app = (await import('../src/app.js')).default;
const pool = (await import('../src/shared/config/db.js')).default;

/**
 * Equipos del tablero con cargos por nivel, y quién mueve y comenta (Diego, 26/10/2026):
 *
 *   «Desarrollo y SEO es lo mismo, pero son por roles según jerarquía»: se delega
 *   hacia ABAJO dentro del equipo; el nivel más bajo crea solo sus tareas; supervisa
 *   alguien del equipo con nivel igual o mayor que quien la lleva, o un admin.
 *
 *   «Solo superadmin pueden mover las tareas de lugar, y quienes supervisan o
 *   colaboran; y añadir comentarios»: ni el admin ni un cargo alto, si no la
 *   llevan ni la supervisan.
 *
 *   cd backend && npx vitest run tests/tareasEquiposNiveles.test.js
 */

const request = supertest(app);
const MARCA = `EQNIV_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];
const U = {};
const T = {};
const E = {};
const P = {};
const ids = { issuers: [], projects: [] };
const correoAnterior = process.env.TAREAS_CORREOS_ACTIVOS;
let equipo;
let cargo;

async function persona(clave, role, { campus = [], empresas = [] } = {}) {
  const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, email`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}_${MARCA.toLowerCase()}@test.local`, role]);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, P[c]]);
  for (const e of empresas) await q('INSERT INTO user_empresas (user_id, issuer_id) VALUES ($1, $2)', [u.id, E[e]]);
  U[clave] = u;
  T[clave] = jwt.sign({ userId: u.id, email: u.email, role, roles_extra: [], customRoleId: null }, process.env.JWT_SECRET, { expiresIn: '1h' });
}
const como = (c) => ({ Authorization: `Bearer ${T[c]}` });
const crear = (c, body) => request.post('/api/tasks').set(como(c)).send(body);
const mover = (c, id, status = 'en_curso') => request.patch(`/api/tasks/${id}/move`).set(como(c)).send({ status });
const comentar = (c, id) => request.post(`/api/tasks/${id}/comments`).set(como(c)).send({ content: `De ${c}` });
const correosA = (c) => sendEmail.mock.calls.map(([a]) => a).filter((m) => m.to?.[0]?.email === U[c].email);
const esperar = () => new Promise((s) => setTimeout(s, 300));
const meter = (c, cargoId) => request.put(`/api/tasks/teams/${equipo.id}/members/${U[c].id}`).set(como('admin')).send({ team_role_id: cargoId });

beforeAll(async () => {
  process.env.TAREAS_CORREOS_ACTIVOS = 'true';
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
  for (const c of ['jefe', 'julian', 'jesus', 'diana', 'pedro', 'fuera']) await persona(c, 'colaborador', { empresas: ['CEDIA'] });
  await persona('ajeno', 'colaborador', { empresas: ['OTRA'] });
});

afterAll(async () => {
  process.env.TAREAS_CORREOS_ACTIVOS = correoAnterior;
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

describe('gestionar equipos, cargos y miembros', () => {
  it('el admin crea «Desarrollo y SEO» en su empresa, con «Encargado» (2) y «Miembro» (1) de serie', async () => {
    const r = await request.post('/api/tasks/teams').set(como('admin')).send({ issuer_id: E.CEDIA, name: 'Desarrollo y SEO', color: 'blue' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    equipo = r.body.data;
    expect(equipo.cargos.map((c) => [c.name, c.level])).toEqual([['Encargado', 2], ['Miembro', 1]]);
    cargo = Object.fromEntries(equipo.cargos.map((c) => [c.name, c.id]));
  });

  it('un colaborador no gestiona equipos; un admin, no en otra empresa; un nombre repetido es 409', async () => {
    expect((await request.post('/api/tasks/teams').set(como('julian')).send({ issuer_id: E.CEDIA, name: 'Nope' })).status).toBe(403);
    expect((await request.post('/api/tasks/teams').set(como('admin')).send({ issuer_id: E.OTRA, name: 'Nope' })).status).toBe(403);
    expect((await request.post('/api/tasks/teams').set(como('admin')).send({ issuer_id: E.CEDIA, name: 'desarrollo y seo' })).status).toBe(409);
  });

  it('un cargo intermedio por encima («Jefe de proyecto», 3), y los miembros con su cargo', async () => {
    const r = await request.post(`/api/tasks/teams/${equipo.id}/roles`).set(como('admin')).send({ name: 'Jefe de proyecto', level: 3, sort_order: 0 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    cargo.Jefe = r.body.data.id;
    expect((await meter('jefe', cargo.Jefe)).status).toBe(200);
    for (const c of ['julian', 'jesus']) expect((await meter(c, cargo.Encargado)).status).toBe(200);
    for (const c of ['diana', 'pedro']) expect((await meter(c, cargo.Miembro)).status).toBe(200);
    // De otra empresa, no entra.
    expect((await meter('ajeno', cargo.Miembro)).status).toBe(400);
    const d = (await request.get(`/api/tasks/teams/${equipo.id}`).set(como('admin'))).body.data;
    expect(d.miembros.map((m) => [m.nombre.replace(`${MARCA} `, ''), m.cargo, m.nivel])).toEqual([
      ['jefe', 'Jefe de proyecto', 3], ['jesus', 'Encargado', 2], ['julian', 'Encargado', 2], ['diana', 'Miembro', 1], ['pedro', 'Miembro', 1],
    ]);
  });

  it('un cargo que tiene alguien no se archiva (409); un nivel de 1.5 sí se crea', async () => {
    expect((await request.patch(`/api/tasks/teams/${equipo.id}/roles/${cargo.Miembro}`).set(como('admin')).send({ is_active: false })).status).toBe(409);
    const r = await request.post(`/api/tasks/teams/${equipo.id}/roles`).set(como('admin')).send({ name: 'Senior', level: 1.5 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.level).toBe(1.5);
  });

  it('cada uno ve sus equipos con su cargo, y si puede delegar', async () => {
    const julian = (await request.get('/api/tasks/teams/mine').set(como('julian'))).body.data;
    expect(julian).toEqual([expect.objectContaining({ team_id: equipo.id, cargo: 'Encargado', nivel: 2, puede_delegar: true })]);
    const diana = (await request.get('/api/tasks/teams/mine').set(como('diana'))).body.data;
    expect(diana).toEqual([expect.objectContaining({ cargo: 'Miembro', nivel: 1, puede_delegar: false })]);
  });
});

describe('delegar: hacia abajo, dentro del equipo', () => {
  it('abajo sí: el encargado a un miembro; el jefe a un encargado', async () => {
    expect((await crear('julian', { title: `${MARCA} J→D`, team_id: equipo.id, assigned_to: U.diana.id })).status).toBe(201);
    expect((await crear('jefe', { title: `${MARCA} Jefe→J`, team_id: equipo.id, assigned_to: U.julian.id })).status).toBe(201);
  });

  it('igual o arriba no: encargado a encargado, encargado al jefe: 403', async () => {
    expect((await crear('julian', { title: 'x', team_id: equipo.id, assigned_to: U.jesus.id })).status).toBe(403);
    expect((await crear('julian', { title: 'x', team_id: equipo.id, assigned_to: U.jefe.id })).status).toBe(403);
  });

  it('el nivel más bajo crea solo las suyas: dársela a otro, o ponerle supervisor, 403', async () => {
    expect((await crear('diana', { title: `${MARCA} De Diana`, team_id: equipo.id })).status).toBe(201);
    expect((await crear('diana', { title: `${MARCA} De Diana sin equipo` })).status).toBe(201);
    expect((await crear('diana', { title: 'x', team_id: equipo.id, assigned_to: U.pedro.id })).status).toBe(403);
    expect((await crear('diana', { title: 'x', team_id: equipo.id, supervisor_id: U.julian.id })).status).toBe(403);
    // Sin equipo, a otro tampoco, ni siendo encargado en un equipo.
    expect((await crear('julian', { title: 'x', assigned_to: U.diana.id })).status).toBe(403);
  });

  it('a quien no es del equipo: 400, aunque sea de la empresa', async () => {
    expect((await crear('julian', { title: 'x', team_id: equipo.id, assigned_to: U.fuera.id })).status).toBe(400);
  });

  it('el admin delega en todo el equipo; un equipo de otra empresa no es suyo', async () => {
    expect((await crear('admin', { title: `${MARCA} Admin→Jefe`, team_id: equipo.id, assigned_to: U.jefe.id })).status).toBe(201);
    expect((await crear('ajeno', { title: 'x', team_id: equipo.id })).status).toBe(403);
  });
});

describe('supervisor: del equipo con nivel igual o mayor, o un admin', () => {
  it('igual o mayor sí (un encargado, u otro miembro), y le llega el correo con el equipo', async () => {
    sendEmail.mockClear();
    const r = await crear('julian', { title: `${MARCA} Sup`, team_id: equipo.id, assigned_to: U.diana.id, supervisor_id: U.jesus.id });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await crear('julian', { title: `${MARCA} Sup2`, team_id: equipo.id, assigned_to: U.diana.id, supervisor_id: U.pedro.id })).status).toBe(201);
    await esperar();
    expect(correosA('jesus')[0].subject).toBe(`Supervisas · Desarrollo y SEO: ${MARCA} Sup`);
    expect(correosA('diana').map((c) => c.subject)).toContain(`Tarea asignada · Desarrollo y SEO: ${MARCA} Sup`);
    expect(correosA('diana')[0].htmlContent).toContain('Desarrollo y SEO');
  });

  it('menor no: un miembro no supervisa a un encargado (403); un admin sí', async () => {
    expect((await crear('jefe', { title: 'x', team_id: equipo.id, assigned_to: U.julian.id, supervisor_id: U.diana.id })).status).toBe(403);
    expect((await crear('jefe', { title: `${MARCA} SupAdmin`, team_id: equipo.id, assigned_to: U.julian.id, supervisor_id: U.admin.id })).status).toBe(201);
  });
});

describe('mover y comentar: el responsable, el supervisor y el superadmin; nadie más', () => {
  let t;
  beforeAll(async () => {
    t = (await crear('julian', { title: `${MARCA} Regla`, team_id: equipo.id, assigned_to: U.diana.id, supervisor_id: U.jesus.id })).body.data;
  });

  it('el superadmin la mueve', async () => {
    expect((await mover('superadmin', t.id)).status).toBe(200);
  });

  it('el supervisor la mueve y la comenta', async () => {
    expect((await mover('jesus', t.id, 'por_hacer')).status).toBe(200);
    expect((await comentar('jesus', t.id)).status).toBe(201);
  });

  it('el responsable la mueve y la comenta', async () => {
    expect((await mover('diana', t.id)).status).toBe(200);
    expect((await comentar('diana', t.id)).status).toBe(201);
    expect((await request.post(`/api/tasks/${t.id}/checklist`).set(como('diana')).send({ title: 'Paso' })).status).toBe(201);
  });

  it('un admin ajeno a la tarea: 403 (la ve, pero ni la mueve ni la comenta)', async () => {
    expect((await request.get(`/api/tasks/${t.id}`).set(como('admin'))).status).toBe(200);
    expect((await mover('admin', t.id)).status).toBe(403);
    expect((await comentar('admin', t.id)).status).toBe(403);
  });

  it('un miembro ajeno (y quien la creó): 403 al moverla o comentarla; quien la creó sí cambia el título', async () => {
    expect((await mover('pedro', t.id)).status).toBe(403);
    expect((await comentar('pedro', t.id)).status).toBe(403);
    expect((await mover('julian', t.id)).status).toBe(403);
    expect((await comentar('julian', t.id)).status).toBe(403);
    expect((await request.patch(`/api/tasks/${t.id}`).set(como('julian')).send({ title: `${MARCA} Regla, retocada` })).status).toBe(200);
    // Quien la lleva no le cambia el título; un miembro, tampoco.
    expect((await request.patch(`/api/tasks/${t.id}`).set(como('diana')).send({ title: 'No' })).status).toBe(403);
    expect((await request.patch(`/api/tasks/${t.id}`).set(como('pedro')).send({ title: 'No' })).status).toBe(403);
  });

  it('el frontal recibe lo mismo: permisos de la tarea y si se puede arrastrar', async () => {
    const dePedro = (await request.get(`/api/tasks/${t.id}`).set(como('pedro'))).body.data;
    expect(dePedro.permisos).toMatchObject({ mover: false, comentar: false, editar: false });
    const deDiana = (await request.get(`/api/tasks/${t.id}`).set(como('diana'))).body.data;
    expect(deDiana.permisos).toMatchObject({ mover: true, comentar: true, editar: false });
    const lista = (await request.get(`/api/tasks?team_id=${equipo.id}`).set(como('pedro'))).body.data;
    const fila = lista.find((x) => x.id === t.id);
    expect(fila).toMatchObject({ team_name: 'Desarrollo y SEO', assigned_cargo: 'Miembro', puede_mover: false });
  });

  it('aprobar: el supervisor sí; el admin no', async () => {
    expect((await mover('diana', t.id, 'en_revision')).status).toBe(200);
    expect((await request.patch(`/api/tasks/${t.id}/approve`).set(como('admin'))).status).toBe(403);
    expect((await request.patch(`/api/tasks/${t.id}/approve`).set(como('jesus'))).status).toBe(200);
  });
});

describe('el tablero, por equipo', () => {
  it('«Sin equipo» trae las que no tienen; uno concreto, solo las suyas', async () => {
    const sin = (await request.get('/api/tasks?team_id=0').set(como('diana'))).body.data;
    expect(sin.map((x) => x.title)).toContain(`${MARCA} De Diana sin equipo`);
    expect(sin.every((x) => x.team_id == null)).toBe(true);
    const del = (await request.get(`/api/tasks?team_id=${equipo.id}`).set(como('diana'))).body.data;
    expect(del.every((x) => x.team_id === equipo.id)).toBe(true);
  });

  it('archivar el equipo lo saca de los equipos de cada uno', async () => {
    expect((await request.patch(`/api/tasks/teams/${equipo.id}`).set(como('admin')).send({ is_active: false })).status).toBe(200);
    expect((await request.get('/api/tasks/teams/mine').set(como('diana'))).body.data).toEqual([]);
    expect((await crear('julian', { title: 'x', team_id: equipo.id })).status).toBe(400);
  });
});
