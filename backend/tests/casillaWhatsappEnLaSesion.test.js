import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import { query } from '../src/shared/config/db.js';
import authRoutes from '../src/modules/auth/auth.routes.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';

/**
 * La casilla «usa WhatsApp», en la sesión (QA de Diego, 22/10, punto 8).
 *
 * «No llamar para quien no tiene WhatsApp.» No lo tiene quien no puede por su
 * rol (el tutor) ni quien lo tiene apagado en su ficha: a los dos el servidor
 * les contesta 403. Para que la pantalla no pregunte nunca, tiene que saber la
 * casilla desde que se entra: en el login y en «quién soy» (/me).
 */

const marca = `wa8qa${Date.now()}`;
const ids = [];
let hayBase = true;
let porQueNo = null;
const CLAVE = 'Prueba-casilla-8!';

async function crear(usaWhatsapp) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, $3, 'gestor', true) RETURNING id, email`,
    [`Gestora ${marca}`, `gestora.${ids.length}.${marca}@test.local`, await bcrypt.hash(CLAVE, 4)]);
  ids.push(rows[0].id);
  await query('UPDATE users SET usa_whatsapp = $2 WHERE id = $1', [rows[0].id, usaWhatsapp]);
  return rows[0].email;
}

const g = {};
beforeAll(async () => {
  try {
    g.apagada = await crear(false);
    g.encendida = await crear(true);
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const sql of [
    'DELETE FROM user_refresh_tokens WHERE user_id = ANY($1::int[])',
    'DELETE FROM activity_log WHERE user_id = ANY($1::int[])',
    'DELETE FROM users WHERE id = ANY($1::int[])',
  ]) {
    try { await query(sql, [ids]); } catch { /* sigue limpiando */ }
  }
});

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use(errorHandler);

async function entrar(email) {
  const r = await supertest(app).post('/api/auth/login').send({ email, password: CLAVE });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data;
}

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe.runIf(hayBase)('la casilla «usa WhatsApp» llega a la pantalla', () => {
  it('apagada: en el login y en /me dice false', async () => {
    const d = await entrar(g.apagada);
    expect(d.user.usa_whatsapp).toBe(false);
    const me = await supertest(app).get('/api/auth/me').set('Authorization', `Bearer ${d.accessToken}`);
    expect(me.body.data.user.usa_whatsapp).toBe(false);
  });

  it('encendida: true', async () => {
    const d = await entrar(g.encendida);
    expect(d.user.usa_whatsapp).toBe(true);
    const me = await supertest(app).get('/api/auth/me').set('Authorization', `Bearer ${d.accessToken}`);
    expect(me.body.data.user.usa_whatsapp).toBe(true);
  });
});
