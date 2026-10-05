import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Caducidad, rotación y URLs sin usar del MCP (#194), contra la base de verdad.
 *
 *   · caducidad configurable (90 días por defecto);
 *   · correo al dueño 7 días antes, una sola vez;
 *   · revocar solas las URLs que lleven 30 días sin usarse;
 *   · guardar desde dónde se usó por última vez (IP y cliente);
 *   · al desactivar a una persona, revocar sus URLs (quitar la casilla sigue pausando).
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/mcpRotacion.test.js
 */

const correos = vi.hoisted(() => ({
  sendMcpCaducidadEmail: vi.fn(async () => ({ sent: true })),
  sendMcpBloqueoEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('../src/shared/services/brevo.service.js', async (original) => ({ ...(await original()), ...correos }));

const { default: pool } = await import('../src/shared/config/db.js');
const { default: mcp } = await import('../src/modules/mcp/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { vuelta } = await import('../src/jobs/mcpRotacionScheduler.js');
const userService = await import('../src/modules/users/user.service.js');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(mcp.prefix, mcp.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `MCPROT${Date.now().toString(36)}`;
const ids = { users: [], projects: [] };
let ANA; let GESTOR;

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const jwtDe = (u) => jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' });

async function persona(nombre, role, extra = '') {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role${extra ? ', usa_mcp' : ''})
     VALUES ($1, $2, 'x', $3${extra ? ', true' : ''}) RETURNING id, role, email`,
    [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]
  );
  ids.users.push(u.id);
  await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, ids.projects[0]]);
  return u;
}

async function crearUrl(u, nombre = 'Claude') {
  const r = await request.post('/api/mcp/panel/tokens').set('Authorization', `Bearer ${jwtDe(u)}`).send({ nombre });
  expect(r.status).toBe(201);
  const [fila] = await q(`SELECT * FROM mcp_tokens WHERE id = $1`, [r.body.data.id]);
  return { token: r.body.data.token, id: r.body.data.id, fila };
}

const usar = (token, ua = 'claude-code/9.9.9 (prueba)') => request.post(`/api/mcp/u/${token}`)
  .set('Accept', 'application/json, text/event-stream')
  .set('User-Agent', ua)
  .set('X-Forwarded-For', '203.0.113.7')
  .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

const fila = async (id) => (await q(`SELECT * FROM mcp_tokens WHERE id = $1`, [id]))[0];

beforeAll(async () => {
  const [p] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`]
  );
  ids.projects.push(p.id);
  ANA = await persona('ANA', 'admin');
  GESTOR = await persona('GESTOR', 'gestor', 'usa_mcp');
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM mcp_auditoria WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM mcp_tokens WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM user_refresh_tokens WHERE user_id = ANY($1::int[])`, [ids.users]).catch(() => {});
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

beforeEach(async () => {
  // Cada prueba crea sus URLs: las de la anterior se revocan para no chocar
  // con el límite de 5 activas por persona.
  await q(`UPDATE mcp_tokens SET revoked_at = NOW() WHERE user_id = ANY($1::int[]) AND revoked_at IS NULL`, [ids.users]);
  delete process.env.MCP_TOKEN_DIAS;
  delete process.env.MCP_TOKEN_AVISO_DIAS;
  delete process.env.MCP_TOKEN_SIN_USO_DIAS;
  process.env.MCP_CODIGO_OBLIGATORIO = 'false';
  correos.sendMcpCaducidadEmail.mockReset().mockResolvedValue({ sent: true });
});

describe('caducidad configurable', () => {
  it('por defecto, 90 días', async () => {
    const { fila: f } = await crearUrl(ANA);
    const dias = (new Date(f.expires_at) - new Date(f.created_at)) / 86400000;
    expect(Math.round(dias)).toBe(90);
  });

  it('MCP_TOKEN_DIAS la cambia; 0 = no caduca', async () => {
    process.env.MCP_TOKEN_DIAS = '30';
    const a = await crearUrl(ANA, 'treinta');
    expect(Math.round((new Date(a.fila.expires_at) - new Date(a.fila.created_at)) / 86400000)).toBe(30);
    process.env.MCP_TOKEN_DIAS = '0';
    const b = await crearUrl(ANA, 'sin fin');
    expect(b.fila.expires_at).toBeNull();
  });

  it('una URL caducada ya no entra', async () => {
    const { token, id } = await crearUrl(ANA, 'caduca');
    expect((await usar(token)).status).toBe(200);
    await q(`UPDATE mcp_tokens SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [id]);
    expect((await usar(token)).status).toBe(401);
  });
});

describe('desde dónde se usó por última vez', () => {
  it('guarda la IP y el cliente, y el panel los enseña', async () => {
    const { token, id } = await crearUrl(ANA, 'origen');
    await usar(token, 'Claude-User');
    await vi.waitFor(async () => expect((await fila(id)).last_used_cliente).toBe('Claude-User'));
    expect((await fila(id)).last_used_ip).toBe('203.0.113.7');

    const panel = await request.get('/api/mcp/panel').set('Authorization', `Bearer ${jwtDe(ANA)}`);
    const t = panel.body.data.tokens.find((x) => x.id === id);
    expect(t.last_used_cliente).toBe('Claude-User');
    expect(t.last_used_ip).toBe('203.0.113.7');
  });

  it('otra IP en el mismo minuto NO reescribe la fila (Anthropic cambia de IP casi en cada consulta)', async () => {
    const { token, id } = await crearUrl(ANA, 'ip cambiante');
    await usar(token, 'Claude-User');
    await vi.waitFor(async () => expect((await fila(id)).last_used_ip).toBe('203.0.113.7'));
    await request.post(`/api/mcp/u/${token}`).set('Accept', 'application/json, text/event-stream')
      .set('User-Agent', 'Claude-User').set('X-Forwarded-For', '203.0.113.99')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    await new Promise((r) => setTimeout(r, 200));
    expect((await fila(id)).last_used_ip).toBe('203.0.113.7');
  });

  it('si cambia el cliente, se apunta aunque no haya pasado el minuto', async () => {
    const { token, id } = await crearUrl(ANA, 'cambia');
    await usar(token, 'Claude-User');
    await vi.waitFor(async () => expect((await fila(id)).last_used_cliente).toBe('Claude-User'));
    await usar(token, 'claude-code/1.0');
    await vi.waitFor(async () => expect((await fila(id)).last_used_cliente).toBe('claude-code/1.0'));
  });
});

describe('la vuelta: URLs sin usar', () => {
  it('revoca las que llevan 30 días sin usarse, y las que nunca se estrenaron', async () => {
    const vieja = await crearUrl(ANA, 'sin usar 31 días');
    const nueva = await crearUrl(ANA, 'usada ayer');
    const nunca = await crearUrl(ANA, 'nunca usada');
    // Una URL «de hace tiempo»: creada, y empezando a contar, hace 40 días.
    const envejecer = (id) => q(`UPDATE mcp_tokens SET created_at = NOW() - INTERVAL '40 days', rotacion_desde = NOW() - INTERVAL '40 days' WHERE id = $1`, [id]);
    for (const u of [vieja, nueva, nunca]) await envejecer(u.id);
    await q(`UPDATE mcp_tokens SET last_used_at = NOW() - INTERVAL '31 days' WHERE id = $1`, [vieja.id]);
    await q(`UPDATE mcp_tokens SET last_used_at = NOW() - INTERVAL '1 day' WHERE id = $1`, [nueva.id]);

    await vuelta();

    expect((await fila(vieja.id)).revocado_motivo).toBe('sin_uso');
    expect((await fila(nunca.id)).revocado_motivo).toBe('sin_uso');
    expect((await fila(nueva.id)).revoked_at).toBeNull();
    expect((await usar(vieja.token)).status).toBe(401);
  });

  it('tras desplegar, las URLs viejas empiezan a contar ese día: no se revocan de golpe', async () => {
    // Revisión de la #196: creada hace 60 días y sin usar desde hace 50, pero
    // la #194 se desplegó HOY (rotacion_desde = ahora). La primera vuelta no la
    // puede revocar sin aviso.
    const vieja = await crearUrl(ANA, 'de antes del despliegue');
    await q(`UPDATE mcp_tokens SET created_at = NOW() - INTERVAL '60 days', last_used_at = NOW() - INTERVAL '50 days',
             rotacion_desde = NOW() WHERE id = $1`, [vieja.id]);
    await vuelta();
    expect((await fila(vieja.id)).revoked_at).toBeNull();
  });

  it('MCP_TOKEN_SIN_USO_DIAS=0 lo apaga', async () => {
    process.env.MCP_TOKEN_SIN_USO_DIAS = '0';
    const v = await crearUrl(ANA, 'vieja pero sin rotación');
    await q(`UPDATE mcp_tokens SET last_used_at = NOW() - INTERVAL '200 days', rotacion_desde = NOW() - INTERVAL '200 days' WHERE id = $1`, [v.id]);
    await vuelta();
    expect((await fila(v.id)).revoked_at).toBeNull();
  });
});

describe('la vuelta: aviso antes de caducar', () => {
  it('un correo por persona con las URLs que caducan en 7 días, y una sola vez', async () => {
    const pronto = await crearUrl(GESTOR, 'caduca en 3 días');
    const tarde = await crearUrl(GESTOR, 'caduca en 20 días');
    await q(`UPDATE mcp_tokens SET expires_at = NOW() + INTERVAL '3 days', last_used_at = NOW() WHERE id = $1`, [pronto.id]);
    await q(`UPDATE mcp_tokens SET expires_at = NOW() + INTERVAL '20 days', last_used_at = NOW() WHERE id = $1`, [tarde.id]);

    await vuelta();
    const delGestor = correos.sendMcpCaducidadEmail.mock.calls.filter(([a]) => a.persona.email === GESTOR.email);
    expect(delGestor).toHaveLength(1);
    const [{ urls, enlace }] = delGestor[0];
    expect(urls.map((u) => u.id)).toEqual([pronto.id]);
    expect(enlace).toMatch(/\/conexion\/mcp$/);

    correos.sendMcpCaducidadEmail.mockClear();
    await vuelta();
    expect(correos.sendMcpCaducidadEmail.mock.calls.filter(([a]) => a.persona.email === GESTOR.email)).toHaveLength(0);
  });

  it('si el correo no sale, no se marca: se reintenta en la siguiente vuelta', async () => {
    const u = await crearUrl(GESTOR, 'correo que falla');
    await q(`UPDATE mcp_tokens SET expires_at = NOW() + INTERVAL '2 days', last_used_at = NOW() WHERE id = $1`, [u.id]);
    correos.sendMcpCaducidadEmail.mockResolvedValue({ sent: false, reason: 'NO_API_KEY' });
    await vuelta();
    expect((await fila(u.id)).aviso_caducidad_at).toBeNull();
    correos.sendMcpCaducidadEmail.mockResolvedValue({ sent: true });
    await vuelta();
    expect((await fila(u.id)).aviso_caducidad_at).not.toBeNull();
  });
});

describe('revocar o pausar', () => {
  it('revocar a mano deja el motivo «manual»', async () => {
    const u = await crearUrl(ANA, 'a mano');
    await request.delete(`/api/mcp/panel/tokens/${u.id}`).set('Authorization', `Bearer ${jwtDe(ANA)}`).expect(200);
    expect((await fila(u.id)).revocado_motivo).toBe('manual');
  });

  it('quitar la CASILLA de acceso sigue pausando: no revoca', async () => {
    const u = await crearUrl(GESTOR, 'pausada');
    await request.patch(`/api/mcp/panel/personas/${GESTOR.id}`).set('Authorization', `Bearer ${jwtDe(ANA)}`)
      .send({ usa_mcp: false }).expect(200);
    expect((await usar(u.token)).status).toBe(403);
    expect((await fila(u.id)).revoked_at).toBeNull();
    await request.patch(`/api/mcp/panel/personas/${GESTOR.id}`).set('Authorization', `Bearer ${jwtDe(ANA)}`)
      .send({ usa_mcp: true }).expect(200);
  });

  it('DESACTIVAR a la persona revoca todas sus URLs, y no vuelven al reactivarla', async () => {
    const u1 = await crearUrl(GESTOR, 'equipo 1');
    const u2 = await crearUrl(GESTOR, 'equipo 2');
    await userService.deactivate(GESTOR.id);
    for (const u of [u1, u2]) {
      const f = await fila(u.id);
      expect(f.revoked_at).not.toBeNull();
      expect(f.revocado_motivo).toBe('usuario_desactivado');
    }
    await q(`UPDATE users SET active = true WHERE id = $1`, [GESTOR.id]);
    expect((await usar(u1.token)).status).toBe(401);
  });
});
