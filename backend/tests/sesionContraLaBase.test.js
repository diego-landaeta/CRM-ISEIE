import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * La sesión, contra la base (hotfix del 26/10/2026).
 *
 * Diego vio a Ruth en producción con «Soporte» abajo, todo el CRM en el menú y
 * «Tu rol no tiene acceso al tablero de tareas»: en la base ya era colaborador,
 * pero su token de 8 horas era de antes del cambio y llevaba «soporte» dentro.
 *
 * Lo que se fija: un token con el rol de antes, de alguien desactivado o de
 * alguien que ya no existe da 401; el bueno pasa; la caché es corta; y un error
 * de la base no deja pasar a nadie.
 */

const db = vi.hoisted(() => ({ users: new Map(), consultas: 0, falla: false }));
vi.mock('../src/shared/config/db.js', () => {
  const query = async (sql, params) => {
    if (!/FROM users WHERE id = \$1/.test(sql)) throw new Error(`consulta inesperada: ${sql}`);
    db.consultas += 1;
    if (db.falla) throw new Error('la base no contesta');
    const u = db.users.get(Number(params[0]));
    return { rows: u ? [{ ...u }] : [] };
  };
  return { query, default: { query }, getClient: async () => ({ query, release() {} }) };
});

const { verifyToken } = await import('../src/shared/middleware/auth.js');
const { olvidarSesiones, CACHE_MS, sesionVigente } = await import('../src/shared/middleware/sesionViva.js');

const anterior = process.env.COMPROBAR_SESION;
process.env.COMPROBAR_SESION = '1';
afterAll(() => { process.env.COMPROBAR_SESION = anterior; });

const app = express();
app.get('/api/tasks', verifyToken, (req, res) => res.json({ ok: true, role: req.user.role }));
app.get('/api/leads', verifyToken, (req, res) => res.json({ ok: true }));
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, code: err.code || 'ERROR' }));
const request = supertest(app);

const token = (u) => jwt.sign(
  { userId: u.id, email: `${u.id}@x.test`, role: u.role, roles_extra: u.roles_extra ?? [], customRoleId: u.custom_role_id ?? null },
  process.env.JWT_SECRET, { expiresIn: '8h' });
const conToken = (t) => ({ Authorization: `Bearer ${t}` });

beforeEach(() => {
  olvidarSesiones();
  db.users.clear();
  db.consultas = 0;
  db.falla = false;
  db.users.set(51, { role: 'colaborador', roles_extra: [], custom_role_id: null, active: true });
  db.users.set(3, { role: 'soporte', roles_extra: ['colaborador'], custom_role_id: null, active: true });
});

describe('verifyToken mira la sesión contra la base', () => {
  it('el token viejo de Ruth (soporte) ya no vale: 401 TOKEN_INVALID, para que renueve', async () => {
    const viejo = token({ id: 51, role: 'soporte' });
    const r = await request.get('/api/leads').set(conToken(viejo));
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('TOKEN_INVALID');
  });

  it('el token nuevo, con su rol de la base, pasa', async () => {
    const r = await request.get('/api/tasks').set(conToken(token({ id: 51, role: 'colaborador' })));
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('colaborador');
  });

  it('los roles de más también cuentan (en cualquier orden); quitarle uno anula el token', async () => {
    expect((await request.get('/api/tasks').set(conToken(token({ id: 3, role: 'soporte', roles_extra: ['colaborador'] })))).status).toBe(200);
    expect((await request.get('/api/tasks').set(conToken(token({ id: 3, role: 'soporte' })))).status).toBe(401);
  });

  it('el rol a medida también', async () => {
    db.users.set(60, { role: 'gestor', roles_extra: [], custom_role_id: 7, active: true });
    expect((await request.get('/api/tasks').set(conToken(token({ id: 60, role: 'gestor', custom_role_id: 7 })))).status).toBe(200);
    olvidarSesiones();
    expect((await request.get('/api/tasks').set(conToken(token({ id: 60, role: 'gestor' })))).status).toBe(401);
  });

  it('desactivado o borrado: 401 aunque el token sea bueno', async () => {
    const t = token({ id: 51, role: 'colaborador' });
    db.users.set(51, { role: 'colaborador', roles_extra: [], custom_role_id: null, active: false });
    expect((await request.get('/api/tasks').set(conToken(t))).status).toBe(401);
    olvidarSesiones();
    db.users.delete(51);
    expect((await request.get('/api/tasks').set(conToken(t))).status).toBe(401);
  });

  it('la caché es corta: una consulta por persona cada 30 s, y el cambio se nota al caducar', async () => {
    const t = token({ id: 51, role: 'colaborador' });
    const ahora = Date.now();
    expect(await sesionVigente(jwt.decode(t), ahora)).toBe(true);
    expect(await sesionVigente(jwt.decode(t), ahora + 1000)).toBe(true);
    expect(db.consultas).toBe(1);
    db.users.set(51, { role: 'colaborador', roles_extra: [], custom_role_id: null, active: false });
    expect(await sesionVigente(jwt.decode(t), ahora + CACHE_MS - 1)).toBe(true);
    expect(await sesionVigente(jwt.decode(t), ahora + CACHE_MS + 1)).toBe(false);
    expect(CACHE_MS).toBeLessThanOrEqual(30_000);
  });

  it('si la base falla, no pasa nadie (500), en vez de dejar pasar con el token', async () => {
    db.falla = true;
    expect((await request.get('/api/tasks').set(conToken(token({ id: 51, role: 'colaborador' })))).status).toBe(500);
  });

  it('sin token o con uno falso, como siempre: 401 y sin ir a la base', async () => {
    expect((await request.get('/api/tasks')).status).toBe(401);
    expect((await request.get('/api/tasks').set(conToken('no-es-un-jwt'))).status).toBe(401);
    expect(db.consultas).toBe(0);
  });
});
