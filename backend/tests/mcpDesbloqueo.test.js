import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Código de desbloqueo del MCP (#192), contra la base de verdad.
 *
 * Lo que pide la issue:
 *   · sin código no sale ningún dato;
 *   · un código caducado o ya usado no vale;
 *   · se bloquea al quinto fallo (y se avisa por correo).
 * Y lo que decide el diseño (comentario del 03/10): el desbloqueo es de la
 * CONEXIÓN y caduca por inactividad y por un máximo.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/mcpDesbloqueo.test.js
 */

// El correo de bloqueo no sale de verdad: se comprueba que se pide.
const correos = vi.hoisted(() => ({ sendMcpBloqueoEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('../src/shared/services/brevo.service.js', async (original) => ({ ...(await original()), ...correos }));

const { default: pool } = await import('../src/shared/config/db.js');
const { default: mcp } = await import('../src/modules/mcp/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(mcp.prefix, mcp.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `MCPCOD${Date.now().toString(36)}`;
const ids = { users: [], projects: [] };
let ANA; let LUIS; let TOKEN_ANA; let TOKEN_ANA_2; let TOKEN_LUIS;

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const jwtDe = (u) => jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' });

async function persona(nombre, role) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]
  );
  ids.users.push(u.id);
  await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, ids.projects[0]]);
  return u;
}

async function token(u, nombre = 'Claude') {
  const r = await request.post('/api/mcp/panel/tokens').set('Authorization', `Bearer ${jwtDe(u)}`).send({ nombre });
  if (r.status !== 201) throw new Error(`token: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
}

async function pedirCodigo(u) {
  const r = await request.post('/api/mcp/panel/codigo').set('Authorization', `Bearer ${jwtDe(u)}`).send({});
  expect(r.status).toBe(201);
  return r.body.data.codigo;
}

let idRpc = 0;
async function llamar(tok, name, args = {}) {
  const r = await request.post(`/api/mcp/u/${tok}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/call', params: { name, arguments: args } });
  expect(r.status).toBe(200);
  return { ok: !r.body.result.isError, texto: r.body.result.content[0].text };
}

beforeAll(async () => {
  const [p] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`]
  );
  ids.projects.push(p.id);
  ANA = await persona('ANA', 'admin');
  LUIS = await persona('LUIS', 'admin');
  TOKEN_ANA = (await token(ANA)).token;
  TOKEN_ANA_2 = (await token(ANA, 'Otro equipo')).token;
  TOKEN_LUIS = (await token(LUIS)).token;
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM mcp_auditoria WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM mcp_desbloqueos WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM mcp_codigos WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM mcp_tokens WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

beforeEach(() => {
  process.env.MCP_CODIGO_OBLIGATORIO = 'true';
  correos.sendMcpBloqueoEmail.mockClear();
});

const tokenIdDe = async (tok) => (await q(
  `SELECT id FROM mcp_tokens WHERE token_hash = encode(sha256($1::bytea), 'hex')`, [tok]
))[0].id;

describe('con el interruptor apagado, todo sigue como antes', () => {
  it('sin código se consulta', async () => {
    process.env.MCP_CODIGO_OBLIGATORIO = 'false';
    expect((await llamar(TOKEN_LUIS, 'mis_proyectos')).ok).toBe(true);
  });

  it('y «desbloquear» ni aparece: Claude ve las mismas herramientas que antes', async () => {
    const lista = async () => (await request.post(`/api/mcp/u/${TOKEN_LUIS}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/list' })).body.result.tools.map((t) => t.name);
    process.env.MCP_CODIGO_OBLIGATORIO = 'false';
    expect(await lista()).not.toContain('desbloquear');
    process.env.MCP_CODIGO_OBLIGATORIO = 'true';
    expect(await lista()).toContain('desbloquear');
  });
});

describe('sin código no sale ningún dato', () => {
  it('cada herramienta contesta que hace falta el código', async () => {
    for (const h of ['mis_proyectos', 'buscar_prospectos', 'listar_ventas', 'resumen_facturas']) {
      const r = await llamar(TOKEN_ANA, h);
      expect(r.ok).toBe(false);
      expect(r.texto).toMatch(/Código para Claude/);
    }
  });

  it('y queda en la auditoría como rechazada', async () => {
    const [f] = await q(
      `SELECT ok, error FROM mcp_auditoria WHERE user_id = $1 AND herramienta = 'mis_proyectos' ORDER BY id DESC LIMIT 1`, [ANA.id]
    );
    expect(f.ok).toBe(false);
    expect(f.error).toMatch(/Código para Claude/);
  });
});

describe('el código', () => {
  it('se pide en el panel, con formato XXXX-XXXX, y se guarda solo su huella', async () => {
    const codigo = await pedirCodigo(ANA);
    expect(codigo).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const filas = await q(`SELECT codigo_hash FROM mcp_codigos WHERE user_id = $1`, [ANA.id]);
    expect(JSON.stringify(filas)).not.toContain(codigo.replace('-', ''));
  });

  it('quien no tiene acceso al MCP no puede pedir código', async () => {
    const [g] = await q(
      `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id, role`,
      [`${MARCA} GESTOR`, `gestor@${MARCA.toLowerCase()}.test`]
    );
    ids.users.push(g.id);
    const r = await request.post('/api/mcp/panel/codigo').set('Authorization', `Bearer ${jwtDe(g)}`).send({});
    expect(r.status).toBe(403);
  });

  it('desbloquea la conexión y entonces sí hay datos', async () => {
    const codigo = await pedirCodigo(ANA);
    // Claude puede escribirlo en minúsculas o sin guion.
    const d = await llamar(TOKEN_ANA, 'desbloquear', { codigo: codigo.toLowerCase().replace('-', ' ') });
    expect(d.ok).toBe(true);
    expect(d.texto).toMatch(/Desbloqueado/);
    expect((await llamar(TOKEN_ANA, 'mis_proyectos')).ok).toBe(true);
  });

  it('el desbloqueo es de ESA conexión: la otra URL de la misma persona sigue cerrada', async () => {
    expect((await llamar(TOKEN_ANA_2, 'mis_proyectos')).ok).toBe(false);
  });

  it('un código ya usado no vale', async () => {
    const codigo = await pedirCodigo(ANA);
    expect((await llamar(TOKEN_ANA_2, 'desbloquear', { codigo })).ok).toBe(true);
    await q(`DELETE FROM mcp_desbloqueos WHERE token_id = $1`, [await tokenIdDe(TOKEN_ANA_2)]);
    const r = await llamar(TOKEN_ANA_2, 'desbloquear', { codigo });
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/no vale/);
  });

  it('un código caducado no vale', async () => {
    const codigo = await pedirCodigo(ANA);
    await q(`UPDATE mcp_codigos SET caduca_at = NOW() - INTERVAL '1 second' WHERE user_id = $1 AND usado_at IS NULL`, [ANA.id]);
    expect((await llamar(TOKEN_ANA_2, 'desbloquear', { codigo })).ok).toBe(false);
  });

  it('pedir otro anula el anterior', async () => {
    const viejo = await pedirCodigo(ANA);
    const nuevo = await pedirCodigo(ANA);
    expect((await llamar(TOKEN_ANA_2, 'desbloquear', { codigo: viejo })).ok).toBe(false);
    expect((await llamar(TOKEN_ANA_2, 'desbloquear', { codigo: nuevo })).ok).toBe(true);
  });

  it('el código de otra persona no vale', async () => {
    const deAna = await pedirCodigo(ANA);
    expect((await llamar(TOKEN_LUIS, 'desbloquear', { codigo: deAna })).ok).toBe(false);
  });

  it('nunca se guarda el código en la auditoría', async () => {
    const filas = await q(`SELECT parametros FROM mcp_auditoria WHERE herramienta = 'desbloquear' AND user_id = ANY($1::int[])`, [ids.users]);
    expect(filas.length).toBeGreaterThan(3);
    expect(filas.every((f) => f.parametros === null)).toBe(true);
  });
});

describe('caducidad del desbloqueo', () => {
  it('tras el tiempo sin uso se vuelve a cerrar', async () => {
    const id = await tokenIdDe(TOKEN_ANA);
    expect((await llamar(TOKEN_ANA, 'mis_proyectos')).ok).toBe(true);
    await q(`UPDATE mcp_desbloqueos SET ultimo_uso_at = NOW() - INTERVAL '121 minutes' WHERE token_id = $1`, [id]);
    expect((await llamar(TOKEN_ANA, 'mis_proyectos')).ok).toBe(false);
  });

  it('y al llegar al máximo, aunque se use seguido', async () => {
    const id = await tokenIdDe(TOKEN_ANA);
    expect((await llamar(TOKEN_ANA, 'desbloquear', { codigo: await pedirCodigo(ANA) })).ok).toBe(true);
    await q(`UPDATE mcp_desbloqueos SET caduca_max_at = NOW() - INTERVAL '1 second' WHERE token_id = $1`, [id]);
    expect((await llamar(TOKEN_ANA, 'mis_proyectos')).ok).toBe(false);
  });

  it('los tiempos salen del .env', async () => {
    const id = await tokenIdDe(TOKEN_ANA);
    expect((await llamar(TOKEN_ANA, 'desbloquear', { codigo: await pedirCodigo(ANA) })).ok).toBe(true);
    await q(`UPDATE mcp_desbloqueos SET ultimo_uso_at = NOW() - INTERVAL '30 minutes' WHERE token_id = $1`, [id]);
    process.env.MCP_DESBLOQUEO_INACTIVIDAD_MIN = '20';
    try {
      expect((await llamar(TOKEN_ANA, 'mis_proyectos')).ok).toBe(false);
    } finally {
      delete process.env.MCP_DESBLOQUEO_INACTIVIDAD_MIN;
    }
  });
});

describe('se bloquea al quinto fallo', () => {
  // Una conexión nueva: la de antes ya lleva un fallo (el código de Ana), y los
  // fallos se acumulan hasta acertar.
  let TOKEN_FALLOS;
  beforeAll(async () => { TOKEN_FALLOS = (await token(LUIS, 'Para fallar')).token; });

  it('cuatro fallos avisan de cuántos quedan; el quinto bloquea y avisa por correo', async () => {
    for (let i = 1; i <= 4; i++) {
      const r = await llamar(TOKEN_FALLOS, 'desbloquear', { codigo: 'ZZZZ-ZZZZ' });
      expect(r.texto).toMatch(new RegExp(`Quedan ${5 - i} intentos`));
    }
    const quinto = await llamar(TOKEN_FALLOS, 'desbloquear', { codigo: 'ZZZZ-ZZZZ' });
    expect(quinto.ok).toBe(false);
    expect(quinto.texto).toMatch(/bloqueada hasta/);
    await vi.waitFor(() => expect(correos.sendMcpBloqueoEmail).toHaveBeenCalledTimes(1));
    const { para } = correos.sendMcpBloqueoEmail.mock.calls[0][0];
    expect(para.map((p) => p.email)).toContain(`luis@${MARCA.toLowerCase()}.test`);
  });

  it('bloqueada, ni el código bueno vale ni sale ningún dato', async () => {
    const bueno = await pedirCodigo(LUIS);
    expect((await llamar(TOKEN_FALLOS, 'desbloquear', { codigo: bueno })).texto).toMatch(/bloqueada hasta/);
    expect((await llamar(TOKEN_FALLOS, 'mis_proyectos')).texto).toMatch(/bloqueada hasta/);
  });

  it('pasado el bloqueo, el código bueno vuelve a valer', async () => {
    await q(`UPDATE mcp_tokens SET bloqueado_hasta = NOW() - INTERVAL '1 second' WHERE id = $1`, [await tokenIdDe(TOKEN_FALLOS)]);
    const bueno = await pedirCodigo(LUIS);
    expect((await llamar(TOKEN_FALLOS, 'desbloquear', { codigo: bueno })).ok).toBe(true);
    expect((await llamar(TOKEN_FALLOS, 'mis_proyectos')).ok).toBe(true);
  });
});
