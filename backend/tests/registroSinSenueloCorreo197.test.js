import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #197 · El registro y «Actividad» no dejan ver si un correo ya es de otra persona.
 * (El mismo filtro que CRM#1199; aquí va con el cambio de correo, que es quien
 * escribe el señuelo, para que no llegue nunca sin él.)
 *
 * Al pedir un código de cambio de correo para una dirección que ya tiene
 * cuenta, `pedirCodigo` responde igual que con una libre y guarda una petición
 * señuelo; pero anota en `user_activity_log` por qué no mandó el código
 * (`no_mandado`). Sin filtro, el registro enseñaría ese detalle entero a quien
 * lo mira, también a un admin de campus: bastaría pedir un cambio a una dirección y leer
 * el registro para saber si esa dirección tiene cuenta en el CRM.
 *
 * ISEIE tiene además la pantalla «Actividad» (GET /api/users/activity-log),
 * con el mismo detalle: pasa por el mismo filtro.
 *
 * Lo que defiende: a un admin de campus no le llega `no_mandado`, ni en el
 * registro ni en «Actividad»; a soporte (ve el CRM entero) sí; una petición
 * normal se ve igual para los dos.
 *
 * Contra la base local. Brevo, simulado: no sale ningún correo.
 */

vi.mock('../src/shared/services/brevo.service.js', async (original) => ({
  ...(await original()),
  sendCodigoCambioCorreoEmail: vi.fn(async () => ({ sent: true })),
  sendCorreoCambiadoEmail: vi.fn(async () => ({ sent: true })),
  sendEmail: vi.fn(async () => ({ sent: true })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { pedirCodigo } = await import('../src/modules/users/cambio-de-correo.js');
const { default: usersModule } = await import('../src/modules/users/index.js');
const { default: registroModule } = await import('../src/modules/registro/index.js');

const app = express();
app.use(express.json());
app.use(usersModule.prefix, usersModule.router);
app.use(registroModule.prefix, registroModule.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `RSC197${Date.now().toString(36)}`.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
let SOPORTE; let ADMIN; let ANA; let OTRA;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
// El código sale sin esperar: se deja correr la cola.
const pedir = async (args) => { const r = await pedirCodigo(args); await new Promise((ok) => setImmediate(ok)); return r; };
const filaDelPedido = async (quien) => {
  const res = await request.get(`/api/registro?usuarioId=${ANA.id}&fuentes=usuario`).set(como(quien));
  expect(res.status).toBe(200);
  return res.body.data.filas.find((f) => f.accion === 'usuario.pedir_cambio_correo');
};

beforeAll(async () => {
  const campus = async (n) => {
    const p = await one(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${n}`, `${MARCA}-${n}`, `${MARCA}-k-${n}`]);
    ids.projects.push(p.id); return p.id;
  };
  const A = await campus('a'); const C = await campus('c');
  const persona = async (n, role, suyos) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role, email`,
      [`${MARCA} ${n}`, `${n}@${MARCA}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  // Sin superadmin de prueba: otras pruebas cuentan los de la base mientras
  // corren a la vez. Soporte lo ve todo igual.
  SOPORTE = await persona('soporte', 'soporte', []);
  ADMIN = await persona('admin', 'admin', [A]);
  ANA = await persona('ana', 'gestor', [A]);
  OTRA = await persona('otra', 'gestor', [C]);
}, 60000);

beforeEach(async () => {
  await q('DELETE FROM cambios_de_correo WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [ids.users]);
});

afterAll(async () => {
  await q('DELETE FROM cambios_de_correo WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
});

describe('el registro no delata que una dirección ya tiene cuenta', () => {
  it('a un admin de su campus no le dice que la dirección ya era de otra persona; a soporte, sí', async () => {
    await pedir({ userId: ANA.id, emailNuevo: OTRA.email });
    const delAdmin = await filaDelPedido(ADMIN);
    expect(delAdmin).toBeTruthy();
    expect(delAdmin.detalle).toMatchObject({ usuario_id: ANA.id, a: OTRA.email });
    expect(JSON.stringify(delAdmin)).not.toMatch(/no_mandado|otro usuario/);
    const deSoporte = await filaDelPedido(SOPORTE);
    expect(deSoporte.detalle.no_mandado).toMatch(/otro usuario/);
  });

  it('y una petición normal se ve igual para los dos', async () => {
    await pedir({ userId: ANA.id, emailNuevo: `ana.normal@${MARCA}.test` });
    const delAdmin = await filaDelPedido(ADMIN);
    const deSoporte = await filaDelPedido(SOPORTE);
    expect(delAdmin).toBeTruthy();
    expect(delAdmin.detalle).toEqual(deSoporte.detalle);
  });

  it('ni la pantalla «Actividad»: al admin, sin el porqué; a soporte, con él', async () => {
    await pedir({ userId: ANA.id, emailNuevo: OTRA.email });
    const actividad = async (quien) => {
      const res = await request.get(`/api/users/activity-log?userId=${ANA.id}&action=usuario.pedir_cambio_correo`).set(como(quien));
      expect(res.status).toBe(200);
      return res.body.data[0];
    };
    const delAdmin = await actividad(ADMIN);
    expect(delAdmin.details).toMatchObject({ usuario_id: ANA.id, a: OTRA.email });
    expect(JSON.stringify(delAdmin)).not.toMatch(/no_mandado|otro usuario/);
    expect((await actividad(SOPORTE)).details.no_mandado).toMatch(/otro usuario/);
  });
});
