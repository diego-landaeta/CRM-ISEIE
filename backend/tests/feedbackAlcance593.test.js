import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../src/shared/config/db.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';
import feedbackModule from '../src/modules/feedback/index.js';

/**
 * Hasta dónde llega cada uno en el feedback de un prospecto (#593), por la
 * ruta de verdad y contra la base:
 *   · un admin, solo en SUS campus: antes uno de CEDIA leía y decidía el
 *     correo de un prospecto de ICTESS;
 *   · una project_manager, solo los que lleva («solo lo suyo», Diego
 *     02/11/2026, `soloLoSuyo` en roles.js), como una gestora;
 *   · una gestora, solo los que lleva;
 *   · un id que no es un número es un 400, no un 500.
 */

const marca = `a593${Date.now()}`;
const ids = { users: [], projects: [], leads: [] };
let hayBase = true;
let porQueNo = null;
const U = {};
const P = {};
const L = {};

const uno = async (sql, p) => (await query(sql, p)).rows[0];

const app = express();
app.use(express.json());
app.use(feedbackModule.prefix, feedbackModule.router);
app.use(errorHandler);
const como = (clave) => {
  const token = jwt.sign({ userId: U[clave].id, role: U[clave].role }, process.env.JWT_SECRET);
  return (url) => supertest(app).get(url).set('Authorization', `Bearer ${token}`);
};

beforeAll(async () => {
  try {
    for (const c of ['Cedia', 'Ictess']) {
      P[c] = (await uno('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
        [`${c} ${marca}`, `${c.toLowerCase()}-${marca}`, `${c}-${marca}-key`])).id;
      ids.projects.push(P[c]);
    }
    for (const [clave, role, campus] of [
      ['adminCedia', 'admin', 'Cedia'], ['pmCedia', 'project_manager', 'Cedia'],
      ['gestora', 'gestor', 'Cedia'], ['otraGestora', 'gestor', 'Cedia'], ['super', 'superadmin', null],
    ]) {
      const u = await uno("INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role",
        [`${clave} ${marca}`, `${clave.toLowerCase()}@${marca}.test`, role]);
      ids.users.push(u.id);
      U[clave] = u;
      if (campus) await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [u.id, P[campus]]);
    }
    for (const [clave, campus] of [['deCedia', 'Cedia'], ['deIctess', 'Ictess']]) {
      L[clave] = (await uno('INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [P[campus], `${clave} ${marca}`, `${clave.toLowerCase()}@${marca}.test`, U.gestora.id])).id;
      ids.leads.push(L[clave]);
    }
    L.dePm = (await uno('INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [P.Cedia, `dePm ${marca}`, `depm@${marca}.test`, U.pmCedia.id])).id;
    ids.leads.push(L.dePm);
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const [sql, p] of [
    ['DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
});

describe('el feedback de un prospecto, según quién lo mira (#593)', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });

  it('el admin de CEDIA ve los de CEDIA y no los de ICTESS', async () => {
    if (!hayBase) return;
    expect((await como('adminCedia')(`/api/feedback/lead/${L.deCedia}`)).status).toBe(200);
    expect((await como('adminCedia')(`/api/feedback/lead/${L.deIctess}`)).status).toBe(403);
  });

  it('la project_manager, solo los que lleva', async () => {
    if (!hayBase) return;
    expect((await como('pmCedia')(`/api/feedback/lead/${L.dePm}`)).status).toBe(200);
    expect((await como('pmCedia')(`/api/feedback/lead/${L.deCedia}`)).status).toBe(403);
    expect((await como('pmCedia')(`/api/feedback/lead/${L.deIctess}`)).status).toBe(403);
  });

  it('la gestora, solo los que lleva', async () => {
    if (!hayBase) return;
    expect((await como('gestora')(`/api/feedback/lead/${L.deCedia}`)).status).toBe(200);
    expect((await como('otraGestora')(`/api/feedback/lead/${L.deCedia}`)).status).toBe(403);
  });

  it('el super admin, todos', async () => {
    if (!hayBase) return;
    expect((await como('super')(`/api/feedback/lead/${L.deIctess}`)).status).toBe(200);
  });

  it('la encuesta de una vista previa no se puede contestar, aunque se quite «?vista=1»', async () => {
    if (!hayBase) return;
    const token = `vista${marca}`.padEnd(24, 'x');
    await query(
      "INSERT INTO feedback_envios (lead_id, project_id, disparador, estado, token, email) VALUES ($1, $2, 'descarte', 'revision', $3, 'x@x.test')",
      [L.deCedia, P.Cedia, token]);
    const pub = express();
    pub.use(express.json());
    pub.use(feedbackModule.publicMount.prefix, feedbackModule.publicMount.router);
    pub.use(errorHandler);
    const r = await supertest(pub).post(`/api/f/${token}`).send({ respuestas: { motivo: 'precio' } });
    expect(r.status).toBe(409);
    const { rows: [f] } = await query('SELECT respondido_at FROM feedback_envios WHERE token = $1', [token]);
    expect(f.respondido_at).toBeNull();
    await query('DELETE FROM feedback_envios WHERE token = $1', [token]);
  });

  it('pasado el límite de intentos, la encuesta recibe JSON en español', async () => {
    if (!hayBase) return;
    const pub = express();
    pub.use(express.json());
    pub.use(feedbackModule.publicMount.prefix, feedbackModule.publicMount.router);
    let r;
    for (let i = 0; i < 32; i += 1) r = await supertest(pub).get('/api/f/no-existe-este-token-de-prueba');
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ success: false, code: 'RATE_LIMIT' });
    expect(r.body.error).toMatch(/demasiados intentos/);
  });

  it('un id que no es un número es un 400, y uno que no existe un 404', async () => {
    if (!hayBase) return;
    expect((await como('super')('/api/feedback/lead/abc')).status).toBe(400);
    expect((await como('super')('/api/feedback/lead/999999999')).status).toBe(404);
  });
});
