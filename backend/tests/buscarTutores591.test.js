import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #591 · Buscar tutores desde el buscador (Ctrl K): `GET /api/tutores/buscar`.
 *
 * Quien gestiona colaboraciones (`tutores.gestionar`) encuentra a los tutores de
 * sus campus; super admin, a todos. Y nunca viaja lo sensible de su perfil: ni
 * DNI, ni IBAN, ni banco, ni notas.
 *
 *   npx vitest run tests/buscarTutores591.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/tutores/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `BUT${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [] };
let P; let OTRO; let SUPER; let ADMIN; let GESTORA; let TOMAS_P; let LUCIA_OTRO;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const buscar = (u, texto, extra = '') => request.get(`/api/tutores/buscar?q=${encodeURIComponent(texto)}${extra}`).set(como(u));
const idsDe = (r) => r.body.data.map((x) => x.id);

async function persona(n, role, campus = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${n}`, `${n.toLowerCase().replace(/[^a-z]/g, '')}@${MARCA.toLowerCase()}.test`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, c]);
  return u;
}

beforeAll(async () => {
  await q('CREATE EXTENSION IF NOT EXISTS unaccent');
  const proy = async (c) => {
    const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  P = await proy('a'); OTRO = await proy('b');
  SUPER = await persona('Super', 'superadmin');
  ADMIN = await persona('Admin', 'admin', [P]);
  GESTORA = await persona('Gestora', 'gestor', [P]);
  TOMAS_P = await persona('Tomás Ruiz', 'tutor', [P]);
  LUCIA_OTRO = await persona('Lucía Gómez', 'tutor', [OTRO]);
  await q(`INSERT INTO tutor_profiles (user_id, dni_nif, iban, notas) VALUES ($1, '12345678Z', 'ES9121000418450200051332', 'nota privada')`, [TOMAS_P.id]);
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM tutor_profiles WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

describe('quién encuentra a qué tutor', () => {
  it('el superadmin, a los de todos los campus, sin acentos', async () => {
    const r = await buscar(SUPER, `${MARCA} tomas`);
    expect(r.status).toBe(200);
    expect(idsDe(r)).toEqual([TOMAS_P.id]);
    expect(idsDe(await buscar(SUPER, `${MARCA} lucia`))).toEqual([LUCIA_OTRO.id]);
  });

  it('un admin, solo a los de sus campus', async () => {
    expect(idsDe(await buscar(ADMIN, `${MARCA} tomas`))).toEqual([TOMAS_P.id]);
    expect(idsDe(await buscar(ADMIN, `${MARCA} lucia`))).toEqual([]);
  });

  it('pidiendo un campus que no es suyo, nada', async () => {
    expect((await buscar(ADMIN, MARCA, `&projectIds=${OTRO}`)).body.data).toEqual([]);
  });

  it('sin tutores.gestionar (una gestora): 403', async () => {
    expect((await buscar(GESTORA, `${MARCA} tomas`)).status).toBe(403);
  });

  it('menos de dos letras: 400', async () => {
    expect((await buscar(ADMIN, 't')).status).toBe(400);
  });
});

describe('lo sensible no viaja', () => {
  it('ni DNI, ni IBAN, ni banco, ni notas, ni teléfono', async () => {
    const r = await buscar(SUPER, `${MARCA} tomas`);
    const [t] = r.body.data;
    expect(Object.keys(t).sort()).toEqual(['active', 'email', 'id', 'marcas', 'nombre']);
    expect(JSON.stringify(r.body)).not.toMatch(/12345678Z|ES91|nota privada/);
  });
});
