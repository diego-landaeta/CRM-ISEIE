import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

/**
 * #248 (Diego, 06/10): «que el superadmin pueda cambiar el correo y contraseña
 * de todos los usuarios, tutores, gestores, todo». Contra la base de verdad.
 *
 * Lo que pide la issue: super admin sí; admin, gestora y tutor no; correo
 * repetido da 409; las sesiones quedan cerradas; queda registro de quién, cuándo
 * y el correo anterior y el nuevo; las reglas de «Establece tu contraseña»; y
 * ningún correo a tutores mientras siga el freno.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/correoYContrasenaDeOtro.test.js
 */

// Ningún correo sale de verdad: se comprueba que NO se pide para un tutor.
const correos = vi.hoisted(() => ({
  sendWelcomeUserEmail: vi.fn(async () => ({ sent: true })),
  sendCorreoCambiadoEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('../src/shared/services/brevo.service.js', async (original) => ({ ...(await original()), ...correos }));

const { default: pool } = await import('../src/shared/config/db.js');
const { default: usuarios } = await import('../src/modules/users/index.js');
const { default: tutores } = await import('../src/modules/tutores/index.js');
const { default: auth } = await import('../src/modules/auth/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(usuarios.prefix, usuarios.router);
app.use(tutores.prefix, tutores.router);
app.use(auth.prefix, auth.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `CORREO248${Date.now().toString(36)}`;
const dominio = `${MARCA.toLowerCase()}.test`;
const ids = [];
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const jwtDe = (u) => jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' });
const como = (u) => ({ Authorization: `Bearer ${jwtDe(u)}` });

async function persona(nombre, role, extra = {}) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role, gestor_colaboraciones)
     VALUES ($1, $2, 'x', $3, $4) RETURNING id, role, email`,
    [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${dominio}`, role, extra.colaboraciones === true]
  );
  ids.push(u.id);
  return u;
}

// Una sesión abierta: un refresh token sin revocar.
async function sesionAbierta(u) {
  await q(
    `INSERT INTO user_refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, md5(random()::text), NOW() + INTERVAL '1 day')`,
    [u.id]
  );
}
const sesionesAbiertas = async (u) => (await q(
  `SELECT COUNT(*)::int AS n FROM user_refresh_tokens WHERE user_id = $1 AND revoked = false`, [u.id]
))[0].n;
const correoDe = async (u) => (await q(`SELECT email FROM users WHERE id = $1`, [u.id]))[0].email;
const registro = async (accion, objetivo) => q(
  `SELECT user_id, details FROM user_activity_log
    WHERE action = $1 AND (details->>'usuario_id')::int = $2 ORDER BY id DESC`,
  [accion, objetivo.id]
);

let SUPER; let ADMIN; let SOPORTE; let GESTORA; let COLABORACIONES; let TUTOR; let OTRA;
let CAMPUS;

beforeAll(async () => {
  SUPER = await persona('SUPER', 'superadmin');
  ADMIN = await persona('ADMIN', 'admin');
  SOPORTE = await persona('SOPORTE', 'soporte');
  GESTORA = await persona('GESTORA', 'gestor');
  COLABORACIONES = await persona('COLAB', 'gestor', { colaboraciones: true });
  TUTOR = await persona('TUTOR', 'tutor');
  OTRA = await persona('OTRA', 'gestor');
  // Todos en el mismo campus: desde la #245 (Diego, 06/10) la ficha de un tutor
  // solo la toca quien comparte campus con él, y si no, «no encontrado». Aquí se
  // prueba la regla de la #246 (solo el super admin), no esa.
  const [c] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`]);
  CAMPUS = c.id;
  for (const u of [ADMIN, SOPORTE, GESTORA, COLABORACIONES, TUTOR, OTRA]) {
    await q('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [u.id, CAMPUS]);
  }
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM user_activity_log WHERE user_id = ANY($1::int[]) OR (details->>'usuario_id')::int = ANY($1::int[])`, [ids]);
  await q(`DELETE FROM user_refresh_tokens WHERE user_id = ANY($1::int[])`, [ids]);
  await q(`DELETE FROM tutor_profiles WHERE user_id = ANY($1::int[])`, [ids]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids]);
  if (CAMPUS) await q('DELETE FROM projects WHERE id = $1', [CAMPUS]);
  await pool.end();
}, 60000);

beforeEach(() => { correos.sendWelcomeUserEmail.mockClear(); correos.sendCorreoCambiadoEmail.mockClear(); });

describe('el correo de otro, desde Usuarios', () => {
  it('el super admin lo cambia: sin espacios y en minúsculas, y cierra sus sesiones', async () => {
    await sesionAbierta(GESTORA);
    const r = await request.patch(`/api/users/${GESTORA.id}`).set(como(SUPER))
      .send({ email: `  Nueva.Gestora@${dominio.toUpperCase()} ` });
    expect(r.status).toBe(200);
    expect(await correoDe(GESTORA)).toBe(`nueva.gestora@${dominio}`);
    expect(r.body.data.correo).toMatchObject({ cambiado: true, email: `nueva.gestora@${dominio}` });
    expect(await sesionesAbiertas(GESTORA)).toBe(0);
  });

  it('queda registro: quién, cuándo, el correo anterior y el nuevo', async () => {
    const [f] = await registro('usuario.cambiar_correo', GESTORA);
    expect(f.user_id).toBe(SUPER.id);
    expect(f.details).toMatchObject({ usuario_id: GESTORA.id, de: `gestora@${dominio}`, a: `nueva.gestora@${dominio}` });
  });

  it.each([['admin', () => ADMIN], ['soporte', () => SOPORTE]])('un %s no: 403, aunque la pantalla no se lo ofrezca', async (_r, quien) => {
    const antes = await correoDe(OTRA);
    const r = await request.patch(`/api/users/${OTRA.id}`).set(como(quien())).send({ email: `cambiado@${dominio}` });
    expect(r.status).toBe(403);
    expect(await correoDe(OTRA)).toBe(antes);
  });

  it('una gestora y un tutor, tampoco', async () => {
    for (const quien of [GESTORA, TUTOR]) {
      expect((await request.patch(`/api/users/${OTRA.id}`).set(como(quien)).send({ email: `x@${dominio}` })).status).toBe(403);
    }
  });

  it('un admin sigue pudiendo cambiar el resto (el nombre) sin tocar el correo', async () => {
    const r = await request.patch(`/api/users/${OTRA.id}`).set(como(ADMIN)).send({ nombre: `${MARCA} OTRA BIS` });
    expect(r.status).toBe(200);
  });

  it('un correo que ya usa otro: 409, también si solo cambian las mayúsculas, y no se guarda nada', async () => {
    for (const email of [`otra@${dominio}`, `OTRA@${dominio.toUpperCase()}`]) {
      const r = await request.patch(`/api/users/${GESTORA.id}`).set(como(SUPER)).send({ email, nombre: `${MARCA} NO SE GUARDA` });
      expect(r.status).toBe(409);
      expect(r.body.error || r.body.message).toMatch(/ya lo usa otro usuario/);
    }
    expect(await correoDe(GESTORA)).toBe(`nueva.gestora@${dominio}`);
    expect((await q(`SELECT nombre FROM users WHERE id = $1`, [GESTORA.id]))[0].nombre).not.toMatch(/NO SE GUARDA/);
  });

  it('un correo mal escrito: 400', async () => {
    expect((await request.patch(`/api/users/${GESTORA.id}`).set(como(SUPER)).send({ email: 'no-es-un-correo' })).status).toBe(400);
  });

  it('el de otro super admin, sí: lo cambia otro super admin (Diego, 09/10, #246); un admin, no', async () => {
    const OTRO_SUPER = await persona('SUPER2', 'superadmin');
    expect((await request.patch(`/api/users/${OTRO_SUPER.id}`).set(como(ADMIN)).send({ email: `s2@${dominio}` })).status).toBe(403);
    expect(await correoDe(OTRO_SUPER)).toBe(`super2@${dominio}`);
    expect((await request.patch(`/api/users/${OTRO_SUPER.id}`).set(como(SUPER)).send({ email: `s2@${dominio}` })).status).toBe(200);
    expect(await correoDe(OTRO_SUPER)).toBe(`s2@${dominio}`);
  });
});

describe('#246: lo que pide además la issue', () => {
  it('avisa por correo a la dirección VIEJA de que ha cambiado', async () => {
    const P = await persona('AVISO', 'gestor');
    const r = await request.patch(`/api/users/${P.id}`).set(como(SUPER)).send({ email: `aviso.nuevo@${dominio}` });
    expect(r.status).toBe(200);
    await vi.waitFor(() => expect(correos.sendCorreoCambiadoEmail).toHaveBeenCalledTimes(1));
    expect(correos.sendCorreoCambiadoEmail.mock.calls[0][0]).toMatchObject({ de: `aviso@${dominio}`, a: `aviso.nuevo@${dominio}` });
  });

  it('ofrece «Reenviar enlace de acceso» al correo nuevo, también desde Usuarios', async () => {
    const P = await persona('ENLACE', 'gestor');
    const r = await request.patch(`/api/users/${P.id}`).set(como(SUPER))
      .send({ email: `enlace.nuevo@${dominio}`, reenviarEnlace: true });
    expect(r.status).toBe(200);
    expect(r.body.data.correo).toMatchObject({ enlaceReenviado: true });
    await vi.waitFor(() => expect(correos.sendWelcomeUserEmail).toHaveBeenCalledTimes(1));
    expect(correos.sendWelcomeUserEmail.mock.calls[0][0].email).toBe(`enlace.nuevo@${dominio}`);
  });

  it('a un tutor, ni el aviso a la vieja ni el enlace a la nueva (freno de tutores)', async () => {
    const T = await persona('TUTOR2', 'tutor');
    const r = await request.patch(`/api/users/${T.id}`).set(como(SUPER))
      .send({ email: `tutor2.nuevo@${dominio}`, reenviarEnlace: true });
    expect(r.status).toBe(200);
    expect(correos.sendCorreoCambiadoEmail).not.toHaveBeenCalled();
    expect(correos.sendWelcomeUserEmail).not.toHaveBeenCalled();
  });

  it('«Terminada cuando»: entra con el correo nuevo y con el viejo ya no', async () => {
    const A = await persona('ENTRA', 'admin');
    expect((await request.patch(`/api/users/${A.id}/password`).set(como(SUPER))
      .send({ password: 'EntraBien1', confirmPassword: 'EntraBien1' })).status).toBe(200);
    expect((await request.patch(`/api/users/${A.id}`).set(como(SUPER)).send({ email: `entra.nuevo@${dominio}` })).status).toBe(200);
    const viejo = await request.post('/api/auth/login').send({ email: `entra@${dominio}`, password: 'EntraBien1' });
    expect(viejo.status).toBe(401);
    const nuevo = await request.post('/api/auth/login').send({ email: `entra.nuevo@${dominio}`, password: 'EntraBien1' });
    expect(nuevo.status).toBe(200);
    expect(nuevo.body.data.accessToken).toBeTruthy();
  });
});

describe('la contraseña de otro, desde Usuarios', () => {
  const nueva = { password: 'NuevaClave1', confirmPassword: 'NuevaClave1' };

  it('el super admin la pone, con bcrypt, y cierra sus sesiones', async () => {
    await sesionAbierta(OTRA);
    const r = await request.patch(`/api/users/${OTRA.id}/password`).set(como(SUPER)).send(nueva);
    expect(r.status).toBe(200);
    const [{ password_hash: hash }] = await q(`SELECT password_hash FROM users WHERE id = $1`, [OTRA.id]);
    expect(await bcrypt.compare('NuevaClave1', hash)).toBe(true);
    expect(hash.startsWith('$2b$12$')).toBe(true); // coste 12
    expect(await sesionesAbiertas(OTRA)).toBe(0);
  });

  it('queda registro de quién y a quién, nunca la contraseña', async () => {
    const [f] = await registro('usuario.cambiar_contrasena', OTRA);
    expect(f.user_id).toBe(SUPER.id);
    expect(JSON.stringify(f.details)).not.toMatch(/NuevaClave1/);
  });

  it('las reglas de «Establece tu contraseña», y repetida', async () => {
    const mal = [
      [{ password: 'Corta1', confirmPassword: 'Corta1' }, /Minimo 8/],
      [{ password: 'sinmayuscula1', confirmPassword: 'sinmayuscula1' }, /mayuscula/],
      [{ password: 'SinNumero', confirmPassword: 'SinNumero' }, /numero/],
      [{ password: 'NuevaClave1', confirmPassword: 'NuevaClave2' }, /no coinciden/],
      [{ password: 'NuevaClave1' }, /Repite|Required/],
    ];
    for (const [body, error] of mal) {
      const r = await request.patch(`/api/users/${OTRA.id}/password`).set(como(SUPER)).send(body);
      expect(r.status).toBe(400);
      expect(r.body.error || r.body.message).toMatch(error);
    }
  });

  it('un admin o soporte, no', async () => {
    for (const quien of [ADMIN, SOPORTE]) {
      expect((await request.patch(`/api/users/${OTRA.id}/password`).set(como(quien)).send(nueva)).status).toBe(403);
    }
  });
});

describe('desde Tutores: el correo y la contraseña de un tutor', () => {
  it('el super admin le cambia el correo y cierra sus sesiones', async () => {
    await sesionAbierta(TUTOR);
    const r = await request.patch(`/api/tutores/${TUTOR.id}/perfil`).set(como(SUPER)).send({ email: `Tutor.Nuevo@${dominio}` });
    expect(r.status).toBe(200);
    expect(await correoDe(TUTOR)).toBe(`tutor.nuevo@${dominio}`);
    expect(await sesionesAbiertas(TUTOR)).toBe(0);
    expect((await registro('usuario.cambiar_correo', TUTOR))[0].user_id).toBe(SUPER.id);
  });

  it('sin ningún correo al tutor, aunque se pida reenviar el enlace (freno de tutores)', async () => {
    const r = await request.patch(`/api/tutores/${TUTOR.id}/perfil`).set(como(SUPER))
      .send({ email: `tutor.otro@${dominio}`, reenviarEnlace: true });
    expect(r.status).toBe(200);
    expect(correos.sendWelcomeUserEmail).not.toHaveBeenCalled();
  });

  it('ni un admin, ni quien gestiona colaboraciones, ni el propio tutor', async () => {
    const antes = await correoDe(TUTOR);
    for (const quien of [ADMIN, COLABORACIONES, TUTOR]) {
      const r = await request.patch(`/api/tutores/${TUTOR.id}/perfil`).set(como(quien)).send({ email: `robo@${dominio}` });
      expect(r.status).toBe(403);
    }
    expect(await correoDe(TUTOR)).toBe(antes);
  });

  it('por aquí no se cambia el correo de quien no es tutor (antes se podía, con su identificador)', async () => {
    const antes = await correoDe(OTRA);
    const r = await request.patch(`/api/tutores/${OTRA.id}/perfil`).set(como(SUPER)).send({ email: `colada@${dominio}` });
    expect(r.status).toBe(404);
    expect(await correoDe(OTRA)).toBe(antes);
  });

  it('el super admin le pone contraseña, con las mismas reglas, y cierra sus sesiones', async () => {
    await sesionAbierta(TUTOR);
    expect((await request.post(`/api/tutores/${TUTOR.id}/contrasena`).set(como(SUPER))
      .send({ password: 'clavedebil', confirmPassword: 'clavedebil' })).status).toBe(400);
    const r = await request.post(`/api/tutores/${TUTOR.id}/contrasena`).set(como(SUPER))
      .send({ password: 'ClaveTutor1', confirmPassword: 'ClaveTutor1' });
    expect(r.status).toBe(200);
    const [{ password_hash: hash }] = await q(`SELECT password_hash FROM users WHERE id = $1`, [TUTOR.id]);
    expect(await bcrypt.compare('ClaveTutor1', hash)).toBe(true);
    expect(await sesionesAbiertas(TUTOR)).toBe(0);
    expect((await registro('usuario.cambiar_contrasena', TUTOR))[0].user_id).toBe(SUPER.id);
  });

  it('la contraseña de un tutor: el admin de su campus sí (Diego, 09/10, #246); quien gestiona colaboraciones, no', async () => {
    expect((await request.post(`/api/tutores/${TUTOR.id}/contrasena`).set(como(COLABORACIONES))
      .send({ password: 'ClaveTutor2', confirmPassword: 'ClaveTutor2' })).status).toBe(403);
    expect((await request.post(`/api/tutores/${TUTOR.id}/contrasena`).set(como(ADMIN))
      .send({ password: 'ClaveTutor2', confirmPassword: 'ClaveTutor2' })).status).toBe(200);
  });
});

describe('el aviso de Make antes de cambiar un correo', () => {
  it('dice si la persona recibe prospectos (los tiene asignados)', async () => {
    const [p] = await q(`SELECT id FROM projects ORDER BY id LIMIT 1`);
    const [l] = await q(
      `INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [p.id, `${MARCA} lead`, `lead@${dominio}`, GESTORA.id]
    );
    try {
      const r = await request.get(`/api/users/${GESTORA.id}/aviso-correo`).set(como(SUPER));
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ recibeProspectos: true, prospectosAsignados: 1 });
    } finally {
      await q(`DELETE FROM leads WHERE id = $1`, [l.id]);
    }
  });

  it('y si no recibe ninguno, lo dice también', async () => {
    const r = await request.get(`/api/users/${SOPORTE.id}/aviso-correo`).set(como(SUPER));
    expect(r.body.data).toMatchObject({ recibeProspectos: false, prospectosAsignados: 0, campusEnReparto: 0 });
  });

  it('solo el super admin lo ve', async () => {
    for (const quien of [ADMIN, SOPORTE]) {
      expect((await request.get(`/api/users/${GESTORA.id}/aviso-correo`).set(como(quien))).status).toBe(403);
    }
  });
});
