import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * #193: «una petición a la URL personal no deja el token en ningún registro».
 *
 * La URL personal lleva la llave dentro, y la aplicación escribe la ruta en
 * tres sitios: el aviso de rechazos (4xx), el de errores (5xx) y la tabla
 * `status_errors` del panel de soporte. Aquí se fuerza cada uno —con la base
 * cayéndose a propósito— y se comprueba que la llave no aparece en ninguno.
 * nginx se cubre aparte: nginx/crm-iseie-registro-seguro.conf.
 */

const LLAVE = 'crm_mcp_' + 'k'.repeat(43);

const escrito = [];
const apuntar = (...args) => { escrito.push(JSON.stringify(args)); };

vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: apuntar, warn: apuntar, error: apuntar, fatal: apuntar, debug: apuntar, child: () => ({ info: apuntar, warn: apuntar, error: apuntar }) },
}));
vi.mock('../src/modules/status/status.model.js', () => ({
  logError: vi.fn(async (fila) => { escrito.push(JSON.stringify(fila)); }),
}));
const modelo = vi.hoisted(() => ({ findTokenVivo: vi.fn() }));
vi.mock('../src/modules/mcp/mcp.model.js', async (original) => ({ ...(await original()), ...modelo }));
vi.mock('../src/shared/config/db.js', () => ({ query: vi.fn(), getClient: vi.fn(), default: {} }));

const { default: mcp } = await import('../src/modules/mcp/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(mcp.prefix, mcp.router);
app.use(errorHandler);

const enviar = (ruta) => request(app).post(ruta)
  .set('Accept', 'application/json, text/event-stream')
  .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

beforeEach(() => { escrito.length = 0; modelo.findTokenVivo.mockReset(); });

describe('la llave de la URL personal no queda escrita', () => {
  it('un error interno (5xx): ni en el aviso de error ni en status_errors', async () => {
    modelo.findTokenVivo.mockRejectedValue(new Error('se cayó la base'));
    const r = await enviar(`/api/mcp/u/${LLAVE}`);
    expect(r.status).toBe(500);
    expect(escrito.length).toBeGreaterThan(0);          // algo se escribió…
    expect(escrito.join('\n')).not.toContain(LLAVE);    // …pero sin la llave
    expect(escrito.join('\n')).toContain('/u/***');     // y la ruta, tapada
  });

  it('una llave revocada (401) tampoco la deja', async () => {
    modelo.findTokenVivo.mockResolvedValue(null);
    expect((await enviar(`/api/mcp/u/${LLAVE}`)).status).toBe(401);
    expect(escrito.join('\n')).not.toContain(LLAVE);
  });

  it('GET a la URL personal (405), igual', async () => {
    await request(app).get(`/api/mcp/u/${LLAVE}`);
    expect(escrito.join('\n')).not.toContain(LLAVE);
  });

  it('las rutas de OAuth que llevan la llave, igual', async () => {
    await request(app).get(`/api/mcp/oauth/recurso/mcp/u/${LLAVE}`);
    await request(app).get(`/api/mcp/oauth/authorize?resource=${encodeURIComponent(`https://x/crm/api/mcp/u/${LLAVE}`)}`);
    expect(escrito.join('\n')).not.toContain(LLAVE);
  });
});
