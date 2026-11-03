import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Gemela de CRM#644. Tony (admin de ICTESS en el 360, 03/11) intentó dar de alta a una persona cinco veces
 * y cinco veces le salió «Ese rol le daría lo que tú no tienes»: había elegido
 * «Soporte», que trae permisos que un admin no tiene. La regla del servidor
 * está bien (#423, punto 7); lo que fallaba era el formulario, que ofrecía
 * todos los roles. Ahora pregunta antes cuáles puede dar
 * (GET /api/users/roles-asignables), con la MISMA regla que el alta.
 *
 * Contra la base de verdad, con gente propia y sin superadmin en la base.
 */

vi.mock('../src/shared/services/brevo.service.js', async (original) => ({
  ...(await original()), sendWelcomeUserEmail: vi.fn(async () => ({ sent: true })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const { default: usuarios } = await import('../src/modules/users/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { olvidarPermisos } = await import('../src/modules/permissions/permissions.service.js');
const { rolesAsignables } = await import('../src/modules/permissions/permissions.editar.js');

const app = express();
app.use(express.json());
app.use(usuarios.prefix, usuarios.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `RASIG${Date.now().toString(36)}`;
const dominio = `${MARCA.toLowerCase()}.test`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
let CAMPUS;
const U = {};

async function persona(nombre, role) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role::text AS role`,
    [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${dominio}`, role]);
  await q('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [u.id, CAMPUS]);
  return u;
}

/** { rol: { principal, anadido } } de la respuesta, para leer las pruebas de un vistazo. */
const porRol = (lista) => Object.fromEntries(lista.map((r) => [r.rol, r]));

beforeAll(async () => {
  const [c] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`]);
  CAMPUS = c.id;
  U.admin = await persona('Admin', 'admin');
  U.soporte = await persona('Soporte', 'soporte');
  U.gestora = await persona('Gestora', 'gestor');
  olvidarPermisos();
}, 60000);

afterAll(async () => {
  const ids = (await q('SELECT id FROM users WHERE email LIKE $1', [`%@${dominio}`])).map((r) => r.id);
  await q('DELETE FROM permisos_registro WHERE usuario_id = ANY($1::int[])', [ids]).catch(() => {});
  await q(`DELETE FROM user_activity_log WHERE user_id = ANY($1::int[]) OR (details->>'usuario_id')::int = ANY($1::int[])`, [ids]);
  await q('DELETE FROM tutor_profiles WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  if (CAMPUS) await q('DELETE FROM projects WHERE id = $1', [CAMPUS]);
  await pool.end();
}, 60000);

describe('GET /api/users/roles-asignables (Tony, 03/11)', () => {
  it('sin sesión, 401; sin permiso de alta, 403', async () => {
    expect((await request.get('/api/users/roles-asignables')).status).toBe(401);
    expect((await request.get('/api/users/roles-asignables').set(como(U.gestora))).status).toBe(403);
  });

  it('un admin no puede dar «soporte», ni como principal ni como añadido, y se le dice qué le falta', async () => {
    const r = await request.get('/api/users/roles-asignables').set(como(U.admin));
    expect(r.status).toBe(200);
    const sop = porRol(r.body.data).soporte;
    expect(sop.principal.puede).toBe(false);
    expect(sop.anadido.puede).toBe(false);
    expect(sop.principal.faltan.length).toBeGreaterThan(0);
    expect(sop.principal.faltan.length).toBeLessThanOrEqual(3);
    expect(sop.principal.faltan).toContain('Recuperar prospectos borrados');
  });

  it('un admin sí puede dar admin, gestora, colaborador y tutor', async () => {
    const roles = porRol((await request.get('/api/users/roles-asignables').set(como(U.admin))).body.data);
    for (const rol of ['admin', 'gestor', 'colaborador', 'tutor']) {
      expect(roles[rol].principal, `${rol} como principal`).toEqual({ puede: true, faltan: [], cuantos: 0 });
      expect(roles[rol].anadido.puede, `${rol} como añadido`).toBe(true);
    }
  });

  it('soporte puede dar admin, gestora y colaborador en el alta (decisión de Diego, 26/10)', async () => {
    const roles = porRol((await request.get('/api/users/roles-asignables').set(como(U.soporte))).body.data);
    for (const rol of ['admin', 'gestor', 'colaborador']) {
      expect(roles[rol].principal.puede, `${rol} como principal`).toBe(true);
      expect(roles[rol].anadido.puede, `${rol} como añadido`).toBe(true);
    }
  });

  it('el superadmin puede darlo todo', async () => {
    const lista = await rolesAsignables({ userId: U.admin.id, role: 'superadmin', roles_extra: [] });
    expect(lista.length).toBeGreaterThanOrEqual(7);
    for (const r of lista) {
      expect(r.principal.puede, r.rol).toBe(true);
      expect(r.anadido.puede, r.rol).toBe(true);
    }
  });

  it('dice lo mismo que el alta: lo que sale «no» en la lista, el alta lo rechaza y dice qué rol quitar', async () => {
    const r = await request.post('/api/users').set(como(U.admin))
      .send({ nombre: `${MARCA} Nueva`, email: `nueva@${dominio}`, role: 'gestor', roles_extra: ['soporte'], projectIds: [CAMPUS] });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('NO_LO_TIENES');
    expect(r.body.data.roles).toEqual(['soporte']);
    expect(r.body.data.faltan.length).toBeGreaterThan(0);
  });
});
