import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #833 (gemela de CRM#1199) · El cambio de correo pendiente y su historial, en la ficha de Usuarios.
 *
 * Si alguien dice «no me llega el código», administración tiene que poder ver
 * si lo pidió, a qué dirección, hasta cuándo vale y cuántos intentos lleva; y
 * anularlo. Con el permiso `users.cambios_correo` (de serie, superadmin y
 * soporte) y solo de la gente de sus campus.
 *
 * Lo que defiende esta prueba:
 *   - sin el permiso, 403; de otro campus, 404 (como si no existiera);
 *   - nunca sale el código ni su hash;
 *   - una petición señuelo (la dirección ya es de otra persona) se ve igual que
 *     una de verdad: la ficha no lo delata;
 *   - anular deja el código sin valor, y queda en el registro;
 *   - el historial dice de qué correo a cuál y cuándo;
 *   - y el registro tampoco: a un admin de campus no le dice por qué no se
 *     mandó un código (que la dirección ya tenía cuenta); a soporte, sí.
 *
 * Contra la base local, con las rutas y los permisos de verdad. Brevo,
 * simulado: no sale ningún correo.
 */

const enviados = vi.hoisted(() => []);
vi.mock('../src/shared/services/brevo.service.js', async (original) => ({
  ...(await original()),
  sendCodigoCambioCorreoEmail: vi.fn(async (m) => { enviados.push(m); return { sent: true }; }),
  sendCorreoCambiadoEmail: vi.fn(async () => ({ sent: true })),
  sendEmail: vi.fn(async () => ({ sent: true })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { pedirCodigo, confirmarCodigo } = await import('../src/modules/users/cambio-de-correo.js');
const { default: usersModule } = await import('../src/modules/users/index.js');
const { default: registroModule } = await import('../src/modules/registro/index.js');

const app = express();
app.use(express.json());
app.use(usersModule.prefix, usersModule.router);
app.use(registroModule.prefix, registroModule.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `F833${Date.now().toString(36)}`.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
let A; let C;
let SOPORTE; let ADMIN_CON; let ADMIN_SIN; let ANA; let OTRA_DE_C;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const ver = (quien, persona) => request.get(`/api/users/${persona.id}/cambios-de-correo`).set(como(quien));
const anular = (quien, persona) => request.post(`/api/users/${persona.id}/cambios-de-correo/anular`).set(como(quien));
// El código sale sin esperar (#688): se deja correr la cola.
const pedir = async (args) => { const r = await pedirCodigo(args); await new Promise((ok) => setImmediate(ok)); return r; };
const ultimoCodigo = () => enviados[enviados.length - 1]?.codigo;

beforeAll(async () => {
  const campus = async (n) => {
    const p = await one(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${n}`, `${MARCA}-${n}`, `${MARCA}-k-${n}`]);
    ids.projects.push(p.id); return p.id;
  };
  A = await campus('a'); C = await campus('c');
  const persona = async (n, role, suyos) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role, email`,
      [`${MARCA} ${n}`, `${n}@${MARCA}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  // Sin superadmin de prueba: otras pruebas cuentan los de la base mientras
  // corren a la vez (certifexDiplomas). Soporte lo ve todo igual.
  SOPORTE = await persona('soporte', 'soporte', []);
  ADMIN_CON = await persona('admincon', 'admin', [A]);
  ADMIN_SIN = await persona('adminsin', 'admin', [A]);
  ANA = await persona('ana', 'gestor', [A]);
  OTRA_DE_C = await persona('otra', 'gestor', [C]);
  // El permiso es de soporte: a un admin, como excepción suya.
  await q(`INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, 'users', 'cambios_correo', true)`, [ADMIN_CON.id]);
}, 60000);

beforeEach(async () => {
  enviados.length = 0;
  await q('UPDATE users SET email = $2 WHERE id = $1', [ANA.id, ANA.email]);
  await q('DELETE FROM cambios_de_correo WHERE user_id = ANY($1::int[])', [ids.users]);
});

afterAll(async () => {
  await q('DELETE FROM cambios_de_correo WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM refresh_tokens WHERE user_id = ANY($1::int[])', [ids.users]).catch(() => {});
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
});

describe('quién lo ve', () => {
  it('sin el permiso, 403 al ver y al anular', async () => {
    await pedir({ userId: ANA.id, emailNuevo: `ana.nueva@${MARCA}.test` });
    expect((await ver(ADMIN_SIN, ANA)).status).toBe(403);
    expect((await anular(ADMIN_SIN, ANA)).status).toBe(403);
    // Y no anuló nada.
    expect((await one('SELECT anulado_at FROM cambios_de_correo WHERE user_id = $1', [ANA.id])).anulado_at).toBeNull();
  });

  it('con el permiso, la de su campus sí; la de otro campus, 404 al ver y al anular', async () => {
    await pedir({ userId: OTRA_DE_C.id, emailNuevo: `otra.nueva@${MARCA}.test` });
    expect((await ver(ADMIN_CON, ANA)).status).toBe(200);
    const fuera = await ver(ADMIN_CON, OTRA_DE_C);
    expect(fuera.status).toBe(404);
    expect(JSON.stringify(fuera.body)).not.toContain('otra.nueva');
    expect((await anular(ADMIN_CON, OTRA_DE_C)).status).toBe(404);
    expect((await one('SELECT anulado_at FROM cambios_de_correo WHERE user_id = $1', [OTRA_DE_C.id])).anulado_at).toBeNull();
  });

  it('un id que no existe, 404', async () => {
    expect((await ver(SOPORTE, { id: 2147480000 })).status).toBe(404);
  });

  it('soporte ve a cualquiera, de cualquier campus', async () => {
    expect((await ver(SOPORTE, OTRA_DE_C)).status).toBe(200);
  });
});

describe('lo que enseña', () => {
  it('el pendiente: a qué dirección, cuándo lo pidió, hasta cuándo e intentos; nunca el código ni su hash', async () => {
    const nuevo = `ana.nueva@${MARCA}.test`;
    await pedir({ userId: ANA.id, emailNuevo: nuevo });
    const codigo = ultimoCodigo();
    await confirmarCodigo({ userId: ANA.id, codigo: codigo === '000000' ? '111111' : '000000' }).catch(() => {});
    const res = await ver(ADMIN_CON, ANA);
    expect(res.status).toBe(200);
    const { pendiente, historial, intentos_max } = res.body.data;
    expect(pendiente).toMatchObject({ estado: 'pendiente', de: ANA.email, a: nuevo, intentos: 1 });
    expect(new Date(pendiente.expira_at) > new Date(pendiente.pedido_at)).toBe(true);
    expect(intentos_max).toBe(5);
    expect(historial).toEqual([]);
    const fila = await one('SELECT codigo_hash FROM cambios_de_correo WHERE user_id = $1', [ANA.id]);
    const todo = JSON.stringify(res.body);
    expect(todo).not.toContain(fila.codigo_hash.trim());
    expect(todo).not.toContain(codigo);
    expect(todo).not.toMatch(/hash/i);
  });

  it('una dirección que ya es de otra persona se ve IGUAL que una libre: la ficha no lo delata', async () => {
    await pedir({ userId: ANA.id, emailNuevo: `libre@${MARCA}.test` });
    const libre = (await ver(SOPORTE, ANA)).body.data;
    await q('DELETE FROM cambios_de_correo WHERE user_id = $1', [ANA.id]);
    await pedir({ userId: ANA.id, emailNuevo: OTRA_DE_C.email });
    const deOtra = (await ver(SOPORTE, ANA)).body.data;
    expect(Object.keys(deOtra.pendiente).sort()).toEqual(Object.keys(libre.pendiente).sort());
    expect(deOtra.pendiente).toMatchObject({ estado: 'pendiente', de: ANA.email, a: OTRA_DE_C.email, intentos: 0 });
    expect(JSON.stringify(deOtra)).not.toMatch(/no_mandado|otro usuario|otra persona/i);
    // Ni rastro de la otra persona: solo lo que se enseña de cualquier petición.
    expect(Object.keys(deOtra.pendiente).sort()).toEqual(['a', 'cuando', 'de', 'estado', 'expira_at', 'id', 'intentos', 'pedido_at']);
  });

  it('el historial: confirmados y anulados, de qué correo a cuál y cuándo, el último primero', async () => {
    const primero = `ana.uno@${MARCA}.test`;
    await pedir({ userId: ANA.id, emailNuevo: primero });
    await confirmarCodigo({ userId: ANA.id, codigo: ultimoCodigo() });
    const segundo = `ana.dos@${MARCA}.test`;
    await pedir({ userId: ANA.id, emailNuevo: segundo });
    await anular(SOPORTE, ANA);
    const { pendiente, historial } = (await ver(SOPORTE, ANA)).body.data;
    expect(pendiente).toBeNull();
    expect(historial.map((h) => [h.estado, h.de, h.a])).toEqual([
      ['anulado', primero, segundo],
      ['confirmado', ANA.email, primero],
    ]);
    expect(historial.every((h) => h.cuando)).toBe(true);
  });

  it('uno que caducó sin confirmarse sale como «caducado», no como pendiente', async () => {
    await pedir({ userId: ANA.id, emailNuevo: `ana.tarde@${MARCA}.test` });
    await q(`UPDATE cambios_de_correo SET expira_at = NOW() - INTERVAL '1 minute', creado_at = creado_at - INTERVAL '20 minutes' WHERE user_id = $1`, [ANA.id]);
    const { pendiente, historial } = (await ver(SOPORTE, ANA)).body.data;
    expect(pendiente).toBeNull();
    expect(historial[0].estado).toBe('caducado');
  });
});

describe('«Anular»', () => {
  it('deja la petición sin efecto: su código ya no vale y el correo no cambia', async () => {
    const nuevo = `ana.anulada@${MARCA}.test`;
    await pedir({ userId: ANA.id, emailNuevo: nuevo });
    const codigo = ultimoCodigo();
    const res = await anular(ADMIN_CON, ANA);
    expect(res.status).toBe(200);
    expect(res.body.data.pendiente).toBeNull();
    expect(res.body.data.historial[0]).toMatchObject({ estado: 'anulado', a: nuevo });
    await expect(confirmarCodigo({ userId: ANA.id, codigo })).rejects.toMatchObject({ code: 'SIN_CODIGO' });
    expect((await one('SELECT email FROM users WHERE id = $1', [ANA.id])).email).toBe(ANA.email);
  });

  it('queda en el registro quién lo anuló, y a qué dirección iba', async () => {
    await pedir({ userId: ANA.id, emailNuevo: `ana.reg@${MARCA}.test` });
    await anular(ADMIN_CON, ANA);
    const r = await one(`SELECT user_id, details FROM user_activity_log
                          WHERE action = 'usuario.anular_cambio_correo' AND user_id = $1 ORDER BY id DESC LIMIT 1`, [ADMIN_CON.id]);
    expect(r.details).toMatchObject({ usuario_id: ANA.id, a: `ana.reg@${MARCA}.test` });
  });

  it('sin nada pendiente, 404 y no anota nada', async () => {
    const antes = Number((await one(`SELECT COUNT(*) n FROM user_activity_log WHERE action = 'usuario.anular_cambio_correo' AND user_id = $1`, [SOPORTE.id])).n);
    const res = await anular(SOPORTE, ANA);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SIN_PENDIENTE');
    const despues = Number((await one(`SELECT COUNT(*) n FROM user_activity_log WHERE action = 'usuario.anular_cambio_correo' AND user_id = $1`, [SOPORTE.id])).n);
    expect(despues).toBe(antes);
  });
});

describe('el registro tampoco lo delata', () => {
  const filaDelPedido = async (quien) => {
    const res = await request.get(`/api/registro?usuarioId=${ANA.id}&fuentes=usuario`).set(como(quien));
    expect(res.status).toBe(200);
    return res.body.data.filas.find((f) => f.accion === 'usuario.pedir_cambio_correo');
  };

  it('a un admin de su campus no le dice que la dirección ya era de otra persona; a soporte, sí', async () => {
    await pedir({ userId: ANA.id, emailNuevo: OTRA_DE_C.email });
    const delAdmin = await filaDelPedido(ADMIN_SIN);
    expect(delAdmin).toBeTruthy();
    expect(delAdmin.detalle).toMatchObject({ usuario_id: ANA.id, a: OTRA_DE_C.email });
    expect(JSON.stringify(delAdmin)).not.toMatch(/no_mandado|otro usuario/);
    const deSoporte = await filaDelPedido(SOPORTE);
    expect(deSoporte.detalle.no_mandado).toMatch(/otro usuario/);
  });

  it('y una petición normal se ve igual para los dos', async () => {
    await pedir({ userId: ANA.id, emailNuevo: `ana.normal@${MARCA}.test` });
    const delAdmin = await filaDelPedido(ADMIN_SIN);
    const deSoporte = await filaDelPedido(SOPORTE);
    expect(delAdmin.detalle).toEqual(deSoporte.detalle);
  });

  // ISEIE tiene además la pantalla «Actividad» (GET /api/users/activity-log), con el mismo detalle.
  it('ni la pantalla «Actividad»: al admin, sin el porqué; a soporte, con él', async () => {
    await pedir({ userId: ANA.id, emailNuevo: OTRA_DE_C.email });
    const actividad = async (quien) => {
      const res = await request.get(`/api/users/activity-log?userId=${ANA.id}&action=usuario.pedir_cambio_correo`).set(como(quien));
      expect(res.status).toBe(200);
      return res.body.data[0];
    };
    const delAdmin = await actividad(ADMIN_SIN);
    expect(delAdmin.details).toMatchObject({ usuario_id: ANA.id, a: OTRA_DE_C.email });
    expect(JSON.stringify(delAdmin)).not.toMatch(/no_mandado|otro usuario/);
    expect((await actividad(SOPORTE)).details.no_mandado).toMatch(/otro usuario/);
  });
});
