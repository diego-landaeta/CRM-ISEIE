import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * La lista de prospectos, solo de sus campus.
 *
 * `GET /api/leads` no pasaba por `projectAccess` ni miraba `user_projects`: un
 * admin de un campus pedía `?projectId=` de otro y le llegaban sus prospectos,
 * con nombre, correo y teléfono. Lo vio la revisión del buscador (#591), que
 * busca personas por esta ruta.
 *
 *   npx vitest run tests/leadsAmbito.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/leads/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `LAM${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], leads: [] };
let P; let OTRO; let ADMIN; let SOPORTE; let DE_P; let DEL_OTRO;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const lista = (u, ambito) => request.get(`/api/leads?${ambito}&limit=50`).set(como(u));
const idsDe = (r) => r.body.data.map((l) => l.id);

async function persona(n, role, campus = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, c]);
  return u;
}
async function lead(projectId, nombre) {
  const [l] = await q(`INSERT INTO leads (project_id, nombre, email, telefono) VALUES ($1, $2, $3, '+34600000000') RETURNING id`,
    [projectId, `${MARCA} ${nombre}`, `${nombre.toLowerCase()}@lead.${MARCA.toLowerCase()}.test`]);
  ids.leads.push(l.id);
  return l.id;
}

beforeAll(async () => {
  const proy = async (c) => {
    const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  P = await proy('a'); OTRO = await proy('b');
  ADMIN = await persona('ADMIN', 'admin', [P]);
  SOPORTE = await persona('SOPORTE', 'soporte');
  DE_P = await lead(P, 'Ana');
  DEL_OTRO = await lead(OTRO, 'Lucia');
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

describe('la lista de prospectos, solo de sus campus', () => {
  it('su campus, como siempre', async () => {
    const r = await lista(ADMIN, `projectId=${P}`);
    expect(r.status).toBe(200);
    expect(idsDe(r)).toEqual([DE_P]);
  });

  it('un campus que no es suyo: 403', async () => {
    expect((await lista(ADMIN, `projectId=${OTRO}`)).status).toBe(403);
  });

  it('en una lista de campus, los ajenos se caen', async () => {
    const r = await lista(ADMIN, `projectIds=${P},${OTRO}`);
    expect(r.status).toBe(200);
    expect(idsDe(r)).toEqual([DE_P]);
  });

  it('con solo campus ajenos, nada (nunca «todos»)', async () => {
    const r = await lista(ADMIN, `projectIds=${OTRO}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  it('soporte ve todos los campus', async () => {
    expect(idsDe(await lista(SOPORTE, `projectId=${OTRO}`))).toEqual([DEL_OTRO]);
  });
});
