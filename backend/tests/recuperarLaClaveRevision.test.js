import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import pool from '../src/shared/config/db.js';

/**
 * Revision de «recuperar la contraseña» (#37 / PR #388), contra la base real.
 *
 * Los tests de `recuperarLaClave.test.js` fingen el modelo; lo que se afirma
 * aqui solo se ve con SQL de verdad: que un segundo «he olvidado mi clave» no
 * pise el enlace anterior, que una baja no pueda usar un enlace viejo y que el
 * aviso de «pendiente de entrar» de los tutores no se encienda por un token
 * caducado.
 */

const enviado = vi.fn(async () => ({ sent: true }));
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendPasswordResetEmail: (...a) => enviado(...a),
  sendWelcomeUserEmail: vi.fn(),
  sendEmail: vi.fn(),
}));

const service = await import('../src/modules/auth/auth.service.js');
const ctrl = await import('../src/modules/auth/auth.controller.js');
const { olvidoSchema } = await import('../src/modules/auth/auth.validation.js');
const tutorModel = await import('../src/modules/tutores/tutor.model.js');

const CORREO = 'recuperar-revision@crm-test.com';
const CORREO_TUTOR = 'tutor-recuperar-revision@crm-test.com';
let userId;
let tutorId;
let projectId;

const HORA = 3_600_000;

async function fijarToken(id, hash, expira) {
  await pool.query(
    `UPDATE users SET set_password_token = $2, set_password_expires = $3 WHERE id = $1`,
    [id, hash, expira],
  );
}
async function leerToken(id) {
  const { rows } = await pool.query(
    `SELECT set_password_token AS t, set_password_expires AS e, password_hash AS h, active FROM users WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function limpiar() {
  await pool.query(`DELETE FROM user_activity_log WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))`, [[CORREO, CORREO_TUTOR]]);
  await pool.query(`DELETE FROM user_projects WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))`, [[CORREO, CORREO_TUTOR]]);
  await pool.query(`DELETE FROM user_refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))`, [[CORREO, CORREO_TUTOR]]);
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [[CORREO, CORREO_TUTOR]]);
}

beforeAll(async () => {
  await limpiar();
  const u = await pool.query(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ('Revision Clave', $1, 'hash-viejo', 'admin') RETURNING id`,
    [CORREO]);
  userId = u.rows[0].id;
  const t = await pool.query(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ('Tutor Revision', $1, 'hash-viejo', 'tutor') RETURNING id`,
    [CORREO_TUTOR]);
  tutorId = t.rows[0].id;
  const p = await pool.query(`SELECT id FROM projects ORDER BY id LIMIT 1`);
  projectId = p.rows[0]?.id;
  if (projectId == null) {
    const n = await pool.query(`INSERT INTO projects (nombre) VALUES ('Proyecto test revision') RETURNING id`);
    projectId = n.rows[0].id;
  }
  await pool.query(`INSERT INTO user_projects (user_id, project_id, orden_cola) VALUES ($1, $2, 1)`, [tutorId, projectId]);
});

afterAll(async () => {
  await limpiar();
  await pool.end();
});

beforeEach(async () => {
  enviado.mockClear();
  await pool.query(`UPDATE users SET active = true, password_hash = 'hash-viejo', set_password_token = NULL, set_password_expires = NULL, last_login_at = NULL WHERE id = ANY($1)`, [[userId, tutorId]]);
});

describe('pedir la recuperacion varias veces', () => {
  it('con un enlace vigente emitido hace menos de 5 minutos NO se pisa ni se manda otro', async () => {
    const primero = await service.pedirRecuperacion(CORREO, 'http://x');
    expect(primero?.rawToken).toBeTruthy();
    const guardado = await leerToken(userId);

    const segundo = await service.pedirRecuperacion(CORREO, 'http://x');
    expect(segundo).toBeFalsy();                       // nada que enviar
    const despues = await leerToken(userId);
    expect(despues.t).toBe(guardado.t);                // el enlace anterior sigue valiendo
    expect(despues.e.getTime()).toBe(guardado.e.getTime());
  });

  it('pasados 5 minutos, pedirlo otra vez SI emite uno nuevo', async () => {
    // Emitido hace 6 minutos: caduca dentro de 24 h - 6 min.
    await fijarToken(userId, 'viejo-hash', new Date(Date.now() + 24 * HORA - 6 * 60_000));
    const r = await service.pedirRecuperacion(CORREO, 'http://x');
    expect(r?.rawToken).toBeTruthy();
    expect((await leerToken(userId)).t).not.toBe('viejo-hash');
  });

  it('un enlace ya caducado no frena: se emite uno nuevo', async () => {
    await fijarToken(userId, 'caducado-hash', new Date(Date.now() - 1000));
    const r = await service.pedirRecuperacion(CORREO, 'http://x');
    expect(r?.rawToken).toBeTruthy();
  });

  it('la respuesta HTTP es identica con y sin freno, y el segundo pedido no manda correo', async () => {
    const pedir = async () => {
      const res = { codigo: 200, cuerpo: null,
        status(c) { this.codigo = c; return this; }, json(c) { this.cuerpo = c; return this; } };
      await ctrl.forgotPassword({ body: { email: CORREO } }, res, () => {});
      await new Promise((r) => setTimeout(r, 200));
      return res;
    };
    const a = await pedir();
    const b = await pedir();
    expect(b.codigo).toBe(a.codigo);
    expect(b.cuerpo).toEqual(a.cuerpo);
    expect(enviado).toHaveBeenCalledTimes(1);
  });

  it('dos peticiones a la vez tampoco emiten dos enlaces', async () => {
    const [a, b] = await Promise.all([
      service.pedirRecuperacion(CORREO, 'http://x'),
      service.pedirRecuperacion(CORREO, 'http://x'),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

describe('poner la contraseña con el enlace', () => {
  it('una cuenta dada de baja despues de emitir el enlace NO puede usarlo', async () => {
    const r = await service.pedirRecuperacion(CORREO, 'http://x');
    await pool.query(`UPDATE users SET active = false WHERE id = $1`, [userId]);

    await expect(service.setPassword(r.rawToken, 'ClaveNueva1')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    expect((await leerToken(userId)).h).toBe('hash-viejo');
  });

  it('con la cuenta activa el enlace sigue funcionando', async () => {
    const r = await service.pedirRecuperacion(CORREO, 'http://x');
    await service.setPassword(r.rawToken, 'ClaveNueva1');
    expect((await leerToken(userId)).h).not.toBe('hash-viejo');
  });
});

describe('olvidoSchema', () => {
  it('recorta los espacios ANTES de validar', () => {
    const r = olvidoSchema.safeParse({ email: '  a@b.com  ' });
    expect(r.success).toBe(true);
    expect(r.data.email).toBe('a@b.com');
  });

  it('rechaza un correo de mas de 254 caracteres', () => {
    const largo = `${'a'.repeat(250)}@b.com`;
    expect(olvidoSchema.safeParse({ email: largo }).success).toBe(false);
  });

  it('acepta uno de 254', () => {
    const local = 'a'.repeat(64);
    const dom = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
    const email = `${local}@${dom}`;
    expect(email.length).toBe(254);
    expect(olvidoSchema.safeParse({ email }).success).toBe(true);
  });
});

describe('tutores: «pendiente de entrar»', () => {
  const pendiente = async () => {
    const filas = await tutorModel.listar({ projectId: null, activos: true });
    return filas.find((f) => f.id === tutorId)?.pendiente_de_entrar;
  };

  it('sin token no esta pendiente', async () => {
    expect(await pendiente()).toBe(false);
  });

  const haEntrado = () => pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [tutorId]);

  it('invitacion real (nunca ha entrado) con enlace vigente: si', async () => {
    await fijarToken(tutorId, 'h', new Date(Date.now() + 2 * HORA));
    expect(await pendiente()).toBe(true);
  });

  it('invitacion real caducada y sin usar: sigue sin haber entrado', async () => {
    await fijarToken(tutorId, 'h', new Date(Date.now() - HORA));
    expect(await pendiente()).toBe(true);
  });

  it('un tutor que ya entraba y pide recuperar la clave NO queda «pendiente»', async () => {
    await haEntrado();
    await fijarToken(tutorId, 'h', new Date(Date.now() + 24 * HORA));
    expect(await pendiente()).toBe(false);
  });

  it('ni con el enlace de recuperacion caducado que nadie limpio', async () => {
    await haEntrado();
    await fijarToken(tutorId, 'h', new Date(Date.now() - HORA));
    expect(await pendiente()).toBe(false);
  });
});
