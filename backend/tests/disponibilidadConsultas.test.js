import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../src/shared/config/db.js';
import { tutoresQueRecibenConsultas } from '../src/modules/tutores/tutor.campus.js';
import tutorRoutes from '../src/modules/tutores/tutor.routes.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';

/**
 * «No disponible» de Consultas, separado del reparto de prospectos (QA de
 * Diego, 22/10, punto 6), contra la base de verdad.
 *
 * «"No disponible" usa `users.is_available`, que es la misma columna del
 * reparto de prospectos. Usa una propia.»
 *
 * Con una gestora que además es tutora, que es donde se cruzaban:
 *   · ponerla «no disponible» en Consultas no la saca del reparto;
 *   · y deja de recibir consultas;
 *   · sacarla del reparto (Usuarios › Disponibilidad) no le quita las consultas.
 */

const marca = `t6qa${Date.now()}`;
const ids = { users: [], projects: [] };
let hayBase = true;
let porQueNo = null;
const g = {};

async function crearUsuario(role, extra = null) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, roles_extra, active)
     VALUES ($1, $2, 'x', $3, COALESCE($4::user_role[], '{}'), true) RETURNING id`,
    [`${role} ${marca}`, `${role}.${ids.users.length}.${marca}@test.local`, role, extra]
  );
  ids.users.push(rows[0].id);
  return Number(rows[0].id);
}

beforeAll(async () => {
  try {
    const t = await query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'consultas_disponible'");
    if (!t.rows.length) throw new Error('Falta la migración 223 (consultas_disponible).');
    const { rows } = await query(
      `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
      [`Campus ${marca}`, `campus-${marca}`, `k-${marca}`]);
    g.campus = Number(rows[0].id);
    ids.projects.push(g.campus);
    g.admin = await crearUsuario('admin');
    g.gestoraTutora = await crearUsuario('gestor', ['tutor']);
    for (const u of [g.admin, g.gestoraTutora]) {
      await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [u, g.campus]);
    }
    // Matriculada y activa en el campus: puede recibir consultas.
    await query(`INSERT INTO tutor_campus (tutor_id, project_id, estado) VALUES ($1, $2, 'activa')`, [g.gestoraTutora, g.campus]);
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const [sql, p] of [
    ['DELETE FROM tutor_campus WHERE tutor_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM activity_log WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
});

const app = express();
app.use(express.json());
app.use('/api/tutores', tutorRoutes);
app.use(errorHandler);
const comoAdmin = () => ({ Authorization: `Bearer ${jwt.sign({ userId: g.admin, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' })}` });

const columnas = async () => (await query(
  'SELECT is_available, consultas_disponible, consultas_no_disponible_motivo FROM users WHERE id = $1', [g.gestoraTutora])).rows[0];
const recibe = async () => (await tutoresQueRecibenConsultas(g.campus)).some((t) => t.id === g.gestoraTutora);

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe.runIf(hayBase).sequential('«No disponible» de Consultas, separado del reparto', () => {
  it('de inicio, en el reparto y recibiendo consultas', async () => {
    expect(await columnas()).toMatchObject({ is_available: true, consultas_disponible: true });
    expect(await recibe()).toBe(true);
  });

  it('«no disponible» en Consultas: no recibe consultas y sigue en el reparto', async () => {
    const r = await supertest(app).patch(`/api/tutores/${g.gestoraTutora}/disponible`).set(comoAdmin())
      .send({ disponible: false, motivo: 'Vacaciones' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ disponible: false, motivo_no_disponible: 'Vacaciones' });
    expect(await columnas()).toMatchObject({ is_available: true, consultas_disponible: false, consultas_no_disponible_motivo: 'Vacaciones' });
    expect(await recibe()).toBe(false);
  });

  it('vuelve a estar disponible en Consultas', async () => {
    const r = await supertest(app).patch(`/api/tutores/${g.gestoraTutora}/disponible`).set(comoAdmin())
      .send({ disponible: true });
    expect(r.body.data.disponible).toBe(true);
    expect(await recibe()).toBe(true);
  });

  it('fuera del reparto de prospectos: sigue recibiendo consultas y su ficha dice disponible', async () => {
    await query('UPDATE users SET is_available = false WHERE id = $1', [g.gestoraTutora]);
    expect(await recibe()).toBe(true);
    const r = await supertest(app).get(`/api/tutores/${g.gestoraTutora}/campus`).set(comoAdmin());
    expect(r.body.data.disponible).toBe(true);
  });
});
