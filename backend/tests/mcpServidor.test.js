import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * El MCP por HTTP, como lo llama Claude: la puerta del token y el protocolo.
 *
 * La base se sustituye por un modelo en memoria. Lo que se prueba es quien
 * pasa la puerta y que le contesta el servidor, no el SQL (eso es
 * `mcpAmbito.test.js`).
 */

const TOKEN_ANA = 'crm_mcp_' + 'a'.repeat(43);
const TOKEN_LUIS = 'crm_mcp_' + 'b'.repeat(43);
const TOKEN_REVOCADO = 'crm_mcp_' + 'c'.repeat(43);

const PERSONAS = {
  1: { id: 1, nombre: 'Ana', role: 'admin', active: true, usa_mcp: false },
  2: { id: 2, nombre: 'Luis', role: 'gestor', active: true, usa_mcp: false },
};

const modelo = vi.hoisted(() => ({
  findTokenVivo: vi.fn(),
  findUserById: vi.fn(),
  proyectosDeLaPersona: vi.fn(),
  marcarUso: vi.fn(async () => {}),
  registrarAuditoria: vi.fn(async () => {}),
  buscarProspectos: vi.fn(async () => ({ total: 0, pagina: 1, prospectos: [] })),
}));
vi.mock('../src/modules/mcp/mcp.model.js', () => modelo);
vi.mock('../src/shared/config/db.js', () => ({ query: vi.fn(), getClient: vi.fn(), default: {} }));

const { huella } = await import('../src/modules/mcp/mcp.acceso.js');
const { default: mcp } = await import('../src/modules/mcp/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(mcp.prefix, mcp.router);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  modelo.findTokenVivo.mockImplementation(async (hash) => {
    if (hash === huella(TOKEN_ANA)) return { token_id: 11, user_id: 1 };
    if (hash === huella(TOKEN_LUIS)) return { token_id: 22, user_id: 2 };
    return null; // TOKEN_REVOCADO y cualquier otro
  });
  modelo.findUserById.mockImplementation(async (id) => PERSONAS[id] || null);
  modelo.proyectosDeLaPersona.mockImplementation(async () => ([
    { id: 10, nombre: 'ISEIH', sociedad_id: 1, sociedad_nombre: 'CEDIA' },
  ]));
});

let idRpc = 0;
const rpc = (token, method, params = {}) => {
  const r = request(app).post('/api/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json');
  if (token) r.set('Authorization', `Bearer ${token}`);
  return r.send({ jsonrpc: '2.0', id: ++idRpc, method, params });
};
const llamar = (token, name, args = {}) => rpc(token, 'tools/call', { name, arguments: args });

describe('la puerta', () => {
  it('sin token: 401 y dice donde crearlo', async () => {
    const r = await rpc(null, 'tools/list');
    expect(r.status).toBe(401);
    expect(r.body.error.message).toMatch(/Conexión → MCP/);
    expect(r.headers['www-authenticate']).toMatch(/Bearer/);
  });

  it('el JWT del CRM no sirve aqui', async () => {
    const r = await rpc('eyJhbGciOiJIUzI1NiJ9.x.y', 'tools/list');
    expect(r.status).toBe(401);
    expect(modelo.findTokenVivo).not.toHaveBeenCalled();
  });

  it('token revocado o caducado: 401', async () => {
    const r = await rpc(TOKEN_REVOCADO, 'tools/list');
    expect(r.status).toBe(401);
  });

  it('gestor sin la casilla: 403, aunque su token siga vivo', async () => {
    // Quitarle la casilla tiene efecto en la siguiente pregunta.
    const r = await rpc(TOKEN_LUIS, 'tools/list');
    expect(r.status).toBe(403);
  });

  it('usuario desactivado: 403', async () => {
    modelo.findUserById.mockResolvedValueOnce({ ...PERSONAS[1], active: false });
    const r = await rpc(TOKEN_ANA, 'tools/list');
    expect(r.status).toBe(403);
  });

  it('GET y DELETE no existen: 405', async () => {
    expect((await request(app).get('/api/mcp')).status).toBe(405);
    expect((await request(app).delete('/api/mcp')).status).toBe(405);
  });
});

describe('el protocolo', () => {
  it('initialize contesta con el nombre del servidor e instrucciones', async () => {
    const r = await rpc(TOKEN_ANA, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'prueba', version: '1' },
    });
    expect(r.status).toBe(200);
    expect(r.body.result.serverInfo.name).toBe('crm-iseih');
    expect(r.body.result.instructions).toMatch(/Solo consulta/);
  });

  it('tools/list: todas marcadas como solo lectura', async () => {
    const r = await rpc(TOKEN_ANA, 'tools/list');
    expect(r.status).toBe(200);
    const tools = r.body.result.tools;
    expect(tools.map((t) => t.name)).toContain('buscar_prospectos');
    for (const t of tools) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.annotations.destructiveHint).toBe(false);
    }
  });

  it('mis_proyectos devuelve SUS campus', async () => {
    const r = await llamar(TOKEN_ANA, 'mis_proyectos');
    const datos = JSON.parse(r.body.result.content[0].text);
    expect(datos.persona).toBe('Ana');
    expect(datos.proyectos.map((p) => p.id)).toEqual([10]);
  });

  it('pedir un campus ajeno: error que Claude puede leer, y la base ni se toca', async () => {
    const r = await llamar(TOKEN_ANA, 'buscar_prospectos', { proyecto_id: 99 });
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.content[0].text).toMatch(/No tienes acceso al campus 99/);
    expect(modelo.buscarProspectos).not.toHaveBeenCalled();
  });

  it('la consulta va con los campus de la persona', async () => {
    await llamar(TOKEN_ANA, 'buscar_prospectos', { texto: 'ana' });
    expect(modelo.buscarProspectos).toHaveBeenCalledWith(expect.objectContaining({
      projectIds: [10], responsableId: null, texto: 'ana',
    }));
  });

  it('a una gestora con la casilla se le impone su id', async () => {
    modelo.findUserById.mockImplementation(async (id) => ({ ...PERSONAS[id], usa_mcp: true }));
    await llamar(TOKEN_LUIS, 'buscar_prospectos', {});
    expect(modelo.buscarProspectos).toHaveBeenCalledWith(expect.objectContaining({ responsableId: 2 }));
  });

  it('argumentos que no cuadran se rechazan antes de consultar', async () => {
    const r = await llamar(TOKEN_ANA, 'buscar_prospectos', { desde: 'julio', limite: 5000 });
    expect(r.body.result?.isError ?? !!r.body.error).toBe(true);
    expect(modelo.buscarProspectos).not.toHaveBeenCalled();
  });

  it('un error de base no se le cuenta a Claude, se queda en el log', async () => {
    modelo.buscarProspectos.mockRejectedValueOnce(new Error('relation "leads" does not exist at character 42'));
    const r = await llamar(TOKEN_ANA, 'buscar_prospectos', {});
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.content[0].text).toBe('Error interno al consultar el CRM.');
  });

  it('cada llamada queda en la auditoria, con quien, que y si fue bien', async () => {
    await llamar(TOKEN_ANA, 'buscar_prospectos', { proyecto_id: 99 });
    expect(modelo.registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1, tokenId: 11, herramienta: 'buscar_prospectos', ok: false,
    }));
  });
});

// ─── URL personal (para «Agregar conector personalizado») ─────────────────

describe('la URL personal', () => {
  const porUrl = (token, method, params = {}) => request(app).post(`/api/mcp/u/${token}`)
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json')
    .send({ jsonrpc: '2.0', id: ++idRpc, method, params });

  it('con la URL personal se conecta sin cabecera de token', async () => {
    const r = await porUrl(TOKEN_ANA, 'tools/list');
    expect(r.status).toBe(200);
    expect(r.body.result.tools.map((t) => t.name)).toContain('mis_proyectos');
  });

  it('y aplica los mismos filtros: a una gestora se le impone su id', async () => {
    modelo.findUserById.mockImplementation(async (id) => ({ ...PERSONAS[id], usa_mcp: true }));
    await porUrl(TOKEN_LUIS, 'tools/call', { name: 'buscar_prospectos', arguments: {} });
    expect(modelo.buscarProspectos).toHaveBeenCalledWith(expect.objectContaining({ responsableId: 2, projectIds: [10] }));
  });

  it('una URL inventada o revocada: 401 y la base no da datos', async () => {
    expect((await porUrl('lo-que-sea', 'tools/list')).status).toBe(401);
    const r = await porUrl(TOKEN_REVOCADO, 'tools/list');
    expect(r.status).toBe(401);
  });

  it('un gestor sin la casilla tampoco entra por URL', async () => {
    expect((await porUrl(TOKEN_LUIS, 'tools/list')).status).toBe(403);
  });

  it('GET y DELETE: 405', async () => {
    expect((await request(app).get(`/api/mcp/u/${TOKEN_ANA}`)).status).toBe(405);
    expect((await request(app).delete(`/api/mcp/u/${TOKEN_ANA}`)).status).toBe(405);
  });

  it('el secreto se tapa en la URL de la peticion: no puede acabar en un registro', async () => {
    const { urlPersonal } = await import('../src/modules/mcp/mcp.auth.js');
    const req = { params: { secreto: TOKEN_ANA }, url: `/u/${TOKEN_ANA}`, originalUrl: `/api/mcp/u/${TOKEN_ANA}` };
    urlPersonal(req, {}, () => {});
    expect(req.mcpTokenDeUrl).toBe(TOKEN_ANA);
    expect(req.url).toBe('/u/***');
    expect(req.originalUrl).toBe('/api/mcp/u/***');
  });
});
