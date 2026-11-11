import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool from '../src/shared/config/db.js';

/**
 * CRM-ISEIE#419 (gemela CRM#707) · «Historial de tareas» por integrante (Diego,
 * 11/11/2026: «que sea individual por integrante también y cada uno lo tenga»).
 *
 * `GET /api/tasks/historial` devuelve, además de la lista, `por_persona`:
 * cuántas tareas hizo cada responsable, con el MISMO alcance y filtros que la
 * lista menos el de persona. Quien mira va primero, aunque tenga 0. En «Mis
 * tareas», solo la suya; en «Mi equipo», las del equipo; en «Todo», las de la
 * empresa; de otra empresa, nada. Elegir una persona no cambia los totales.
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs
 *   npx vitest run tests/tareasHistorialPorPersona419.test.js
 */

const request = supertest(app);
const MARCA = `H419_${Date.now().toString(36)}`;

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

async function equipo(clave, empresa, miembros) {
  const t = await one('INSERT INTO task_teams (issuer_id, name) VALUES ($1, $2) RETURNING id', [E[empresa], `${MARCA} ${clave}`]);
  ids.teams.push(t.id);
  EQ[clave] = t.id;
  const rol = await one(`INSERT INTO task_team_roles (team_id, name, level) VALUES ($1, 'Miembro', 1) RETURNING id`, [t.id]);
  for (const quien of miembros) {
    await q('INSERT INTO task_team_members (team_id, user_id, team_role_id) VALUES ($1, $2, $3)', [t.id, U[quien].id, rol.id]);
  }
}

const como = (clave) => ({ Authorization: `Bearer ${T[clave]}` });
// Siempre con la marca: así solo cuentan las tareas de esta prueba.
const historial = (quien, query = '') => request.get(`/api/tasks/historial?search=${MARCA}${query}`).set(como(quien));
const fichas = (res) => res.body.por_persona.map((f) => [f.id, f.total]);

/** Una tarea hecha: la crea quien se diga, para quien se diga, y la cierra quien la lleva. */
async function hecha(creador, responsable, titulo) {
  const res = await request.post('/api/tasks').set(como(creador))
    .send({ title: `${MARCA} ${titulo}`, ...(creador === responsable ? {} : { assigned_to: U[responsable].id }) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const mov = await request.patch(`/api/tasks/${res.body.data.id}/move`).set(como(responsable)).send({ status: 'hecha' });
  expect(mov.status, JSON.stringify(mov.body)).toBe(200);
  return res.body.data;
}

beforeAll(async () => {
  for (const clave of ['UNO', 'OTRA']) {
    const s = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} ${clave}`, `${MARCA}-${clave}`]);
    ids.issuers.push(s.id);
    E[clave] = s.id;
  }
  for (const [c, s] of [['A', 'UNO'], ['B', 'UNO'], ['Z', 'OTRA']]) {
    const p = await one(
      'INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c.toLowerCase()}`, `${MARCA}-${c}`, E[s]]
    );
    ids.projects.push(p.id);
    P[c] = p.id;
  }
  await persona('admin', 'admin', { campus: ['A'] });
  // seo1 está en dos campus de la empresa y en la empresa: si se contara con un
  // JOIN a user_projects, sus tareas saldrían multiplicadas.
  await persona('seo1', 'colaborador', { campus: ['A', 'B'], empresas: ['UNO'] });
  await persona('seo2', 'colaborador', { empresas: ['UNO'] });
  await persona('dev1', 'colaborador', { empresas: ['UNO'] });
  await persona('ajeno', 'colaborador', { campus: ['Z'], empresas: ['OTRA'] });

  await equipo('SEO', 'UNO', ['seo1', 'seo2']);
  await equipo('Desarrollo', 'UNO', ['dev1']);
  await equipo('Fuera', 'OTRA', ['ajeno']);

  await hecha('admin', 'seo1', 'Textos de la home');
  await hecha('seo1', 'seo1', 'Metadescripciones');
  await hecha('seo2', 'seo2', 'Enlazado interno');
  for (const t of ['Endpoint', 'Migración', 'Pruebas']) await hecha('admin', 'dev1', t);
  await hecha('ajeno', 'ajeno', 'De otra empresa');
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

describe('«Todo» (con «Ver todo»): las de la empresa', () => {
  it('una ficha por persona con cuántas hizo; quien mira, primero aunque tenga 0; el resto de más a menos', async () => {
    const res = await historial('admin', `&ver=todo&issuerId=${E.UNO}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(fichas(res)).toEqual([[U.admin.id, 0], [U.dev1.id, 3], [U.seo1.id, 2], [U.seo2.id, 1]]);
    expect(res.body.por_persona[0].nombre).toBe(`${MARCA} admin`);
    expect(res.body.por_persona[1].nombre).toBe(`${MARCA} dev1`);
    // Cuadra con la lista: la suma de las fichas es el total de lo hecho.
    expect(res.body.por_persona.reduce((s, f) => s + f.total, 0)).toBe(res.body.pagination.total);
  });

  it('elegir una persona filtra la lista pero no cambia las fichas', async () => {
    const todas = await historial('admin', `&ver=todo&issuerId=${E.UNO}`);
    const deSeo1 = await historial('admin', `&ver=todo&issuerId=${E.UNO}&assigned_to=${U.seo1.id}`);
    expect(deSeo1.body.por_persona).toEqual(todas.body.por_persona);
    expect(deSeo1.body.pagination.total).toBe(2);
    expect(deSeo1.body.data.every((x) => x.assigned_to === U.seo1.id)).toBe(true);
  });

  it('los demás filtros sí cuentan: equipo y periodo', async () => {
    const seo = await historial('admin', `&ver=todo&issuerId=${E.UNO}&team_id=${EQ.SEO}`);
    expect(fichas(seo)).toEqual([[U.admin.id, 0], [U.seo1.id, 2], [U.seo2.id, 1]]);
    const antes = await historial('admin', `&ver=todo&issuerId=${E.UNO}&desde=2020-01-01&hasta=2020-01-31`);
    expect(fichas(antes)).toEqual([[U.admin.id, 0]]);
  });

  it('otra empresa no sale', async () => {
    const res = await historial('admin', `&ver=todo&issuerId=${E.UNO}`);
    expect(res.body.por_persona.map((f) => f.id)).not.toContain(U.ajeno.id);
    const ajeno = await historial('ajeno', '&ver=todo');
    expect(fichas(ajeno)).toEqual([[U.ajeno.id, 1]]);
  });
});

describe('«Mis tareas» y «Mi equipo»', () => {
  it('«Mis tareas»: solo la ficha propia', async () => {
    const res = await historial('seo1', '&ver=mias');
    expect(fichas(res)).toEqual([[U.seo1.id, 2]]);
    // Con la persona elegida, igual.
    const conPersona = await historial('seo1', `&ver=mias&assigned_to=${U.seo1.id}`);
    expect(fichas(conPersona)).toEqual([[U.seo1.id, 2]]);
  });

  it('«Mi equipo»: las de su equipo, y nada de otro equipo ni de otra empresa', async () => {
    const res = await historial('seo2', '&ver=equipo');
    expect(fichas(res)).toEqual([[U.seo2.id, 1], [U.seo1.id, 2]]);
    const conPersona = await historial('seo2', `&ver=equipo&assigned_to=${U.seo1.id}`);
    expect(conPersona.body.por_persona).toEqual(res.body.por_persona);
    expect(conPersona.body.pagination.total).toBe(2);
  });

  it('«Todo» sin «Ver todo» no abre más que «Mi equipo»', async () => {
    const res = await historial('dev1', '&ver=todo');
    expect(fichas(res)).toEqual([[U.dev1.id, 3]]);
    // Ni pidiendo a alguien de otro equipo: la lista sale vacía y las fichas, las mismas.
    const otra = await historial('dev1', `&ver=todo&assigned_to=${U.seo1.id}`);
    expect(otra.body.data).toEqual([]);
    expect(fichas(otra)).toEqual([[U.dev1.id, 3]]);
  });
});
