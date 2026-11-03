import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #218 · Con «Todos los proyectos», el Seguimiento de fin de mes pedía las
 * plantillas de WhatsApp sin campus y, a super admin, el servidor le contestaba
 * «projectId requerido». Ahora: super admin, las de todos los campus (sin los de
 * pruebas); un admin, solo las de sus campus, como ya era.
 *
 *   npx vitest run tests/plantillasTodos218.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/whatsapp/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `PT218${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], plantillas: [] };
let SUPER; let ADMIN; let MIO; let AJENO; let PRUEBAS;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const etiquetas = (r) => r.body.data.map((t) => t.label).filter((l) => l.startsWith(MARCA)).sort();

beforeAll(async () => {
  const campus = async (n, prueba = false) => {
    const p = await one(`INSERT INTO projects (nombre, slug, webhook_api_key, es_prueba) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${MARCA} ${n}`, `${MARCA.toLowerCase()}-${n}`, `${MARCA}-k-${n}`, prueba]);
    ids.projects.push(p.id);
    const t = await one(`INSERT INTO whatsapp_templates (project_id, label, body) VALUES ($1, $2, 'hola') RETURNING id`, [p.id, `${MARCA} ${n}`]);
    ids.plantillas.push(t.id);
    return p.id;
  };
  MIO = await campus('mio'); AJENO = await campus('ajeno'); PRUEBAS = await campus('pruebas', true);
  const persona = async (n, role, suyos) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`, [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  SUPER = await persona('super', 'superadmin', []);
  ADMIN = await persona('admin', 'admin', [MIO]);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM whatsapp_templates WHERE id = ANY($1::int[])', [ids.plantillas]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
}, 60000);

describe('plantillas de WhatsApp con «Todos los proyectos» (#218)', () => {
  it('super admin, sin campus: las de todos, sin las de pruebas (antes, 400)', async () => {
    const r = await request.get('/api/whatsapp/templates').set(como(SUPER));
    expect(r.status).toBe(200);
    expect(etiquetas(r)).toEqual([`${MARCA} ajeno`, `${MARCA} mio`]);
  });

  it('un admin, sin campus: solo las de sus campus, como ya era', async () => {
    const r = await request.get('/api/whatsapp/templates').set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(etiquetas(r)).toEqual([`${MARCA} mio`]);
  });

  it('con un campus elegido, las de ese campus (también el de pruebas, si se elige)', async () => {
    expect(etiquetas(await request.get(`/api/whatsapp/templates?projectId=${PRUEBAS}`).set(como(SUPER)))).toEqual([`${MARCA} pruebas`]);
  });
});
