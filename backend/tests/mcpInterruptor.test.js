import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Interruptor de emergencia del MCP (#196).
 *
 * Diego: «MCP_DISABLED=1 en .env, y un botón de super admin en el panel que
 * corta todo el MCP al momento (todas las URLs dejan de responder) y lo vuelve
 * a encender».
 *
 * Con una base EN MEMORIA, no la de Docker: el interruptor es global, y apagarlo
 * de verdad mientras corren las demás pruebas del MCP las haría fallar a ellas.
 * Contra la base real se prueba a mano, sin nada más corriendo.
 */

const TOKEN = 'crm_mcp_' + 'z'.repeat(43);
const PERSONAS = {
  1: { id: 1, nombre: 'Super', role: 'superadmin', active: true },
  2: { id: 2, nombre: 'Ana', role: 'admin', active: true },
};

// La fila de mcp_interruptor, en memoria.
const fila = vi.hoisted(() => ({ apagado: false, cambiado_por: null, cambiado_at: null, motivo: null }));
const query = vi.hoisted(() => vi.fn());
vi.mock('../src/shared/config/db.js', () => ({ query, getClient: vi.fn(), default: {} }));

const modelo = vi.hoisted(() => ({
  findTokenVivo: vi.fn(async () => ({ token_id: 9, user_id: 2 })),
  findUserById: vi.fn(async (id) => PERSONAS[id] || null),
  proyectosDeLaPersona: vi.fn(async () => [{ id: 10, nombre: 'ISEIH', sociedad_id: 1 }]),
  marcarUso: vi.fn(async () => {}),
  registrarAuditoria: vi.fn(async () => {}),
  listarTokens: vi.fn(async () => []),
}));
vi.mock('../src/modules/mcp/mcp.model.js', async (original) => ({ ...(await original()), ...modelo }));

const { default: mcp } = await import('../src/modules/mcp/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(mcp.prefix, mcp.router);
app.use(errorHandler);

const jwtDe = (id) => jwt.sign({ userId: id, role: PERSONAS[id].role }, process.env.JWT_SECRET, { expiresIn: '10m' });

const llamarMcp = () => request(app).post(`/api/mcp/u/${TOKEN}`)
  .set('Accept', 'application/json, text/event-stream')
  .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
const usarHerramienta = (name, args = {}, ruta = `/api/mcp/u/${TOKEN}`) => request(app).post(ruta)
  .set('Authorization', `Bearer ${TOKEN}`)
  .set('Accept', 'application/json, text/event-stream')
  .send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
const MENSAJE = 'El MCP del CRM está apagado, active para poder acceder a los datos';
/** Apagado: la herramienta contesta, pero solo el aviso y ningún dato. */
async function esperarApagado(r) {
  expect(r.status).toBe(200);
  expect(r.body.result.isError).toBe(true);
  expect(r.body.result.content).toHaveLength(1);
  const texto = r.body.result.content[0].text;
  expect(texto.startsWith(MENSAJE)).toBe(true);
  // El dato que evita que Claude pida un código que no hace falta.
  expect(texto).toMatch(/No tiene que ver con el código de desbloqueo/);
}
const pulsar = (id, apagado, motivo) => request(app).post('/api/mcp/panel/interruptor')
  .set('Authorization', `Bearer ${jwtDe(id)}`).send({ apagado, motivo });

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MCP_DISABLED;
  Object.assign(fila, { apagado: false, cambiado_por: null, cambiado_at: null, motivo: null });
  query.mockImplementation(async (sql, params) => {
    if (/FROM mcp_interruptor/.test(sql)) {
      return { rows: [{ ...fila, cambiado_por: fila.cambiado_por ? PERSONAS[fila.cambiado_por].nombre : null }] };
    }
    if (/INSERT INTO mcp_interruptor/.test(sql)) {
      Object.assign(fila, { apagado: params[0], cambiado_por: params[1], cambiado_at: new Date(), motivo: params[2] });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
});

describe('MCP_DISABLED=1 en el .env', () => {
  it('ninguna URL da datos: la personal y la de cabecera solo dan el aviso, OAuth no responde', async () => {
    process.env.MCP_DISABLED = '1';
    await esperarApagado(await usarHerramienta('mis_proyectos'));
    await esperarApagado(await usarHerramienta('resumen_ventas', {}, '/api/mcp'));
    expect(modelo.proyectosDeLaPersona).toHaveBeenCalled(); // el token se sigue comprobando
    const oauth = await request(app).get('/api/mcp/oauth/metadatos');
    expect(oauth.status).toBe(503);
    expect(oauth.body.error.message).toBe(MENSAJE);
  });

  it('una URL con token falso sigue rechazada: ni siquiera se entera de que está apagado', async () => {
    process.env.MCP_DISABLED = '1';
    modelo.findTokenVivo.mockResolvedValueOnce(null);
    const r = await usarHerramienta('mis_proyectos');
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.body)).not.toMatch(/apagado/);
  });

  it('el panel sí responde: desde ahí se ve que está apagado', async () => {
    process.env.MCP_DISABLED = '1';
    const r = await request(app).get('/api/mcp/panel').set('Authorization', `Bearer ${jwtDe(1)}`);
    expect(r.status).toBe(200);
    expect(r.body.data.interruptor).toMatchObject({ apagado: true, porEnv: true });
  });

  it('y el botón no puede encenderlo', async () => {
    process.env.MCP_DISABLED = '1';
    expect((await pulsar(1, false)).status).toBe(409);
  });
});

describe('el botón del super admin', () => {
  it('apagar corta los datos al momento, y encender los devuelve', async () => {
    expect((await llamarMcp()).status).toBe(200);
    const antes = await usarHerramienta('mis_proyectos');
    expect(antes.body.result.content[0].text).not.toBe(MENSAJE);

    const apagar = await pulsar(1, true, 'URL filtrada');
    expect(apagar.status).toBe(200);
    expect(apagar.body.data).toMatchObject({ apagado: true, porBoton: true, cambiadoPor: 'Super', motivo: 'URL filtrada' });
    // Claude puede conectar y ver las herramientas, pero no saca nada.
    expect((await llamarMcp()).status).toBe(200);
    await esperarApagado(await usarHerramienta('mis_proyectos'));
    expect((await request(app).get('/api/mcp/oauth/metadatos')).status).toBe(503);

    expect((await pulsar(1, false)).status).toBe(200);
    const despues = await usarHerramienta('mis_proyectos');
    expect(despues.body.result.content[0].text).not.toBe(MENSAJE);
  });

  it('apagado no se ofrece «desbloquear»: Claude no pide un código que no hace falta', async () => {
    const antes = process.env.MCP_CODIGO_OBLIGATORIO;
    process.env.MCP_CODIGO_OBLIGATORIO = '1';
    try {
      const nombres = async () => (await llamarMcp()).body.result.tools.map((t) => t.name);
      expect(await nombres()).toContain('desbloquear');
      await pulsar(1, true);
      expect(await nombres()).not.toContain('desbloquear');
      await pulsar(1, false);
      expect(await nombres()).toContain('desbloquear');
    } finally {
      if (antes === undefined) delete process.env.MCP_CODIGO_OBLIGATORIO;
      else process.env.MCP_CODIGO_OBLIGATORIO = antes;
    }
  });

  it('apagado queda en la auditoría cada intento de consulta', async () => {
    await pulsar(1, true);
    await usarHerramienta('mis_proyectos');
    expect(modelo.registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      herramienta: 'mis_proyectos', ok: false, error: 'MCP_APAGADO',
    }));
  });

  it('queda en la Actividad: quién, qué y por qué', async () => {
    await pulsar(1, true, 'pruebas');
    expect(modelo.registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1, herramienta: 'interruptor_apagar', parametros: { motivo: 'pruebas' }, ok: true,
    }));
  });

  it('un admin NO puede apagarlo', async () => {
    expect((await pulsar(2, true)).status).toBe(403);
    expect(fila.apagado).toBe(false);
  });

  it('si la base no responde, no se da por apagado: el MCP sigue', async () => {
    query.mockImplementation(async (sql) => {
      if (/mcp_interruptor/.test(sql)) throw new Error('base caída');
      return { rows: [], rowCount: 0 };
    });
    expect((await llamarMcp()).status).toBe(200);
  });
});
