import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * #346 · /auth/me dice qué campus son de pruebas (`es_prueba`), para que el
 * frontal los deje fuera de «Todos» como hace el servidor (`SIN_PRUEBAS`).
 *
 *   npx vitest run tests/campusDePruebas346.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { getUserProjects } = await import('../src/modules/auth/auth.model.js');

const MARCA = `C346${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [] };
let NORMAL; let PRUEBAS; let ADMIN;

beforeAll(async () => {
  const proy = async (c, prueba) => {
    const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key, es_prueba) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`, prueba]);
    ids.projects.push(p.id);
    return p.id;
  };
  NORMAL = await proy('normal', false);
  PRUEBAS = await proy('pruebas', true);
  [ADMIN] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id`,
    [`${MARCA} admin`, `admin@${MARCA.toLowerCase()}.test`]);
  ids.users.push(ADMIN.id);
  for (const p of [NORMAL, PRUEBAS]) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [ADMIN.id, p]);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
}, 60000);

describe('/auth/me: es_prueba en cada campus (#346)', () => {
  it('a un admin, con sus campus asignados', async () => {
    const suyos = await getUserProjects(ADMIN.id, 'admin');
    const de = (id) => suyos.find((p) => p.id === id);
    expect(de(NORMAL).es_prueba).toBe(false);
    expect(de(PRUEBAS).es_prueba).toBe(true);
  });

  it('al superadmin, con todos', async () => {
    const todos = await getUserProjects(0, 'superadmin');
    expect(todos.find((p) => p.id === PRUEBAS).es_prueba).toBe(true);
    expect(todos.find((p) => p.id === NORMAL).es_prueba).toBe(false);
  });
});
