import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * «Conectar campus» (el plugin del CRM en Moodle), solo en los campus de quien llama (#461).
 *
 * La #461 pedía, antes de conectar un Moodle real, que un admin de otra empresa no
 * pudiera quedarse con la conexión de un campus ajeno. Integraciones ya lo tiene
 * (`integracionesPorCampus.test.js`). Pero hoy los campus se conectan con el código
 * del plugin (#679, #850): quien genera el código decide a qué campus se ata el Moodle
 * que lo pegue, y su URL y su token quedan guardados como la conexión de ese campus.
 * Con el código de un campus ajeno, un admin conectaría a él un Moodle suyo.
 *
 * Pasa por las rutas de verdad (token, permiso y campus), no solo por el controlador.
 * Sin base: `query` es de mentira y el plugin también; se mira qué se le habría pedido.
 */

// Ana es admin del campus 10. El 20 es de otra empresa.
const CAMPUS_DE = { 2: [10] };

// Los dos permisos que piden las rutas del plugin: el de gestionar consultas y, para
// el código, el de editar integraciones. Ana los tiene, como un admin.
const GESTION = { 'consultas.gestionar': true, 'integrations.edit': true };
const MAPAS = { 1: GESTION, 2: GESTION };
vi.mock('../src/modules/permissions/permissions.service.js', () => ({
  explicarPermisos: vi.fn(async (id) => (MAPAS[id] ? { mapa: MAPAS[id] } : null)),
}));

vi.mock('../src/shared/config/db.js', () => {
  const query = vi.fn(async (sql, params = []) => {
    if (/FROM user_projects WHERE user_id = \$1 AND active = true/.test(sql)) {
      return { rows: (CAMPUS_DE[params[0]] || []).map((p) => ({ project_id: p })) };
    }
    return { rows: [] };
  });
  return { query, getClient: vi.fn(async () => ({ query, release: () => {} })) };
});

vi.mock('../src/modules/consultas/consultas.plugin.js', async (importOriginal) => ({
  ...(await importOriginal()),
  estado: vi.fn(async (projectId) => ({ project_id: projectId, conectado: false })),
  crearCodigo: vi.fn(async () => ({ codigo: 'CRM1-de-prueba', expira_at: '2026-11-19T00:00:00.000Z' })),
  desactivar: vi.fn(async () => {}),
}));

const plugin = await import('../src/modules/consultas/consultas.plugin.js');
const { default: mod } = await import('../src/modules/consultas/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(mod.prefix, mod.router);
app.use(errorHandler);
const api = supertest(app);

const como = (userId, role) => ({ Authorization: `Bearer ${jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: '5m' })}` });
const ANA = como(2, 'admin');
const MANUEL = como(1, 'superadmin');

const estado = (id, u) => api.get(`/api/consultas/campus/${id}/plugin`).set(u);
const codigo = (id, u) => api.post(`/api/consultas/campus/${id}/plugin/codigo`).set(u);
const apagar = (id, u) => api.delete(`/api/consultas/campus/${id}/plugin`).set(u);

/** Ninguna llamada al plugin con el campus 20. */
function noTocoElCampus20() {
  for (const fn of [plugin.estado, plugin.crearCodigo, plugin.desactivar]) {
    for (const [pid] of fn.mock.calls) expect(Number(pid)).not.toBe(20);
  }
}

beforeEach(() => { vi.clearAllMocks(); });

describe('un admin, en su campus', () => {
  it('ve el estado, saca el código y lo apaga', async () => {
    expect((await estado(10, ANA)).status).toBe(200);
    const r = await codigo(10, ANA);
    expect(r.status).toBe(200);
    expect(r.body.data.codigo).toBe('CRM1-de-prueba');
    expect(plugin.crearCodigo).toHaveBeenCalledWith(10, 2);
    expect((await apagar(10, ANA)).status).toBe(200);
    expect(plugin.desactivar).toHaveBeenCalledWith(10);
  });
});

describe('un admin, en el campus de otra empresa', () => {
  it('no saca el código de conexión: no puede atar un Moodle suyo a ese campus', async () => {
    const r = await codigo(20, ANA);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain('CRM1-');
    expect(plugin.crearCodigo).not.toHaveBeenCalled();
  });

  it('no ve si está conectado ni lo apaga', async () => {
    expect((await estado(20, ANA)).status).toBe(404);
    expect((await apagar(20, ANA)).status).toBe(404);
    expect(plugin.desactivar).not.toHaveBeenCalled();
    noTocoElCampus20();
  });

  it('da lo mismo que el campus exista o no: 404, sin confirmar nada', async () => {
    const ajeno = await codigo(20, ANA);
    const inexistente = await codigo(999999, ANA);
    expect(ajeno.status).toBe(inexistente.status);
    expect(ajeno.body).toEqual(inexistente.body);
  });

  it('su campus en el cuerpo o en la consulta no le abre el ajeno', async () => {
    await api.post('/api/consultas/campus/20/plugin/codigo?projectId=10').set(ANA).send({ projectId: 10 });
    await api.delete('/api/consultas/campus/20/plugin?projectId=10').set(ANA).send({ projectId: 10 });
    expect(plugin.crearCodigo).not.toHaveBeenCalled();
    expect(plugin.desactivar).not.toHaveBeenCalled();
    noTocoElCampus20();
  });
});

describe('el super admin', () => {
  it('saca el código de cualquier campus', async () => {
    expect((await codigo(20, MANUEL)).status).toBe(200);
    expect(plugin.crearCodigo).toHaveBeenCalledWith(20, 1);
  });
});
