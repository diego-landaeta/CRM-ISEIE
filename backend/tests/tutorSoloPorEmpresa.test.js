import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../src/shared/config/db.js';
import tutorRoutes from '../src/modules/tutores/tutor.routes.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';

/**
 * Un tutor dado de alta solo por empresa, contra la base de verdad (QA de
 * Diego, 22/10, punto 7).
 *
 * «`tutor_empresas` va en paralelo a `user_empresas`: un tutor solo por empresa
 * da 404 en su ficha.» Su empresa le da los campus al consultar (#187), sin
 * filas en `user_projects`, y la ficha solo miraba `user_projects`.
 *
 *   · el admin de un campus de su empresa abre su ficha y su panel de campus;
 *   · el admin de otra empresa sigue sin verlo («no encontrado»);
 *   · y en la lista de Tutores pasa lo mismo: sale para su empresa, no para otra.
 */

const marca = `t7qa${Date.now()}`;
const ids = { users: [], projects: [], issuers: [] };
let hayBase = true;
let porQueNo = null;
const g = {};

async function crearUsuario(role) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active)
     VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${role} ${marca}`, `${role}.${ids.users.length}.${marca}@test.local`, role]
  );
  ids.users.push(rows[0].id);
  return Number(rows[0].id);
}

async function crearEmpresa(nombre) {
  const { rows } = await query(
    `INSERT INTO invoice_issuers (razon_social, nif, pais, activo) VALUES ($1, $2, 'España', true) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre}${marca}`.slice(0, 20)]
  );
  ids.issuers.push(rows[0].id);
  return Number(rows[0].id);
}

async function crearCampus(nombre, issuerId) {
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active, sociedad_emisora_id)
     VALUES ($1, $2, $3, true, $4) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre.toLowerCase()}-${marca}`, `k-${marca}-${ids.projects.length}`, issuerId]
  );
  ids.projects.push(rows[0].id);
  return Number(rows[0].id);
}

const darCampus = (userId, projectId) => query(
  'INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [userId, projectId]);

beforeAll(async () => {
  try {
    const t = await query("SELECT to_regclass('public.tutor_empresas') AS a");
    if (!t.rows[0].a) throw new Error('Falta la migración 208 (tutor_empresas).');
    const cedia = await crearEmpresa('CEDIA');
    const otra = await crearEmpresa('Otra');
    g.campusCedia = await crearCampus('Iseih', cedia);
    g.campusOtra = await crearCampus('Ajeno', otra);
    g.adminCedia = await crearUsuario('admin');
    g.adminOtra = await crearUsuario('admin');
    await darCampus(g.adminCedia, g.campusCedia);
    await darCampus(g.adminOtra, g.campusOtra);
    // El tutor: SOLO por empresa, ningún campus puesto a mano.
    g.tutor = await crearUsuario('tutor');
    await query('INSERT INTO tutor_empresas (tutor_id, issuer_id) VALUES ($1, $2)', [g.tutor, cedia]);
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const [sql, p] of [
    ['DELETE FROM tutor_empresas WHERE tutor_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]],
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
const como = (userId) => ({ Authorization: `Bearer ${jwt.sign({ userId, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' })}` });
const get = (url, userId) => supertest(app).get(url).set(como(userId));

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe.runIf(hayBase)('tutor solo por empresa', () => {
  it('el admin de un campus de su empresa abre su ficha', async () => {
    const r = await get(`/api/tutores/${g.tutor}`, g.adminCedia);
    expect(r.status).toBe(200);
    expect(r.body.data.id).toBe(g.tutor);
  });

  it('y su panel de campus, con el campus que le llega por la empresa', async () => {
    const r = await get(`/api/tutores/${g.tutor}/campus`, g.adminCedia);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body.data)).toContain(String(g.campusCedia));
  });

  it('el admin de otra empresa sigue sin verlo', async () => {
    expect((await get(`/api/tutores/${g.tutor}`, g.adminOtra)).status).toBe(404);
    expect((await get(`/api/tutores/${g.tutor}/campus`, g.adminOtra)).status).toBe(404);
  });

  // Y en la LISTA de Tutores, que tampoco miraba `tutor_empresas`.
  it('sale en la lista del campus de su empresa, como de ese campus', async () => {
    const r = await get(`/api/tutores?projectId=${g.campusCedia}`, g.adminCedia);
    expect(r.status).toBe(200);
    const suyo = r.body.data.find((t) => Number(t.id) === g.tutor);
    expect(suyo).toBeDefined();
    expect(suyo.es_de_este_proyecto).toBe(true);
  });

  it('y no sale en la lista de otra empresa', async () => {
    const r = await get(`/api/tutores?projectId=${g.campusOtra}`, g.adminOtra);
    expect(r.status).toBe(200);
    expect(r.body.data.some((t) => Number(t.id) === g.tutor)).toBe(false);
  });
});
