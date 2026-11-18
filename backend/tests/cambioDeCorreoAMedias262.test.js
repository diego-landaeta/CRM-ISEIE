import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #262, menores: «cambio de correo a medias si después falla `update`».
 *
 * En PATCH /api/users/:id el correo se cambiaba PRIMERO (con sus sesiones
 * revocadas y el aviso a la dirección vieja) y después se guardaba el resto. Si
 * el resto fallaba, la pantalla decía «error» y la persona ya entraba con otro
 * correo. Ahora el correo se comprueba primero y se cambia al final: si algo
 * falla, no cambia nada. Contra la base de verdad.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/cambioDeCorreoAMedias262.test.js
 */

const correos = vi.hoisted(() => ({
  sendWelcomeUserEmail: vi.fn(async () => ({ sent: true })),
  sendCorreoCambiadoEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('../src/shared/services/brevo.service.js', async (original) => ({ ...(await original()), ...correos }));

const { default: pool } = await import('../src/shared/config/db.js');
const { default: usuarios } = await import('../src/modules/users/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(usuarios.prefix, usuarios.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `MEDIAS262${Date.now().toString(36)}`;
const dominio = `${MARCA.toLowerCase()}.test`;
const ids = [];
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

async function persona(nombre, role) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role, email`,
    [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${dominio}`, role]
  );
  ids.push(u.id);
  return u;
}
const sesionAbierta = (u) => q(
  `INSERT INTO user_refresh_tokens (user_id, token_hash, expires_at)
   VALUES ($1, md5(random()::text), NOW() + INTERVAL '1 day')`, [u.id]);
const sesionesAbiertas = async (u) => (await q(
  'SELECT COUNT(*)::int AS n FROM user_refresh_tokens WHERE user_id = $1 AND revoked = false', [u.id]))[0].n;
const fila = async (u) => (await q('SELECT email, nombre, role FROM users WHERE id = $1', [u.id]))[0];

let SUPER; let OTRO_SUPER; let GESTORA; let TUTORA;

beforeAll(async () => {
  SUPER = await persona('SUPER', 'superadmin');
  OTRO_SUPER = await persona('OTROSUPER', 'superadmin');
  GESTORA = await persona('GESTORA', 'gestor');
  TUTORA = await persona('TUTORA', 'tutor');
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM user_activity_log WHERE user_id = ANY($1::int[]) OR (details->>'usuario_id')::int = ANY($1::int[])`, [ids]);
  await q('DELETE FROM user_refresh_tokens WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  await pool.end();
}, 60000);

beforeEach(() => { correos.sendWelcomeUserEmail.mockClear(); correos.sendCorreoCambiadoEmail.mockClear(); });

describe('si el resto del guardado falla, el correo no cambia (#262)', () => {
  it('una empresa entera a una gestora (400): sigue con su correo, sus sesiones y sin aviso', async () => {
    await sesionAbierta(GESTORA);
    const r = await request.patch(`/api/users/${GESTORA.id}`).set(como(SUPER))
      .send({ email: `otra.gestora@${dominio}`, empresaIds: [1] });
    expect(r.status).toBe(400);
    expect((await fila(GESTORA)).email).toBe(GESTORA.email);
    expect(await sesionesAbiertas(GESTORA)).toBeGreaterThan(0);
    expect(correos.sendCorreoCambiadoEmail).not.toHaveBeenCalled();
  });

  it('el de otro super admin con su nombre (403 al guardar el resto): tampoco cambia', async () => {
    const r = await request.patch(`/api/users/${OTRO_SUPER.id}`).set(como(SUPER))
      .send({ email: `otro.super.nuevo@${dominio}`, nombre: `${MARCA} Otro nombre` });
    expect(r.status).toBe(403);
    expect(await fila(OTRO_SUPER)).toMatchObject({ email: OTRO_SUPER.email, nombre: `${MARCA} OTROSUPER` });
    expect(correos.sendCorreoCambiadoEmail).not.toHaveBeenCalled();
  });

  it('y un correo que ya es de otro (409) sigue sin guardar nada del resto', async () => {
    const antes = await fila(GESTORA);
    const r = await request.patch(`/api/users/${GESTORA.id}`).set(como(SUPER))
      .send({ email: TUTORA.email, nombre: `${MARCA} Renombrada` });
    expect(r.status).toBe(409);
    expect(await fila(GESTORA)).toEqual(antes);
  });
});

describe('cuando todo va bien', () => {
  it('guarda el resto y el correo, y devuelve ya el correo nuevo', async () => {
    const r = await request.patch(`/api/users/${GESTORA.id}`).set(como(SUPER))
      .send({ email: `bien.gestora@${dominio}`, nombre: `${MARCA} Gestora Bien` });
    expect(r.status).toBe(200);
    expect(await fila(GESTORA)).toMatchObject({ email: `bien.gestora@${dominio}`, nombre: `${MARCA} Gestora Bien` });
    expect(r.body.data.email).toBe(`bien.gestora@${dominio}`);
    expect(r.body.data.correo).toMatchObject({ cambiado: true, email: `bien.gestora@${dominio}` });
    expect(await sesionesAbiertas(GESTORA)).toBe(0);
    expect(correos.sendCorreoCambiadoEmail).toHaveBeenCalledTimes(1);
  });

  it('una tutora que deja de serlo en el mismo guardado: el freno de tutores sigue valiendo', async () => {
    const r = await request.patch(`/api/users/${TUTORA.id}`).set(como(SUPER))
      .send({ email: `ex.tutora@${dominio}`, role: 'gestor', reenviarEnlace: true });
    expect(r.status).toBe(200);
    expect(await fila(TUTORA)).toMatchObject({ email: `ex.tutora@${dominio}`, role: 'gestor' });
    expect(correos.sendCorreoCambiadoEmail).not.toHaveBeenCalled();
    expect(correos.sendWelcomeUserEmail).not.toHaveBeenCalled();
  });
});
