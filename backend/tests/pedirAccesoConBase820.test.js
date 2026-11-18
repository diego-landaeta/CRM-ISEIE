import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

/**
 * Pedir acceso o permiso (CRM#820), contra la base y las rutas de verdad.
 *
 * `pedirAcceso820.test.js` finge el modelo y el catálogo. Aquí se fija lo que
 * solo se ve con Postgres y Express: que la migración 294 deja guardar un
 * ticket «access» con su `acceso`, que el filtro de las peticiones ajenas está
 * en el SQL, que el tutor y el colaborador pasan su lista cerrada para PEDIR y
 * nada más, y que ver y mover las peticiones pide el permiso del catálogo.
 */

vi.mock('../src/shared/services/brevo.service.js', async (original) => ({
  ...(await original()),
  sendTicketNuevoEmail: vi.fn(async () => ({ sent: false, reason: 'test' })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const { default: app } = await import('../src/app.js');
const model = await import('../src/modules/soporte/soporte.model.js');

const request = supertest(app);
const MAIL = '@test-acceso-820.com';
const u = {};
const p = {};

async function usuario(clave, role, proyecto) {
  const { rows } = await pool.query(
    `INSERT INTO users (nombre, email, password_hash, role, active)
     VALUES ($1, $2, 'x', $3, TRUE) RETURNING id`,
    [`Acc ${clave}`, `${clave}${MAIL}`, role]);
  const id = rows[0].id;
  if (proyecto) {
    await pool.query(
      'INSERT INTO user_projects (user_id, project_id, orden_cola) VALUES ($1, $2, 1)', [id, proyecto]);
  }
  u[clave] = { userId: id, role, nombre: `Acc ${clave}` };
}

async function limpiar() {
  const quienes = `SELECT id FROM users WHERE email LIKE '%${MAIL}'`;
  await pool.query(`DELETE FROM admin_notifications WHERE triggered_by_user_id IN (${quienes})`);
  await pool.query(`DELETE FROM tickets WHERE abierto_por IN (${quienes}) OR titulo LIKE '[acc]%'`);
  await pool.query(`DELETE FROM user_projects WHERE user_id IN (${quienes})`);
  await pool.query(`DELETE FROM users WHERE email LIKE '%${MAIL}'`);
  await pool.query(`DELETE FROM projects WHERE nombre LIKE '[acc]%'`);
}

const token = (user) => jwt.sign(
  { userId: user.userId, email: 'x', role: user.role, roles_extra: [], activeProjectId: null },
  process.env.JWT_SECRET, { expiresIn: '1h' });
const conSesion = (req, user) => req.set('Authorization', `Bearer ${token(user)}`);

beforeAll(async () => {
  await limpiar();
  for (const k of ['A', 'B']) {
    p[k] = (await pool.query(
      'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`[acc] ${k}`, `acc-820-${k.toLowerCase()}`, `acc-820-clave-${k}`])).rows[0].id;
  }
  await usuario('so', 'soporte', null);
  await usuario('adA', 'admin', p.A);
  await usuario('adB', 'admin', p.B);
  await usuario('gA', 'gestor', p.A);
  await usuario('gA2', 'gestor', p.A);
  await usuario('tutor', 'tutor', p.A);
  await usuario('colab', 'colaborador', null);
  await usuario('redactor', 'tutor_redactor', null);
}, 60000);

afterAll(async () => {
  await limpiar();
  await pool.end();
});

describe('la migración 294', () => {
  it('un ticket «access» se guarda con su `acceso`; un tipo inventado no', async () => {
    const t = await model.crearAcceso({
      abiertoPor: u.gA.userId, projectId: p.A, titulo: 'Permiso: leads.view',
      explicacion: '[acc] para ver los prospectos', url: null,
      acceso: { tipo: 'permiso', permiso: 'leads.view' },
    });
    expect(t.kind).toBe('access');
    expect(t.acceso).toEqual({ tipo: 'permiso', permiso: 'leads.view' });
    expect(t.projectId).toBe(p.A);

    await expect(pool.query(
      `INSERT INTO tickets (abierto_por, kind, titulo) VALUES ($1, 'darme_todo', '[acc] no')`, [u.gA.userId],
    )).rejects.toThrow(/tickets_kind_check/);
  });
});

describe('el filtro de las peticiones ajenas está en el SQL', () => {
  it('con `sinAccesosDe` salen sus peticiones y todos los demás tickets, no las peticiones de otros', async () => {
    await model.crearAcceso({
      abiertoPor: u.gA2.userId, projectId: p.A, titulo: '[acc] la de otra', explicacion: 'x', acceso: { tipo: 'otro' },
    });
    await model.crearAcceso({
      abiertoPor: u.adA.userId, projectId: p.A, titulo: '[acc] la mia', explicacion: 'x', acceso: { tipo: 'otro' },
    });
    await pool.query(
      `INSERT INTO tickets (abierto_por, project_id, titulo) VALUES ($1, $2, '[acc] un bug de otra')`, [u.gA2.userId, p.A]);

    const titulos = async (sinAccesosDe) => (await model.listar({
      limit: 200, alcance: { userId: u.adA.userId, projectIds: [p.A] }, sinAccesosDe,
    })).tickets.map((t) => t.title).filter((t) => t.startsWith('[acc]')).sort();

    expect(await titulos(null)).toEqual(['[acc] la de otra', '[acc] la mia', '[acc] un bug de otra']);
    expect(await titulos(u.adA.userId)).toEqual(['[acc] la mia', '[acc] un bug de otra']);
  });
});

describe('las rutas, con sesión de verdad', () => {
  const pedir = (user, body) => conSesion(request.post('/api/soporte/accesos'), user).send(body);

  it('cualquiera con sesión pide: gestora, tutor, colaborador y tutor redactor', async () => {
    for (const k of ['gA', 'tutor', 'colab', 'redactor']) {
      const r = await pedir(u[k], { tipo: 'claude', explicacion: `Se me cerró Claude (${k})` });
      expect(r.status, `${k}: ${JSON.stringify(r.body)}`).toBe(201);
      expect(r.body.data.kind).toBe('access');
      expect(r.body.data.title).toBe('Acceso a Claude / MCP');
    }
  }, 60000);

  it('el tutor y el colaborador siguen sin el resto de Soporte (su lista cerrada)', async () => {
    for (const k of ['tutor', 'colab', 'redactor']) {
      expect((await conSesion(request.get('/api/soporte'), u[k])).status, k).toBe(403);
      expect((await conSesion(request.get('/api/soporte/accesos'), u[k])).status, k).toBe(403);
    }
  }, 60000);

  it('la lista de peticiones: soporte y admin sí; una gestora, 403', async () => {
    expect((await conSesion(request.get('/api/soporte/accesos'), u.gA)).status).toBe(403);
    const so = await conSesion(request.get('/api/soporte/accesos'), u.so);
    expect(so.status).toBe(200);
    expect(so.body.data.every((t) => t.kind === 'access')).toBe(true);
    expect((await conSesion(request.get('/api/soporte/accesos'), u.adA)).status).toBe(200);
  }, 60000);

  it('un alta lleva nombre y correo: sin ellos, 400 y no se guarda nada', async () => {
    const antes = (await pool.query('SELECT COUNT(*)::int AS n FROM tickets WHERE abierto_por = $1', [u.gA.userId])).rows[0].n;
    const r = await pedir(u.gA, { tipo: 'alta', explicacion: 'Entra el lunes' });
    expect(r.status).toBe(400);
    const despues = (await pool.query('SELECT COUNT(*)::int AS n FROM tickets WHERE abierto_por = $1', [u.gA.userId])).rows[0].n;
    expect(despues).toBe(antes);
  }, 60000);

  it('pedir NO crea usuarios ni da permisos: solo deja el ticket', async () => {
    const correo = `nueva${MAIL}`;
    const r = await pedir(u.gA, {
      tipo: 'alta', nombre: 'Persona Nueva', correo, explicacion: 'Entra el lunes en admisiones', projectId: p.A,
    });
    expect(r.status).toBe(201);
    expect(r.body.data.acceso).toEqual({ tipo: 'alta', persona: { nombre: 'Persona Nueva', correo } });
    expect((await pool.query('SELECT 1 FROM users WHERE email = $1', [correo])).rowCount).toBe(0);

    const permiso = await pedir(u.gA, { tipo: 'permiso', permiso: 'users.create', explicacion: 'Para dar altas yo' });
    expect(permiso.status).toBe(201);
    // Ni una excepción de permisos nueva para quien lo pidió.
    expect((await pool.query('SELECT 1 FROM user_permission_overrides WHERE user_id = $1', [u.gA.userId])).rowCount).toBe(0);
  }, 60000);

  it('avisa en la campana a soporte y al admin del campus; no al de otro campus ni a quien pide', async () => {
    const r = await pedir(u.gA2, { tipo: 'permiso', permiso: 'reports.view', explicacion: 'Para el informe', projectId: p.A });
    expect(r.status).toBe(201);
    let destinatarios;
    for (let i = 0; i < 60 && !destinatarios; i++) {
      const { rows } = await pool.query(
        `SELECT target_user_ids FROM admin_notifications
          WHERE type = 'acceso_pedido' AND metadata->>'ticketId' = $1`, [String(r.body.data.id)]);
      destinatarios = rows[0]?.target_user_ids;
      if (!destinatarios) await new Promise((ok) => setTimeout(ok, 50));
    }
    expect(destinatarios).toEqual(expect.arrayContaining([u.so.userId, u.adA.userId]));
    expect(destinatarios).not.toContain(u.adB.userId);
    expect(destinatarios).not.toContain(u.gA2.userId);
  }, 60000);

  it('moverla pide «Gestionar las peticiones de acceso»: soporte sí, la gestora no', async () => {
    const r = await pedir(u.gA, { tipo: 'otro', explicacion: 'Necesito entrar a Moodle' });
    const id = r.body.data.id;

    const gestora = await conSesion(request.patch(`/api/soporte/accesos/${id}`), u.gA2).send({ status: 'resolved' });
    expect(gestora.status).toBe(403);

    const so = await conSesion(request.patch(`/api/soporte/accesos/${id}`), u.so)
      .send({ status: 'resolved', nota: 'Hecho: ya puedes entrar' });
    expect(so.status).toBe(200);
    expect(so.body.data.status).toBe('resolved');
    const { rows } = await pool.query(
      'SELECT cuerpo, interna FROM ticket_mensajes WHERE ticket_id = $1', [Number(id)]);
    expect(rows).toEqual([{ cuerpo: 'Hecho: ya puedes entrar', interna: false }]);
  }, 60000);
});
