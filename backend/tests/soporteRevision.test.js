import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

/**
 * Revision de «soporte» (#38 / PR #389), contra la base real.
 *
 * Los tests de `soporte.test.js` fingen el modelo; lo que se fija aqui solo se
 * ve con SQL, disco y rutas de verdad: a que campus se puede abrir un ticket,
 * quien cambia el estado o borra, a quien le llega el aviso, que `responder`
 * no abra la transaccion sobre el pool, que un id raro sea un 404 y que haya un
 * freno por usuario al abrir tickets.
 */

// Los adjuntos van a un directorio temporal, no al /var/crm-uploads por defecto.
const UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-soporte-rev-'));
process.env.UPLOADS_DIR = UPLOADS;

vi.mock('../src/shared/services/brevo.service.js', async (original) => ({
  ...(await original()),
  sendTicketNuevoEmail: vi.fn(async () => ({ sent: false, reason: 'test' })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const { default: app } = await import('../src/app.js');
const model = await import('../src/modules/soporte/soporte.model.js');
const ctrl = await import('../src/modules/soporte/soporte.controller.js');
const { responderSchema } = await import('../src/modules/soporte/soporte.validation.js');
const { saveLocal } = await import('../src/shared/services/localStorage.service.js');

const request = supertest(app);
const MAIL = '@test-soporte-rev.com';
const u = {}; // usuarios
const p = {}; // proyectos

async function usuario(clave, role, proyecto) {
  const { rows } = await pool.query(
    `INSERT INTO users (nombre, email, password_hash, role, active)
     VALUES ($1, $2, 'x', $3, TRUE) RETURNING id`,
    [`Rev ${clave}`, `${clave}${MAIL}`, role]);
  const id = rows[0].id;
  if (proyecto) {
    await pool.query(
      `INSERT INTO user_projects (user_id, project_id, orden_cola) VALUES ($1, $2, 1)`, [id, proyecto]);
  }
  u[clave] = { userId: id, role, nombre: `Rev ${clave}` };
}

async function limpiar() {
  await pool.query(`DELETE FROM admin_notifications WHERE title LIKE '[rev]%'`);
  await pool.query(`DELETE FROM tickets WHERE titulo LIKE '[rev]%'`);
  await pool.query(
    `DELETE FROM user_projects WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`, [`%${MAIL}`]);
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%${MAIL}`]);
  await pool.query(`DELETE FROM projects WHERE nombre LIKE '[rev]%'`);
}

beforeAll(async () => {
  await limpiar();
  for (const k of ['A', 'B']) {
    p[k] = (await pool.query(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`, [`[rev] ${k}`, `rev-soporte-${k.toLowerCase()}`, `rev-clave-${k}`])).rows[0].id;
  }
  await usuario('sa', 'superadmin', null);
  await usuario('so', 'soporte', null);
  await usuario('adA', 'admin', p.A);
  await usuario('adB', 'admin', p.B);
  await usuario('gA', 'gestor', p.A);
  await usuario('gA2', 'gestor', p.A);
  await usuario('gB', 'gestor', p.B);
});

afterAll(async () => {
  await limpiar();
  fs.rmSync(UPLOADS, { recursive: true, force: true });
  await pool.end();
});



async function llamar(handler, req) {
  const res = { codigo: 200, cuerpo: null,
    status(c) { this.codigo = c; return this; }, json(c) { this.cuerpo = c; return this; } };
  let error = null;
  await handler({ query: {}, params: {}, body: {}, ...req }, res, (e) => { error = e; });
  return { res, error };
}

const nuevo = (extra = {}) => ({ title: '[rev] el chat no carga', ...extra });
async function ticketDe(autor, proyecto, titulo = '[rev] ticket') {
  return (await pool.query(
    `INSERT INTO tickets (abierto_por, project_id, titulo) VALUES ($1, $2, $3) RETURNING id`,
    [u[autor].userId, proyecto, titulo])).rows[0].id;
}
const estadoDe = async (id) =>
  (await pool.query('SELECT estado FROM tickets WHERE id = $1', [id])).rows[0]?.estado;
const existe = async (id) => (await pool.query('SELECT 1 FROM tickets WHERE id = $1', [id])).rowCount > 0;

describe('abrir un ticket: el campus tiene que ser tuyo (B1)', () => {
  it('un gestor NO puede meter un ticket en la bandeja de otro campus', async () => {
    const { error, res } = await llamar(ctrl.crear, { user: u.gA, body: nuevo({ projectId: p.B }) });
    expect(error?.statusCode).toBe(403);
    expect(res.codigo).not.toBe(201);
    const { rowCount } = await pool.query(`SELECT 1 FROM tickets WHERE project_id = $1`, [p.B]);
    expect(rowCount).toBe(0);
  });

  it('un projectId que no existe NO da 500 (un gestor: 403; superadmin: 404)', async () => {
    const g = await llamar(ctrl.crear, { user: u.gA, body: nuevo({ projectId: 2000000000 }) });
    expect(g.error?.statusCode).toBe(403);
    const s = await llamar(ctrl.crear, { user: u.sa, body: nuevo({ projectId: 2000000000 }) });
    expect(s.error?.statusCode).toBe(404);
  });

  it('un projectId fuera de rango de entero es un 400, no un error de Postgres', async () => {
    const { error } = await llamar(ctrl.crear, { user: u.sa, body: nuevo({ projectId: 99999999999 }) });
    expect(error?.statusCode).toBe(400);
  });

  it('en su propio campus, y sin campus, si', async () => {
    const a = await llamar(ctrl.crear, { user: u.gA, body: nuevo({ projectId: p.A }) });
    expect(a.error).toBeNull();
    expect(a.res.codigo).toBe(201);
    const b = await llamar(ctrl.crear, { user: u.gA, body: nuevo() });
    expect(b.res.codigo).toBe(201);
  });

  it('superadmin y soporte pueden abrirlo en cualquier campus que exista', async () => {
    for (const k of ['sa', 'so']) {
      const r = await llamar(ctrl.crear, { user: u[k], body: nuevo({ projectId: p.B }) });
      expect(r.error, k).toBeNull();
      expect(r.res.codigo).toBe(201);
    }
  });
});

describe('estado y borrado: solo quien administra (B2)', () => {
  it('quien abrio el ticket, sin administrar, NO lo cierra', async () => {
    const id = await ticketDe('gA', p.A);
    const { error } = await llamar(ctrl.cambiarEstado, {
      user: u.gA, params: { id: String(id) }, body: { status: 'closed' } });
    expect(error?.statusCode).toBe(403);
    expect(await estadoDe(id)).toBe('open');
  });

  it('ni lo borra', async () => {
    const id = await ticketDe('gA', p.A);
    const { error } = await llamar(ctrl.borrar, { user: u.gA, params: { id: String(id) } });
    expect(error?.statusCode).toBe(403);
    expect(await existe(id)).toBe(true);
  });

  it('el admin de su campus si cambia el estado', async () => {
    const id = await ticketDe('gA', p.A);
    const { error } = await llamar(ctrl.cambiarEstado, {
      user: u.adA, params: { id: String(id) }, body: { status: 'closed' } });
    expect(error).toBeNull();
    expect(await estadoDe(id)).toBe('closed');
  });

  it('al borrar, se borran tambien los ficheros del disco', async () => {
    const id = await ticketDe('gA', p.A);
    const claves = [`tickets/${id}/a-1.png`, `tickets/${id}/a-2.png`];
    for (const clave of claves) {
      await saveLocal(clave, Buffer.from('captura'));
      await model.guardarAdjunto({ ticketId: id, mensajeId: null, nombre: 'x.png', clave,
        mime: 'image/png', bytes: 7, subidoPor: u.gA.userId });
    }
    for (const clave of claves) expect(fs.existsSync(path.join(UPLOADS, clave))).toBe(true);

    const { error } = await llamar(ctrl.borrar, { user: u.adA, params: { id: String(id) } });
    expect(error).toBeNull();
    expect(await existe(id)).toBe(false);
    for (const clave of claves) expect(fs.existsSync(path.join(UPLOADS, clave))).toBe(false);
  });
});

describe('el aviso solo llega a quien puede ver el ticket (B3)', () => {
  const avisados = async (titulo) => {
    for (let i = 0; i < 40; i++) {
      const { rows } = await pool.query(
        `SELECT target_user_ids FROM admin_notifications WHERE title = $1`, [titulo]);
      if (rows[0]) return rows[0].target_user_ids;
      await new Promise((r) => setTimeout(r, 50));
    }
    return undefined;
  };

  it('un ticket del campus A avisa a su admin, a superadmin y a soporte; NO al admin del B', async () => {
    const titulo = '[rev] aviso del campus A';
    await llamar(ctrl.crear, { user: u.gA, body: { title: titulo, projectId: p.A } });
    const objetivo = await avisados(titulo);
    // `null` seria un broadcast a TODOS los admins, el fallo que se corrige.
    expect(objetivo).not.toBeNull();
    expect(objetivo).toEqual(expect.arrayContaining([u.sa.userId, u.so.userId, u.adA.userId]));
    expect(objetivo).not.toContain(u.adB.userId);
    expect(objetivo).not.toContain(u.gB.userId);
    expect(objetivo).not.toContain(u.gA2.userId);
  });

  it('uno sin campus solo avisa a superadmin y soporte, no a los admins de campus', async () => {
    const titulo = '[rev] aviso sin campus';
    await llamar(ctrl.crear, { user: u.gA, body: { title: titulo } });
    const objetivo = await avisados(titulo);
    expect(objetivo).not.toBeNull();
    expect(objetivo).toEqual(expect.arrayContaining([u.sa.userId, u.so.userId]));
    expect(objetivo).not.toContain(u.adA.userId);
    expect(objetivo).not.toContain(u.adB.userId);
  });
});

describe('responder usa una conexion dedicada (B4)', () => {
  it('BEGIN/COMMIT no pasan por pool.query (cada llamada podria ir a otra conexion)', async () => {
    const id = await ticketDe('gA', p.A);
    const espia = vi.spyOn(pool, 'query');
    await model.responder(id, u.sa.userId, 'respuesta', false);
    const sql = espia.mock.calls.map((c) => String(c[0]).trim().toUpperCase());
    espia.mockRestore();
    expect(sql).not.toContain('BEGIN');
    expect(sql).not.toContain('COMMIT');
  });

  it('sigue funcionando: guarda el mensaje y sella la primera respuesta', async () => {
    const id = await ticketDe('gA', p.A);
    await model.responder(id, u.sa.userId, 'respuesta', false);
    const { rows } = await pool.query(
      `SELECT t.primera_respuesta_at, (SELECT COUNT(*)::int FROM ticket_mensajes WHERE ticket_id = t.id) AS n
         FROM tickets t WHERE t.id = $1`, [id]);
    expect(rows[0].n).toBe(1);
    expect(rows[0].primera_respuesta_at).not.toBeNull();
  });

  it('si algo falla a mitad, no queda nada a medias ni se pierde la conexion', async () => {
    // Un autor que no existe rompe el INSERT por la clave foranea: tiene que
    // propagar el error y no dejar el ticket tocado.
    const id = await ticketDe('gA', p.A);
    await expect(model.responder(id, 2000000000, 'x', false)).rejects.toBeTruthy();
    const { rows } = await pool.query(
      `SELECT primera_respuesta_at, (SELECT COUNT(*)::int FROM ticket_mensajes WHERE ticket_id = $1) AS n
         FROM tickets WHERE id = $1`, [id]);
    expect(rows[0].n).toBe(0);
    expect(rows[0].primera_respuesta_at).toBeNull();
  });
});

describe('ids raros y tickets ajenos: siempre 404 (B5)', () => {
  it.each(['abc', '1e3', '-1', '0', '1.5', '99999999999', ' '])(
    'el id «%s» es un 404, no un error de Postgres', async (raro) => {
      for (const h of [ctrl.porId, ctrl.responder, ctrl.cambiarEstado, ctrl.borrar, ctrl.subirAdjunto]) {
        const { error } = await llamar(h, {
          user: u.sa, params: { id: raro }, body: { body: 'x', status: 'closed' },
          file: { originalname: 'a.png', buffer: Buffer.from('x'), mimetype: 'image/png', size: 1 } });
        expect(error?.statusCode, `${h.name} ${raro}`).toBe(404);
      }
    });

  it('un adjunto con id raro tambien', async () => {
    const { error } = await llamar(ctrl.descargarAdjunto, { user: u.sa, params: { adjuntoId: 'abc' } });
    expect(error?.statusCode).toBe(404);
  });

  it('un ticket ajeno da el MISMO 404 que uno que no existe', async () => {
    const id = await ticketDe('gA', p.A);
    const ajeno = await llamar(ctrl.porId, { user: u.gB, params: { id: String(id) } });
    const inexistente = await llamar(ctrl.porId, { user: u.gB, params: { id: '2000000000' } });
    expect(ajeno.error?.statusCode).toBe(404);
    expect(inexistente.error?.statusCode).toBe(404);
    expect(ajeno.error?.message).toBe(inexistente.error?.message);
    expect(ajeno.error?.code).toBe(inexistente.error?.code);
  });

  it('el admin de otro campus tampoco distingue', async () => {
    const id = await ticketDe('gA', p.A);
    const { error } = await llamar(ctrl.porId, { user: u.adB, params: { id: String(id) } });
    expect(error?.statusCode).toBe(404);
  });
});

describe('responderSchema: «false» es false (B5)', () => {
  it.each([
    [false, false], ['false', false], [true, true], ['true', true], [undefined, false],
  ])('interna %j -> %j', (entrada, esperado) => {
    const r = responderSchema.safeParse({ body: 'hola', interna: entrada });
    expect(r.success).toBe(true);
    expect(r.data.interna).toBe(esperado);
  });

  it('un valor que no es booleano se rechaza', () => {
    expect(responderSchema.safeParse({ body: 'hola', interna: 'banana' }).success).toBe(false);
  });

  it('de punta a punta: «false» no convierte la respuesta en nota interna', async () => {
    const id = await ticketDe('gA', p.A);
    const { error } = await llamar(ctrl.responder, {
      user: u.sa, params: { id: String(id) }, body: { body: 'visible', interna: 'false' } });
    expect(error).toBeNull();
    const { rows } = await pool.query('SELECT interna FROM ticket_mensajes WHERE ticket_id = $1', [id]);
    expect(rows[0].interna).toBe(false);
  });
});

describe('freno por usuario al abrir tickets (B6)', () => {
  const token = (user) => jwt.sign(
    { userId: user.userId, email: 'x', role: user.role, roles_extra: [], activeProjectId: null },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  const abrir = (user, n) => request.post('/api/soporte')
    .set('Authorization', `Bearer ${token(user)}`)
    .send({ title: `[rev] freno ${n}`, projectId: p.A });

  it('el ticket 11 de la misma persona en una hora es un 429; otra persona no se ve afectada', async () => {
    const codigos = [];
    for (let i = 1; i <= 11; i++) codigos.push((await abrir(u.gA, i)).status);
    expect(codigos.slice(0, 10)).toEqual(Array(10).fill(201));
    expect(codigos[10]).toBe(429);

    const otra = await abrir(u.gA2, 1);
    expect(otra.status).toBe(201);
  }, 60000);
});
