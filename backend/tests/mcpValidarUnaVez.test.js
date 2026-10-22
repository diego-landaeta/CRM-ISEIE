import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * «Solo debe validarse una vez» (Diego, 22/10), contra la base de verdad.
 *
 * Diego: «volvió la validación de 2 horas». Mirado en producción el 22/10: el
 * código desplegado en los dos CRM es el de la #326, que no caduca por horas, y
 * el único Claude conectado por el inicio de sesión (el de Tony, 20/10) no ha
 * tenido que validar nada más desde entonces. Lo que se repetía era otra cosa:
 * los conectores de claude.ai que se añadieron ANTES de la #326 consultan con la
 * URL sola, el CRM les contesta 401 para que se conecten, no se conectan solos,
 * y la persona veía «conecta el CRM» en cada conversación nueva sin que nada le
 * dijera qué hacer.
 *
 * Aquí se prueban las dos cosas:
 *
 *   · El recorrido entero de un Claude que se conecta (inicio de sesión con
 *     PKCE, el dueño lo autoriza, el código una vez) y que sigue consultando
 *     horas y días después, también con el refresco de Claude, sin que se vuelva
 *     a pedir nada. Es la guarda de que no vuelvan las 2 h: si una fusión las
 *     resucita (ya ha pasado con otros arreglos), esto se pone en rojo.
 *   · El Claude conectado a la manera de antes: 401, y a su dueño le llega qué
 *     tiene que hacer (aviso a la campana y texto debajo de su URL). Con el
 *     código de antes de este arreglo, estas pruebas fallan: nadie le avisaba y
 *     el panel decía «Ningún Claude conectado todavía».
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/mcpValidarUnaVez.test.js
 */

const correos = vi.hoisted(() => ({
  sendMcpBloqueoEmail: vi.fn(async () => ({ sent: true })),
  sendMcpAlertasEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('../src/shared/services/brevo.service.js', async (original) => ({ ...(await original()), ...correos }));

const { default: pool } = await import('../src/shared/config/db.js');
const { default: mcp } = await import('../src/modules/mcp/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const conexiones = await import('../src/modules/mcp/mcp.conexiones.js');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(mcp.prefix, mcp.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `MCPUNA${Date.now().toString(36)}`;
const ids = { users: [], projects: [] };
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const jwtDe = (u) => jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' });
const ahoraEnLaBase = async () => (await q('SELECT NOW() AS t'))[0].t;

async function persona(nombre, role) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]
  );
  ids.users.push(u.id);
  await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, ids.projects[0]]);
  return u;
}

/** Una URL personal, sacada en el panel como lo hace la persona. */
async function crearUrl(u, nombre) {
  const r = await request.post('/api/mcp/panel/tokens').set('Authorization', `Bearer ${jwtDe(u)}`).send({ nombre });
  if (r.status !== 201) throw new Error(`token: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
}

/** Una URL de antes de la #326 que su Claude ya usaba sin iniciar sesión. */
async function urlDeAntes(u, nombre) {
  const t = await crearUrl(u, nombre);
  await q(`UPDATE mcp_tokens SET anterior_a_conexiones = true, last_used_at = NOW() - INTERVAL '6 days' WHERE id = $1`, [t.id]);
  return t;
}

const VUELTA = 'https://claude.ai/api/mcp/auth_callback';

/** Lo que hace claude.ai al pulsar «Conectar»: el inicio de sesión entero, con PKCE. */
async function conectarClaude(tok) {
  const verificador = crypto.randomBytes(32).toString('base64url');
  const reto = crypto.createHash('sha256').update(verificador).digest('base64url');
  const a = await request.get('/api/mcp/oauth/authorize').query({
    response_type: 'code', client_id: 'crm-prueba', redirect_uri: VUELTA, state: 'st',
    code_challenge: reto, code_challenge_method: 'S256', resource: `https://360crm.tech/crm/api/mcp/u/${tok}`,
  });
  expect(a.status).toBe(302);
  const code = new URL(a.headers.location).searchParams.get('code');
  const t = await request.post('/api/mcp/oauth/token').type('form').send({
    grant_type: 'authorization_code', code, code_verifier: verificador, redirect_uri: VUELTA, client_id: 'crm-prueba',
  });
  expect(t.status).toBe(200);
  return t.body;
}

let idRpc = 0;
const rpc = (tok, cuerpo, llave) => {
  const r = request.post(`/api/mcp/u/${tok}`).set('Accept', 'application/json, text/event-stream');
  if (llave) r.set('Authorization', `Bearer ${llave}`);
  return r.send({ jsonrpc: '2.0', id: ++idRpc, ...cuerpo });
};
async function llamar(tok, llave, name, args = {}) {
  const r = await rpc(tok, { method: 'tools/call', params: { name, arguments: args } }, llave);
  expect(r.status).toBe(200);
  return { ok: !r.body.result.isError, texto: r.body.result.content[0].text };
}

const panelDe = async (u) => (await request.get('/api/mcp/panel').set('Authorization', `Bearer ${jwtDe(u)}`)).body.data;
const textoDeLaUrl = async (u, id) => (await panelDe(u)).tokens.find((t) => t.id === id).codigo.texto;
const avisosDe = (u) => q(
  `SELECT title, message, link_path, metadata FROM admin_notifications
    WHERE type = 'mcp_conector_antiguo' AND target_user_ids = ARRAY[$1::int] ORDER BY id`, [u.id]
);

/** Echa atrás todos los relojes de esta URL y de sus Claude, como si hubiera pasado ese tiempo sin usarlos. */
async function pasa(tokenId, intervalo) {
  await q(
    `UPDATE mcp_conexiones
        SET created_at = created_at - $2::interval, decidida_at = decidida_at - $2::interval,
            desbloqueada_at = desbloqueada_at - $2::interval, last_used_at = last_used_at - $2::interval
      WHERE token_id = $1`, [tokenId, intervalo]
  );
  await q(`UPDATE mcp_codigos SET created_at = created_at - $2::interval, caduca_at = caduca_at - $2::interval,
                                  usado_at = usado_at - $2::interval WHERE token_id = $1`, [tokenId, intervalo]);
  await q(`UPDATE mcp_tokens SET last_used_at = last_used_at - $2::interval WHERE id = $1`, [tokenId, intervalo]);
}

beforeAll(async () => {
  const [p] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`]
  );
  ids.projects.push(p.id);
}, 60000);

afterAll(async () => {
  conexiones._olvidarAvisos();
  await q(`DELETE FROM admin_notifications WHERE type IN ('mcp_conexion_nueva', 'mcp_conector_antiguo') AND target_user_ids && $1::int[]`, [ids.users]);
  await q(`DELETE FROM mcp_alertas WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM mcp_auditoria WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM mcp_codigos WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM mcp_tokens WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

beforeEach(() => {
  // Como en las dos producciones desde el 16/10.
  process.env.MCP_CODIGO_OBLIGATORIO = 'true';
  delete process.env.MCP_CONEXIONES_EXISTENTES_APROBADAS;
});

describe('un Claude que se conecta se valida UNA vez y no caduca por horas', () => {
  let ANA; let URL_ANA; let CLAUDE;

  beforeAll(async () => {
    ANA = await persona('ANA', 'admin');
    URL_ANA = await crearUrl(ANA, 'Su portátil');
  });

  it('el inicio de sesión le da a Claude una llave de días, no de horas, y con qué refrescarla', async () => {
    CLAUDE = await conectarClaude(URL_ANA.token);
    expect(CLAUDE.access_token).toMatch(/^crm_mcc_/);
    expect(CLAUDE.expires_in).toBeGreaterThanOrEqual(7 * 24 * 3600);
    expect(CLAUDE.refresh_token).toBeTruthy();
    const m = await request.get('/api/mcp/oauth/metadatos');
    expect(m.body.grant_types_supported).toContain('refresh_token');
  });

  it('recién conectado no da datos; la dueña lo autoriza y le da el código una vez, y ya consulta', async () => {
    const antes = await llamar(URL_ANA.token, CLAUDE.access_token, 'mis_proyectos');
    expect(antes.ok).toBe(false);
    expect(antes.texto).toMatch(/pendiente de autorizar/);

    const [c] = await q(`SELECT id FROM mcp_conexiones WHERE token_id = $1`, [URL_ANA.id]);
    const d = await request.patch(`/api/mcp/panel/conexiones/${c.id}`)
      .set('Authorization', `Bearer ${jwtDe(ANA)}`).send({ decision: 'autorizar' });
    expect(d.status).toBe(200);

    const codigo = (await request.post('/api/mcp/panel/codigo').set('Authorization', `Bearer ${jwtDe(ANA)}`).send({})).body.data.codigo;
    const des = await llamar(URL_ANA.token, CLAUDE.access_token, 'desbloquear', { codigo });
    expect(des.ok).toBe(true);
    expect(des.texto).toMatch(/No volverá a pedir el código/);
    expect((await llamar(URL_ANA.token, CLAUDE.access_token, 'mis_proyectos')).ok).toBe(true);
  });

  it('dos horas y un minuto sin usarlo (lo que caducaba antes): sigue consultando sin pedir nada', async () => {
    await pasa(URL_ANA.id, '2 hours 1 minute');
    const r = await llamar(URL_ANA.token, CLAUDE.access_token, 'mis_proyectos');
    expect(r.ok).toBe(true);
    expect(r.texto).not.toMatch(/código|desbloquear|autorizar/i);
  });

  it('y tres días después, muy por encima de las 9 h de máximo de antes, igual', async () => {
    await pasa(URL_ANA.id, '3 days');
    expect((await llamar(URL_ANA.token, CLAUDE.access_token, 'mis_proyectos')).ok).toBe(true);
  });

  it('el refresco de Claude, días después, da la MISMA llave y la conexión sigue validada', async () => {
    const r = await request.post('/api/mcp/oauth/token').type('form').send({
      grant_type: 'refresh_token', refresh_token: CLAUDE.refresh_token, client_id: 'crm-prueba',
    });
    expect(r.status).toBe(200);
    expect(r.body.access_token).toBe(CLAUDE.access_token);
    expect((await llamar(URL_ANA.token, r.body.access_token, 'mis_proyectos')).ok).toBe(true);
  });

  it('en todo el recorrido: una sola conexión, un solo código y una sola autorización', async () => {
    const [n] = await q(
      `SELECT (SELECT count(*) FROM mcp_conexiones WHERE token_id = $1)::int AS conexiones,
              (SELECT count(*) FROM mcp_codigos WHERE user_id = $2)::int AS codigos,
              (SELECT count(*) FROM mcp_auditoria WHERE token_id = $1 AND herramienta = 'conexion_autorizada')::int AS autorizaciones`,
      [URL_ANA.id, ANA.id]
    );
    expect(n).toEqual({ conexiones: 1, codigos: 1, autorizaciones: 1 });
    // Y debajo de su URL sale validado, sin horas.
    expect(await textoDeLaUrl(ANA, URL_ANA.id)).toBe('1 Claude autorizado y desbloqueado');
  });

  it('revocarla desde el panel sigue cortándolo, también el refresco', async () => {
    const r = await request.delete(`/api/mcp/panel/tokens/${URL_ANA.id}`).set('Authorization', `Bearer ${jwtDe(ANA)}`);
    expect(r.status).toBe(200);
    expect((await rpc(URL_ANA.token, { method: 'tools/list' }, CLAUDE.access_token)).status).toBe(401);
    const f = await request.post('/api/mcp/oauth/token').type('form').send({ grant_type: 'refresh_token', refresh_token: CLAUDE.refresh_token });
    expect(f.status).toBe(400);
    expect(f.body.error).toBe('invalid_grant');
  });
});

describe('un Claude conectado a la manera de antes (la URL sola): su dueño se entera de qué hacer', () => {
  let LUIS; let URL_LUIS;

  beforeAll(async () => {
    LUIS = await persona('LUIS', 'admin');
    URL_LUIS = await urlDeAntes(LUIS, 'Claude de siempre');
  });

  it('el CRM le contesta 401 con la dirección del inicio de sesión, y deja programado el aviso', async () => {
    const r = await rpc(URL_LUIS.token, { method: 'tools/list' });
    expect(r.status).toBe(401);
    expect(r.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource/api/mcp/u/crm_mcp_');
    expect(conexiones.avisoPendiente(URL_LUIS.id)).toBe(true);
  });

  it('pasada la espera, a su dueño le llega UN aviso con lo que tiene que hacer una vez', async () => {
    const desde = await ahoraEnLaBase();
    expect(await conexiones.comprobarConectorAntiguo(URL_LUIS.id, desde)).toBe(true);
    const [a] = await avisosDe(LUIS);
    expect(a).toMatchObject({ title: 'Tu Claude tiene que conectarse una vez', link_path: '/conexion/mcp', metadata: { tokenId: URL_LUIS.id } });
    expect(a.message).toMatch(/«Claude de siempre»/);
    expect(a.message).toMatch(/Configuración → Conectores/);
    expect(a.message).toMatch(/no lo vuelve a pedir/);
  });

  it('como mucho uno al día por URL, aunque su Claude siga intentándolo', async () => {
    expect(await conexiones.comprobarConectorAntiguo(URL_LUIS.id, await ahoraEnLaBase())).toBe(false);
    expect(await avisosDe(LUIS)).toHaveLength(1);
  });

  it('debajo de su URL, el panel dice que hay que conectarlo una vez (antes: «Ningún Claude conectado todavía»)', async () => {
    expect(await textoDeLaUrl(LUIS, URL_LUIS.id)).toMatch(/a la manera de antes y ya no puede consultar: conéctalo una vez/);
  });

  it('una vez conectado y validado, el texto cambia y no se le vuelve a avisar', async () => {
    const claude = await conectarClaude(URL_LUIS.token);
    const [c] = await q(`SELECT id FROM mcp_conexiones WHERE token_id = $1`, [URL_LUIS.id]);
    await request.patch(`/api/mcp/panel/conexiones/${c.id}`).set('Authorization', `Bearer ${jwtDe(LUIS)}`).send({ decision: 'autorizar' });
    const codigo = (await request.post('/api/mcp/panel/codigo').set('Authorization', `Bearer ${jwtDe(LUIS)}`).send({})).body.data.codigo;
    expect((await llamar(URL_LUIS.token, claude.access_token, 'desbloquear', { codigo })).ok).toBe(true);
    expect((await llamar(URL_LUIS.token, claude.access_token, 'mis_proyectos')).ok).toBe(true);
    expect(await textoDeLaUrl(LUIS, URL_LUIS.id)).toBe('1 Claude autorizado y desbloqueado');
  });

  it('si ese Claude termina de conectarse durante la espera, no era uno de antes: no se avisa', async () => {
    const MAR = await persona('MAR', 'admin');
    const t = await urlDeAntes(MAR, 'Se está conectando');
    const desde = await ahoraEnLaBase();
    expect((await rpc(t.token, { method: 'tools/list' })).status).toBe(401);
    await conectarClaude(t.token);
    expect(await conexiones.comprobarConectorAntiguo(t.id, desde)).toBe(false);
    expect(await avisosDe(MAR)).toHaveLength(0);
  });

  it('el aviso sale solo, sin que nadie lo llame, pasada la espera', async () => {
    const PEPA = await persona('PEPA', 'gestor');
    await q(`UPDATE users SET usa_mcp = true WHERE id = $1`, [PEPA.id]);
    const t = await urlDeAntes(PEPA, 'Claude de Pepa');
    expect(conexiones.avisarConectorAntiguo({ token_id: t.id }, { esperaMs: 10 })).toBe(true);
    await vi.waitFor(async () => expect(await avisosDe(PEPA)).toHaveLength(1), { timeout: 5000, interval: 50 });
  });

  it('una URL nueva que ningún Claude ha usado sigue diciendo lo de siempre', async () => {
    const t = await crearUrl(LUIS, 'Nueva');
    expect(await textoDeLaUrl(LUIS, t.id)).toBe('Ningún Claude conectado todavía con esta URL');
  });

  it('una URL revocada no avisa', async () => {
    const t = await urlDeAntes(LUIS, 'Revocada');
    await request.delete(`/api/mcp/panel/tokens/${t.id}`).set('Authorization', `Bearer ${jwtDe(LUIS)}`);
    expect(await conexiones.comprobarConectorAntiguo(t.id, await ahoraEnLaBase())).toBe(false);
  });
});
