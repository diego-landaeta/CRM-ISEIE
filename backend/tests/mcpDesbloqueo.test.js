import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
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
const correos = vi.hoisted(() => ({
  sendMcpBloqueoEmail: vi.fn(async () => ({ sent: true })),
  sendMcpAlertasEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('../src/shared/services/brevo.service.js', async (original) => ({ ...(await original()), ...correos }));

const { default: pool } = await import('../src/shared/config/db.js');
const { default: mcp } = await import('../src/modules/mcp/index.js');
const { default: conectores } = await import('../src/modules/connectors/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const conexiones = await import('../src/modules/mcp/mcp.conexiones.js');
const { generarCodigo, huellaCodigo } = await import('../src/modules/mcp/mcp.desbloqueo.js');

const app = express();
app.use(express.json());
app.use(mcp.prefix, mcp.router);
app.use(conectores.prefix, conectores.router);
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

// #260: el código se saca desde la fila de una URL y solo vale para ella.
async function pedirCodigo(u, tok) {
  const r = await request.post(`/api/mcp/panel/tokens/${await tokenIdDe(tok)}/codigo`).set('Authorization', `Bearer ${jwtDe(u)}`).send({});
  expect(r.status).toBe(201);
  return r.body.data.codigo;
}

// Un código para una URL sin pasar por el panel: la URL puede estar bloqueada, y entonces
// el panel se niega a sacarlo (pero alguien puede tener uno sacado de antes).
async function codigoPorSql(u, tok) {
  const codigo = generarCodigo();
  await q(
    `INSERT INTO mcp_codigos (user_id, token_id, codigo_hash, caduca_at) VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')`,
    [u.id, await tokenIdDe(tok), huellaCodigo(codigo)]
  );
  return codigo;
}

// #326: con el código obligatorio, la URL sola ya no da datos: Claude se
// conecta (inicio de sesión, `/token`) y manda la llave de SU conexión. Aquí
// cada URL tiene «su Claude» de siempre, autorizado por su dueño, como si
// hubiera pasado por el inicio de sesión. Las pruebas de la #326 están al final.
const CLAUDE_AI = 'https://claude.ai/api/mcp/auth_callback';
const llaves = new Map();
async function conectarClaude(tok, { autorizar = true } = {}) {
  const c = await conexiones.crear({ secreto: tok, vuelta: CLAUDE_AI });
  if (autorizar) await q(`UPDATE mcp_conexiones SET estado = 'autorizada', decidida_at = NOW() WHERE id = $1`, [c.id]);
  return c;
}
async function llaveDe(tok) {
  if (!llaves.has(tok)) llaves.set(tok, (await conectarClaude(tok)).llave);
  return llaves.get(tok);
}

let idRpc = 0;
async function rpc(tok, cuerpo, llave) {
  return request.post(`/api/mcp/u/${tok}`)
    .set('Accept', 'application/json, text/event-stream')
    .set('Authorization', `Bearer ${llave || await llaveDe(tok)}`)
    .send({ jsonrpc: '2.0', id: ++idRpc, ...cuerpo });
}
async function llamar(tok, name, args = {}, llave = null) {
  const r = await rpc(tok, { method: 'tools/call', params: { name, arguments: args } }, llave);
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
  await q(`DELETE FROM admin_notifications WHERE type = 'mcp_conexion_nueva' AND target_user_ids && $1::int[]`, [ids.users]);
  await q(`DELETE FROM mcp_alertas WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM mcp_auditoria WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM mcp_tokens WHERE connector_id IN (SELECT id FROM project_connectors WHERE project_id = ANY($1::int[]))`, [ids.projects]);
  await q(`DELETE FROM project_connectors WHERE project_id = ANY($1::int[])`, [ids.projects]);
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
  correos.sendMcpAlertasEmail.mockClear();
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
    const lista = async () => (await rpc(TOKEN_LUIS, { method: 'tools/list' })).body.result.tools.map((t) => t.name);
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
      expect(r.texto).toMatch(/Sacar código/);
    }
  });

  it('y remite a la fila de SU URL, por su nombre (#260)', async () => {
    const r = await llamar(TOKEN_ANA, 'mis_proyectos');
    expect(r.texto).toContain('en la fila de la URL «Claude»');
    expect(r.texto).toContain('Un código solo vale para la URL en cuya fila se sacó');
    const otra = await llamar(TOKEN_ANA_2, 'mis_proyectos');
    expect(otra.texto).toContain('en la fila de la URL «Otro equipo»');
  });

  it('y dice cómo seguir si Claude no ve «desbloquear»: el botón del panel (#192, 05/10)', async () => {
    const r = await llamar(TOKEN_ANA, 'mis_proyectos');
    expect(r.texto).toContain('Si no tienes la herramienta «desbloquear», no pidas el código (no podrías usarlo): pide a la persona que pulse «Desbloquear desde aquí»');
    // El botón va primero: con él al final, claude.ai pedía antes el código (06/10).
    expect(r.texto.indexOf('Desbloquear desde aquí')).toBeLessThan(r.texto.indexOf('Sacar código'));
  });

  it('y queda en la auditoría como rechazada', async () => {
    const [f] = await q(
      `SELECT ok, error FROM mcp_auditoria WHERE user_id = $1 AND herramienta = 'mis_proyectos' ORDER BY id DESC LIMIT 1`, [ANA.id]
    );
    expect(f.ok).toBe(false);
    expect(f.error).toMatch(/Sacar código/);
  });
});

describe('el código', () => {
  it('se pide en el panel, con formato XXXX-XXXX, y se guarda solo su huella', async () => {
    const codigo = await pedirCodigo(ANA, TOKEN_ANA);
    expect(codigo).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const filas = await q(`SELECT codigo_hash, token_id FROM mcp_codigos WHERE user_id = $1`, [ANA.id]);
    expect(JSON.stringify(filas)).not.toContain(codigo.replace('-', ''));
    // Y nace atado a su URL (#260), no a la persona.
    expect(filas.every((f) => f.token_id !== null)).toBe(true);
  });

  it('quien no tiene acceso al MCP no puede pedir código', async () => {
    const [g] = await q(
      `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id, role`,
      [`${MARCA} GESTOR`, `gestor@${MARCA.toLowerCase()}.test`]
    );
    ids.users.push(g.id);
    const r = await request.post(`/api/mcp/panel/tokens/${await tokenIdDe(TOKEN_ANA)}/codigo`).set('Authorization', `Bearer ${jwtDe(g)}`).send({});
    expect(r.status).toBe(403);
  });

  it('desbloquea la conexión y entonces sí hay datos', async () => {
    const codigo = await pedirCodigo(ANA, TOKEN_ANA);
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
    const codigo = await pedirCodigo(ANA, TOKEN_ANA_2);
    expect((await llamar(TOKEN_ANA_2, 'desbloquear', { codigo })).ok).toBe(true);
    await q(`UPDATE mcp_conexiones SET desbloqueada_at = NULL WHERE token_id = $1`, [await tokenIdDe(TOKEN_ANA_2)]);
    const r = await llamar(TOKEN_ANA_2, 'desbloquear', { codigo });
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/no vale/);
  });

  it('un código caducado no vale', async () => {
    const codigo = await pedirCodigo(ANA, TOKEN_ANA_2);
    await q(`UPDATE mcp_codigos SET caduca_at = NOW() - INTERVAL '1 second' WHERE user_id = $1 AND usado_at IS NULL`, [ANA.id]);
    expect((await llamar(TOKEN_ANA_2, 'desbloquear', { codigo })).ok).toBe(false);
  });

  it('pedir otro anula el anterior', async () => {
    const viejo = await pedirCodigo(ANA, TOKEN_ANA_2);
    const nuevo = await pedirCodigo(ANA, TOKEN_ANA_2);
    expect((await llamar(TOKEN_ANA_2, 'desbloquear', { codigo: viejo })).ok).toBe(false);
    expect((await llamar(TOKEN_ANA_2, 'desbloquear', { codigo: nuevo })).ok).toBe(true);
  });

  it('el código de otra persona no vale, y lo dice (Diego, 13/10): no suma fallo y avisa', async () => {
    const deAna = await pedirCodigo(ANA, TOKEN_ANA_2);
    const r = await llamar(TOKEN_LUIS, 'desbloquear', { codigo: deAna });
    expect(r.ok).toBe(false);
    expect(r.texto).toContain(`esta URL del MCP es de ${MARCA} LUIS; usa tu propia URL`);
    const [t] = await q(`SELECT fallos_codigo FROM mcp_tokens WHERE id = $1`, [await tokenIdDe(TOKEN_LUIS)]);
    expect(t.fallos_codigo).toBe(0);
    await vi.waitFor(async () => {
      const [a] = await q(`SELECT detalle FROM mcp_alertas WHERE tipo = 'url_compartida' AND user_id = $1`, [LUIS.id]);
      expect(a.detalle.usada_por_id).toBe(ANA.id);
    });
    // Y el código no se gasta: sigue valiendo para la URL de Ana.
    expect((await llamar(TOKEN_ANA_2, 'desbloquear', { codigo: deAna })).ok).toBe(true);
  });

  it('nunca se guarda el código en la auditoría', async () => {
    const filas = await q(`SELECT parametros FROM mcp_auditoria WHERE herramienta = 'desbloquear' AND user_id = ANY($1::int[])`, [ids.users]);
    expect(filas.length).toBeGreaterThan(3);
    expect(filas.every((f) => f.parametros === null)).toBe(true);
  });
});

describe('sin caducidad por horas (Carlos, 13/10; #326)', () => {
  it('desbloqueado, sigue dando datos aunque pasen horas sin usarlo y más de las 9 h de antes', async () => {
    const id = await tokenIdDe(TOKEN_ANA);
    expect((await llamar(TOKEN_ANA, 'desbloquear', { codigo: await pedirCodigo(ANA, TOKEN_ANA) })).ok).toBe(true);
    await q(`UPDATE mcp_conexiones SET desbloqueada_at = NOW() - INTERVAL '3 days', last_used_at = NOW() - INTERVAL '3 days' WHERE token_id = $1`, [id]);
    expect((await llamar(TOKEN_ANA, 'mis_proyectos')).ok).toBe(true);
  });

  it('y Claude lo dice al desbloquear: no volverá a pedir el código', async () => {
    const r = await llamar(TOKEN_ANA, 'desbloquear', { codigo: await pedirCodigo(ANA, TOKEN_ANA) });
    expect(r.texto).toBe('Desbloqueado. Ya puedes consultar el CRM. No volverá a pedir el código mientras esta conexión de Claude siga autorizada.');
  });

  it('las variables de antes del .env ya no cuentan', async () => {
    process.env.MCP_DESBLOQUEO_INACTIVIDAD_MIN = '1';
    process.env.MCP_DESBLOQUEO_MAX_MIN = '1';
    try {
      await q(`UPDATE mcp_conexiones SET desbloqueada_at = NOW() - INTERVAL '1 hour' WHERE token_id = $1`, [await tokenIdDe(TOKEN_ANA)]);
      expect((await llamar(TOKEN_ANA, 'mis_proyectos')).ok).toBe(true);
    } finally {
      delete process.env.MCP_DESBLOQUEO_INACTIVIDAD_MIN;
      delete process.env.MCP_DESBLOQUEO_MAX_MIN;
    }
  });
});

describe('se bloquea al quinto fallo', () => {
  // Una conexión nueva, para contar los fallos desde cero (se acumulan hasta
  // acertar). El código de Ana en la URL de Luis ya no suma (Diego, 13/10).
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
    // Uno sacado de antes: con la URL bloqueada, el panel ya no deja sacarlos (#260).
    const bueno = await codigoPorSql(LUIS, TOKEN_FALLOS);
    expect((await llamar(TOKEN_FALLOS, 'desbloquear', { codigo: bueno })).texto).toMatch(/bloqueada hasta/);
    expect((await llamar(TOKEN_FALLOS, 'mis_proyectos')).texto).toMatch(/bloqueada hasta/);
  });

  it('pasado el bloqueo, el código bueno vuelve a valer', async () => {
    await q(`UPDATE mcp_tokens SET bloqueado_hasta = NOW() - INTERVAL '1 second' WHERE id = $1`, [await tokenIdDe(TOKEN_FALLOS)]);
    const bueno = await pedirCodigo(LUIS, TOKEN_FALLOS);
    expect((await llamar(TOKEN_FALLOS, 'desbloquear', { codigo: bueno })).ok).toBe(true);
    expect((await llamar(TOKEN_FALLOS, 'mis_proyectos')).ok).toBe(true);
  });
});

// ─── El panel: el estado de cada URL y «Desbloquear desde aquí» (#192; #326) ───

const panelDe = async (u) => (await request.get('/api/mcp/panel').set('Authorization', `Bearer ${jwtDe(u)}`)).body.data;
const desbloquearDesdeAqui = (u, id) => request.post(`/api/mcp/panel/tokens/${id}/desbloquear`)
  .set('Authorization', `Bearer ${jwtDe(u)}`).send({});
const decidir = (u, id, decision) => request.patch(`/api/mcp/panel/conexiones/${id}`)
  .set('Authorization', `Bearer ${jwtDe(u)}`).send({ decision });
const hhmm = /\d{2}:\d{2}/;

describe('el estado de cada URL en el panel, sin horas (#326)', () => {
  let U; let TOK; let ID;
  beforeAll(async () => {
    U = await persona('ESTADOS', 'admin');
    TOK = (await token(U, 'Estados')).token;
    ID = await tokenIdDe(TOK);
  });
  const suEstado = async () => (await panelDe(U)).tokens.find((t) => t.id === ID).codigo;

  it('sin ningún Claude conectado: lo dice', async () => {
    expect(await suEstado()).toMatchObject({ estado: 'sin_desbloquear', texto: 'Ningún Claude conectado todavía con esta URL', conexiones: [] });
  });

  it('con su Claude autorizado y sin código: pedirá el código en la próxima consulta', async () => {
    await llaveDe(TOK);
    const e = await suEstado();
    expect(e).toMatchObject({ estado: 'sin_desbloquear', texto: '1 Claude autorizado (pedirá el código en la próxima consulta)' });
    expect(e.conexiones).toHaveLength(1);
    expect(e.conexiones[0]).toMatchObject({ cliente: 'claude', estado: 'autorizada', desbloqueada: false });
  });

  it('desbloqueado: sin ninguna hora, porque ya no caduca', async () => {
    expect((await llamar(TOK, 'desbloquear', { codigo: await pedirCodigo(U, TOK) })).ok).toBe(true);
    const e = await suEstado();
    expect(e).toMatchObject({ estado: 'desbloqueada', hasta: null, texto: '1 Claude autorizado y desbloqueado' });
    expect(e.texto).not.toMatch(hhmm);
  });

  it('bloqueada por códigos falsos: «Bloqueada hasta las HH:MM»', async () => {
    await q(`UPDATE mcp_tokens SET bloqueado_hasta = NOW() + INTERVAL '15 minutes' WHERE id = $1`, [ID]);
    const e = await suEstado();
    expect(e.estado).toBe('bloqueada');
    expect(e.texto).toMatch(/^Bloqueada hasta (mañana a )?las \d{2}:\d{2}$/);
    await q(`UPDATE mcp_tokens SET bloqueado_hasta = NULL WHERE id = $1`, [ID]);
  });

  it('código apagado: no se enseña nada', async () => {
    process.env.MCP_CODIGO_OBLIGATORIO = 'false';
    const p = await panelDe(U);
    expect(p.tokens.find((t) => t.id === ID).codigo).toBeNull();
    expect(p.codigo.urls).toEqual([]);
    expect(p.codigo).not.toHaveProperty('inactividadMin');
  });
});

// ─── #260 (Diego, 07/10): el código es de una URL, se saca desde su fila ───

describe('#260 · el código va con su URL', () => {
  let U; let A; let B; let IDA; let IDB;
  const sacar = (u, id) => request.post(`/api/mcp/panel/tokens/${id}/codigo`).set('Authorization', `Bearer ${jwtDe(u)}`).send({});
  beforeAll(async () => {
    U = await persona('PORURL', 'admin');
    A = (await token(U, 'URL A')).token;
    B = (await token(U, 'URL B')).token;
    IDA = await tokenIdDe(A);
    IDB = await tokenIdDe(B);
  });

  it('se saca desde la fila de la URL: nace con su token_id y solo se guarda la huella', async () => {
    const r = await sacar(U, IDA);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ id: IDA, minutos: 10 });
    expect(r.body.data.codigo).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const [fila] = await q(`SELECT token_id, user_id, usado_at FROM mcp_codigos WHERE codigo_hash = $1`, [huellaCodigo(r.body.data.codigo)]);
    expect(fila).toMatchObject({ token_id: IDA, user_id: U.id, usado_at: null });
  });

  it('la ruta de antes, la suelta de la persona, ya no existe', async () => {
    const r = await request.post('/api/mcp/panel/codigo').set('Authorization', `Bearer ${jwtDe(U)}`).send({});
    expect(r.status).toBe(404);
  });

  it('sin URL no hay código: una que no existe, 404 y no se crea nada', async () => {
    const antes = (await q(`SELECT COUNT(*)::int AS n FROM mcp_codigos WHERE user_id = $1`, [U.id]))[0].n;
    expect((await sacar(U, 2147483000)).status).toBe(404);
    expect((await q(`SELECT COUNT(*)::int AS n FROM mcp_codigos WHERE user_id = $1`, [U.id]))[0].n).toBe(antes);
  });

  it('ni para la URL de otra persona', async () => {
    const antes = (await q(`SELECT COUNT(*)::int AS n FROM mcp_codigos WHERE user_id = ANY($1::int[])`, [[U.id, LUIS.id]]))[0].n;
    expect((await sacar(U, await tokenIdDe(TOKEN_LUIS))).status).toBe(404);
    expect((await sacar(LUIS, IDA)).status).toBe(404);
    expect((await q(`SELECT COUNT(*)::int AS n FROM mcp_codigos WHERE user_id = ANY($1::int[])`, [[U.id, LUIS.id]]))[0].n).toBe(antes);
  });

  it('ni para una URL revocada ni caducada', async () => {
    const rev = await token(U, 'Revocada');
    expect((await sacar(U, rev.id)).status).toBe(201);
    await q(`UPDATE mcp_tokens SET revoked_at = NOW() WHERE id = $1`, [rev.id]);
    expect((await sacar(U, rev.id)).status).toBe(404);
    const cad = await token(U, 'Caducada');
    await q(`UPDATE mcp_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [cad.id]);
    expect((await sacar(U, cad.id)).status).toBe(404);
  });

  it('ni para una URL bloqueada por códigos falsos: 409 y dice hasta cuándo', async () => {
    const blo = await token(U, 'Bloqueada');
    await q(`UPDATE mcp_tokens SET bloqueado_hasta = NOW() + INTERVAL '15 minutes' WHERE id = $1`, [blo.id]);
    const r = await sacar(U, blo.id);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('MCP_URL_BLOQUEADA');
  });

  it('con el código apagado no hace falta: 400', async () => {
    process.env.MCP_CODIGO_OBLIGATORIO = 'false';
    expect((await sacar(U, IDA)).status).toBe(400);
  });

  it('un código sacado para la URL A desbloquea la A', async () => {
    const codigo = await pedirCodigo(U, A);
    expect((await llamar(A, 'desbloquear', { codigo })).ok).toBe(true);
    expect((await llamar(A, 'mis_proyectos')).ok).toBe(true);
  });

  it('...y NO desbloquea la B: lo dice, suma fallo y no se gasta', async () => {
    const codigo = await pedirCodigo(U, A);
    const antes = (await q(`SELECT fallos_codigo FROM mcp_tokens WHERE id = $1`, [IDB]))[0].fallos_codigo;
    const r = await llamar(B, 'desbloquear', { codigo });
    expect(r.ok).toBe(false);
    expect(r.texto).toContain('Ese código es de otra URL de la persona («URL A»)');
    expect(r.texto).toMatch(/Quedan \d intentos/);
    expect((await q(`SELECT fallos_codigo FROM mcp_tokens WHERE id = $1`, [IDB]))[0].fallos_codigo).toBe(antes + 1);
    expect((await llamar(B, 'mis_proyectos')).ok).toBe(false);
    // Sin gastarse: sigue valiendo en la A.
    await q(`UPDATE mcp_conexiones SET desbloqueada_at = NULL WHERE token_id = $1`, [IDA]);
    expect((await llamar(A, 'desbloquear', { codigo })).ok).toBe(true);
  });

  it('y la B se desbloquea con SU código', async () => {
    expect((await llamar(B, 'desbloquear', { codigo: await pedirCodigo(U, B) })).ok).toBe(true);
    expect((await llamar(B, 'mis_proyectos')).ok).toBe(true);
  });

  it('pedir otro para la A anula el anterior de la A, pero no toca el de la B', async () => {
    const deB = await pedirCodigo(U, B);
    const viejoA = await pedirCodigo(U, A);
    const nuevoA = await pedirCodigo(U, A);
    await q(`UPDATE mcp_conexiones SET desbloqueada_at = NULL WHERE token_id = ANY($1::int[])`, [[IDA, IDB]]);
    expect((await llamar(A, 'desbloquear', { codigo: viejoA })).ok).toBe(false);
    expect((await llamar(A, 'desbloquear', { codigo: nuevoA })).ok).toBe(true);
    expect((await llamar(B, 'desbloquear', { codigo: deB })).ok).toBe(true);
  });

  it('un código de antes de esta versión, sin URL, ya no vale en ninguna', async () => {
    const viejo = generarCodigo();
    await q(
      `INSERT INTO mcp_codigos (user_id, token_id, codigo_hash, caduca_at) VALUES ($1, NULL, $2, NOW() + INTERVAL '10 minutes')`,
      [U.id, huellaCodigo(viejo)]
    );
    await q(`UPDATE mcp_conexiones SET desbloqueada_at = NULL WHERE token_id = $1`, [IDA]);
    const r = await llamar(A, 'desbloquear', { codigo: viejo });
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/no vale/);
  });

  it('el panel trae TODAS sus URLs vivas, estén o no en el ámbito que mira, para avisar de las que la lista esconde', async () => {
    const cx = await request.post('/api/connectors').set('Authorization', `Bearer ${jwtDe(U)}`)
      .send({ project_id: ids.projects[0], type: 'mcp', label: `${MARCA} Otro ámbito`, alcance: 'campus' });
    expect(cx.status).toBe(201);
    const { codigo } = await panelDe(U);
    expect(codigo).not.toHaveProperty('resumen');
    const nombres = codigo.urls.map((u) => u.nombre);
    expect(nombres).toEqual(expect.arrayContaining(['URL A', 'URL B', `${MARCA} Otro ámbito`]));
    // Y dónde está cada una (el campus de su conexión), para decir a cuál cambiar.
    expect(codigo.urls.find((u) => u.nombre === `${MARCA} Otro ámbito`).ambito).toBe(`${MARCA} Campus`);
    expect(nombres).not.toContain('Revocada');
    expect(nombres).not.toContain('Caducada');
  });
});

describe('«Desbloquear desde aquí» (opción 3 de Diego)', () => {
  let U; let OTRA; let TOK; let ID;
  beforeAll(async () => {
    U = await persona('BOTON', 'admin');
    OTRA = await persona('OTRA', 'admin');
    TOK = (await token(U, 'Lista vieja')).token;
    ID = await tokenIdDe(TOK);
  });

  it('el caso de Diego: Claude sin «desbloquear», se pulsa el botón y ya hay datos', async () => {
    // Igual que su claude.ai: con la lista guardada no llama a «desbloquear», solo consulta.
    const antes = await llamar(TOK, 'mis_proyectos');
    expect(antes.ok).toBe(false);
    expect(antes.texto).toMatch(/Desbloquear desde aquí/);
    const r = await desbloquearDesdeAqui(U, ID);
    expect(r.status).toBe(200);
    expect(r.body.data.codigo.estado).toBe('desbloqueada');
    expect((await llamar(TOK, 'mis_proyectos')).ok).toBe(true);
  });

  it('no borra los fallos de código: ese contador solo lo vacía un código bueno (#262)', async () => {
    await q(`UPDATE mcp_tokens SET fallos_codigo = 3 WHERE id = $1`, [ID]);
    expect((await desbloquearDesdeAqui(U, ID)).status).toBe(200);
    const [t] = await q(`SELECT fallos_codigo FROM mcp_tokens WHERE id = $1`, [ID]);
    expect(t.fallos_codigo).toBe(3);
    await q(`UPDATE mcp_tokens SET fallos_codigo = 0 WHERE id = $1`, [ID]);
  });

  it('desbloquea sin código y sin caducidad (#326)', async () => {
    const [c] = await q(`SELECT desbloqueada_at, codigo_id FROM mcp_conexiones WHERE token_id = $1 AND estado = 'autorizada'`, [ID]);
    expect(c.desbloqueada_at).toBeTruthy();
    expect(c.codigo_id).toBeNull();
  });

  it('queda en la Actividad', async () => {
    const [f] = await q(
      `SELECT ok, ip, cliente FROM mcp_auditoria WHERE token_id = $1 AND herramienta = 'desbloquear_panel' ORDER BY id DESC LIMIT 1`, [ID]
    );
    // Sin IP ni cliente: el navegador no es un Claude y la vigilancia no debe tomarlo por uno nuevo.
    expect(f).toEqual({ ok: true, ip: null, cliente: null });
  });

  it('un Claude pendiente de autorizar no se desbloquea con el botón (#326)', async () => {
    const pendiente = await conectarClaude(TOK, { autorizar: false });
    expect((await desbloquearDesdeAqui(U, ID)).status).toBe(200);
    expect((await llamar(TOK, 'mis_proyectos', {}, pendiente.llave)).texto).toMatch(/pendiente de autorizar/);
  });

  it('una URL sin ningún Claude autorizado: 409 y lo explica (#326)', async () => {
    const t = await token(U, 'Sin Claude');
    const r = await desbloquearDesdeAqui(U, t.id);
    expect(r.status).toBe(409);
    expect(r.body.error || r.body.message).toMatch(/ningún Claude autorizado/);
  });

  it('la URL de otra persona, no: 404 y sigue cerrada', async () => {
    const otro = (await token(OTRA, 'Ajena')).token;
    const idOtro = await tokenIdDe(otro);
    expect((await desbloquearDesdeAqui(U, idOtro)).status).toBe(404);
    expect((await llamar(otro, 'mis_proyectos')).ok).toBe(false);
  });

  it('una URL revocada, no', async () => {
    const t = await token(U, 'Revocada');
    await request.delete(`/api/mcp/panel/tokens/${t.id}`).set('Authorization', `Bearer ${jwtDe(U)}`);
    expect((await desbloquearDesdeAqui(U, t.id)).status).toBe(404);
  });

  it('bloqueada por códigos falsos, no: hay que esperar', async () => {
    const t = await token(U, 'Bloqueada');
    await llaveDe(t.token);
    await q(`UPDATE mcp_tokens SET bloqueado_hasta = NOW() + INTERVAL '15 minutes' WHERE id = $1`, [t.id]);
    const r = await desbloquearDesdeAqui(U, t.id);
    expect(r.status).toBe(409);
    expect(r.body.error || r.body.message).toMatch(/bloqueada hasta las \d{2}:\d{2}/);
    expect((await llamar(t.token, 'mis_proyectos')).texto).toMatch(/bloqueada hasta/);
  });

  it('con el código apagado no hace falta: 400', async () => {
    process.env.MCP_CODIGO_OBLIGATORIO = 'false';
    expect((await desbloquearDesdeAqui(U, ID)).status).toBe(400);
  });

  it('quien no tiene acceso al MCP, no', async () => {
    const [g] = await q(
      `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id, role`,
      [`${MARCA} GESTOR2`, `gestor2@${MARCA.toLowerCase()}.test`]
    );
    ids.users.push(g.id);
    expect((await desbloquearDesdeAqui(g, ID)).status).toBe(403);
  });
});

describe('una gestora con acceso, en «Tu URL personal»', () => {
  it('ve el estado de su URL y la desbloquea con el botón', async () => {
    const G = await persona('GESTORA', 'gestor');
    await q(`UPDATE users SET usa_mcp = true WHERE id = $1`, [G.id]);
    // La casilla de antes es la excepción «Usar el MCP» (#423, migración 222).
    await q(`INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, 'mcp', 'usar', true)`, [G.id]);
    const t = await token(G, 'Portátil');
    const suya = async () => (await panelDe(G)).tokens.find((x) => x.id === t.id).codigo;
    expect((await llamar(t.token, 'mis_proyectos')).ok).toBe(false);
    expect((await suya()).estado).toBe('sin_desbloquear');
    expect((await desbloquearDesdeAqui(G, t.id)).status).toBe(200);
    expect((await suya()).estado).toBe('desbloqueada');
    expect((await llamar(t.token, 'mis_proyectos')).ok).toBe(true);
  });
});

describe('en «Conexiones de Claude» (mcp_mio de cada conexión)', () => {
  it('trae cuándo caduca la URL, su estado y sus Claude, y el botón la desbloquea', async () => {
    const U = await persona('CONEXION', 'admin');
    const auth = { Authorization: `Bearer ${jwtDe(U)}` };
    const cx = await request.post('/api/connectors').set(auth)
      .send({ project_id: ids.projects[0], type: 'mcp', label: `${MARCA} Claude`, alcance: 'campus' });
    expect(cx.status).toBe(201);
    const mia = async () => (await request.get(`/api/connectors?tipo=mcp&projectId=${ids.projects[0]}`).set(auth))
      .body.data.find((c) => c.id === cx.body.data.id).mcp_mio;

    const antes = await mia();
    expect(antes.expires_at).toBeTruthy();
    expect(antes.codigo).toMatchObject({ estado: 'sin_desbloquear', conexiones: [] });

    // Su Claude se conecta (aquí directo en la base: la URL del conector solo se enseña al crearla).
    await q(
      `INSERT INTO mcp_conexiones (token_id, user_id, llave_hash, llave_semilla, cliente, estado, decidida_at)
       VALUES ($1, $2, encode(sha256($3::bytea), 'hex'), 'prueba', 'claude', 'autorizada', NOW())`,
      [antes.id, U.id, `crm_mcc_${MARCA}_${'x'.repeat(40)}`]
    );
    expect((await desbloquearDesdeAqui(U, antes.id)).status).toBe(200);
    const despues = await mia();
    expect(despues.codigo.estado).toBe('desbloqueada');
    expect(despues.codigo.conexiones).toHaveLength(1);
  });
});

// ─── #326 (13/10): cada Claude conectado, con el permiso de su dueño ───

describe('#326 · la URL sola ya no da datos: Claude tiene que conectarse', () => {
  it('sin llave de conexión: 401 con la dirección del inicio de sesión, para que Claude se conecte', async () => {
    const r = await request.post(`/api/mcp/u/${TOKEN_ANA}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/list' });
    expect(r.status).toBe(401);
    expect(r.headers['www-authenticate']).toContain(`resource_metadata="http://127.0.0.1`);
    expect(r.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource/api/mcp/u/crm_mcp_');
    expect(r.body.error.message).toMatch(/Conéctate primero/);
  });

  it('con la llave de la URL en la cabecera, tampoco', async () => {
    const r = await request.post(`/api/mcp/u/${TOKEN_ANA}`).set('Authorization', `Bearer ${TOKEN_ANA}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/list' });
    expect(r.status).toBe(401);
  });

  it('la llave de una conexión con OTRA URL en la dirección, no', async () => {
    const r = await rpc(TOKEN_ANA, { method: 'tools/list' }, await llaveDe(TOKEN_LUIS));
    expect(r.status).toBe(401);
  });

  it('con el código apagado, todo sigue como antes: la URL sola vale', async () => {
    process.env.MCP_CODIGO_OBLIGATORIO = 'false';
    const r = await request.post(`/api/mcp/u/${TOKEN_ANA}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/call', params: { name: 'mis_proyectos', arguments: {} } });
    expect(r.status).toBe(200);
    expect(r.body.result.isError).toBeFalsy();
  });
});

describe('#326 · un Claude nuevo queda pendiente hasta que el dueño lo autoriza', () => {
  let U; let TOK; let ID; let MIO; let INTRUSO;
  beforeAll(async () => {
    U = await persona('DUENA', 'admin');
    TOK = (await token(U, 'Su portátil')).token;
    ID = await tokenIdDe(TOK);
  });

  it('su primer Claude: pendiente, sin datos, y le llega un aviso a la campana', async () => {
    MIO = await conectarClaude(TOK, { autorizar: false });
    expect(MIO.estado).toBe('pendiente');
    const r = await llamar(TOK, 'mis_proyectos', {}, MIO.llave);
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/pendiente de autorizar/);
    const [n] = await q(
      `SELECT title, link_path, target_user_ids FROM admin_notifications WHERE type = 'mcp_conexion_nueva' AND target_user_ids = ARRAY[$1::int] ORDER BY id DESC LIMIT 1`, [U.id]
    );
    expect(n).toMatchObject({ title: 'Un Claude pide conectarse con tu URL', link_path: '/conexion/mcp' });
  });

  it('con el código bueno, aún pendiente: lo acepta pero sigue sin datos y dice que falta autorizar', async () => {
    const d = await llamar(TOK, 'desbloquear', { codigo: await pedirCodigo(U, TOK) }, MIO.llave);
    expect(d.ok).toBe(true);
    expect(d.texto).toMatch(/Falta un paso: esta conexión de Claude está pendiente de autorizar/);
    expect((await llamar(TOK, 'mis_proyectos', {}, MIO.llave)).ok).toBe(false);
  });

  it('el panel lo enseña debajo de su URL, pendiente', async () => {
    const e = (await panelDe(U)).tokens.find((t) => t.id === ID).codigo;
    expect(e.estado).toBe('pendiente');
    expect(e.texto).toBe('1 Claude pendiente de autorizar');
    expect(e.conexiones[0]).toMatchObject({ id: MIO.id, estado: 'pendiente' });
  });

  it('otra persona no puede autorizarlo; el super admin tampoco (solo rechazar)', async () => {
    const S = await persona('SUPER', 'superadmin');
    expect((await decidir(LUIS, MIO.id, 'autorizar')).status).toBe(403);
    expect((await decidir(S, MIO.id, 'autorizar')).status).toBe(403);
  });

  it('la dueña lo autoriza y ya hay datos, sin volver a pedir el código', async () => {
    expect((await decidir(U, MIO.id, 'autorizar')).status).toBe(200);
    expect((await llamar(TOK, 'mis_proyectos', {}, MIO.llave)).ok).toBe(true);
    const [a] = await q(`SELECT herramienta FROM mcp_auditoria WHERE token_id = $1 AND herramienta LIKE 'conexion_%' ORDER BY id DESC LIMIT 1`, [ID]);
    expect(a.herramienta).toBe('conexion_autorizada');
  });

  it('LA URL SE CUELA: otro Claude con la misma URL queda pendiente y sin datos, aunque la URL esté desbloqueada', async () => {
    INTRUSO = await conectarClaude(TOK, { autorizar: false });
    expect((await llamar(TOK, 'mis_proyectos', {}, MIO.llave)).ok).toBe(true);
    const r = await llamar(TOK, 'mis_proyectos', {}, INTRUSO.llave);
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/pendiente de autorizar/);
  });

  it('y aunque consiga un código bueno de la dueña, sigue sin datos', async () => {
    expect((await llamar(TOK, 'desbloquear', { codigo: await pedirCodigo(U, TOK) }, INTRUSO.llave)).ok).toBe(true);
    expect((await llamar(TOK, 'mis_proyectos', {}, INTRUSO.llave)).ok).toBe(false);
  });

  it('la dueña lo rechaza: el intruso queda fuera y su Claude sigue funcionando', async () => {
    expect((await decidir(U, INTRUSO.id, 'rechazar')).status).toBe(200);
    const r = await llamar(TOK, 'mis_proyectos', {}, INTRUSO.llave);
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/ha rechazado esta conexión/);
    expect((await llamar(TOK, 'desbloquear', { codigo: await pedirCodigo(U, TOK) }, INTRUSO.llave)).ok).toBe(false);
    expect((await llamar(TOK, 'mis_proyectos', {}, MIO.llave)).ok).toBe(true);
    // Rechazado, ya no sale en el panel.
    const e = (await panelDe(U)).tokens.find((t) => t.id === ID).codigo;
    expect(e.conexiones.map((c) => c.id)).toEqual([MIO.id]);
  });

  it('el super admin puede rechazar el Claude de otra persona, y lo ve en su lista', async () => {
    const otro = await conectarClaude(TOK, { autorizar: false });
    const S = await persona('SUPER2', 'superadmin');
    const lista = (await panelDe(S)).conexionesDelEquipo;
    expect(lista.map((c) => c.id)).toContain(otro.id);
    expect((await decidir(S, otro.id, 'rechazar')).status).toBe(200);
    expect((await llamar(TOK, 'mis_proyectos', {}, otro.llave)).ok).toBe(false);
  });

  it('el refresco de Claude devuelve la MISMA llave: una consulta en marcha no se queda sin conexión', async () => {
    const renovada = await conexiones.renovarLlave(MIO.id);
    expect(renovada).toEqual({ id: MIO.id, llave: MIO.llave });
    expect((await llamar(TOK, 'mis_proyectos', {}, renovada.llave)).ok).toBe(true);
  });

  it('revocar la URL corta todos sus Claude', async () => {
    await request.delete(`/api/mcp/panel/tokens/${ID}`).set('Authorization', `Bearer ${jwtDe(U)}`);
    expect((await rpc(TOK, { method: 'tools/list' }, MIO.llave)).status).toBe(401);
    // Y el refresco ya no da llave.
    expect(await conexiones.renovarLlave(MIO.id)).toBeNull();
  });
});

describe('#326 · MCP_CONEXIONES_EXISTENTES_APROBADAS (lo decide Diego al desplegar)', () => {
  afterEach(() => { delete process.env.MCP_CONEXIONES_EXISTENTES_APROBADAS; });

  it('encendido: la PRIMERA conexión de una URL que ya existía entra autorizada; las demás, pendientes', async () => {
    process.env.MCP_CONEXIONES_EXISTENTES_APROBADAS = 'true';
    const t = await token(ANA, 'De antes');
    await q(`UPDATE mcp_tokens SET anterior_a_conexiones = true WHERE id = $1`, [t.id]);
    expect((await conectarClaude(t.token, { autorizar: false })).estado).toBe('autorizada');
    expect((await conectarClaude(t.token, { autorizar: false })).estado).toBe('pendiente');
  });

  it('encendido, pero una URL nueva: pendiente', async () => {
    process.env.MCP_CONEXIONES_EXISTENTES_APROBADAS = 'true';
    const t = await token(ANA, 'Nueva');
    expect((await conectarClaude(t.token, { autorizar: false })).estado).toBe('pendiente');
  });

  it('apagado (por defecto): pendiente siempre', async () => {
    const t = await token(ANA, 'De antes, apagado');
    await q(`UPDATE mcp_tokens SET anterior_a_conexiones = true WHERE id = $1`, [t.id]);
    expect((await conectarClaude(t.token, { autorizar: false })).estado).toBe('pendiente');
  });
});
