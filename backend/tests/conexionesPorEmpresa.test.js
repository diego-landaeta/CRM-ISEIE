import { describe, it, expect, vi, beforeEach } from 'vitest';

// Conexión → MCP y Conectores, por empresa y con «Todos los proyectos» (Diego, 29/09):
//
//   «que funcione por empresa y todos los proyectos, y puedas ver quién gestiona
//    o quién creó un MCP y en dónde; Antonio solo puede consultar y ver los de su
//    empresa, en cambio Manuel Casas puede ver TODO en todos lados».

const llamadas = [];
const CEDIA = [1, 2, 3];
const ICTESS = [4];
let conectores = [];

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => {
    // proyectosDelAmbito: los campus de una empresa
    if (sql.includes('FROM projects WHERE sociedad_emisora_id = $1 ORDER BY id')) {
      return { rows: (params[0] === 8 ? CEDIA : ICTESS).map((id) => ({ id })) };
    }
    return { rows: [] };
  }),
}));
vi.mock('../src/modules/connectors/connectors.model.js', () => ({
  campusDeLaPersona: vi.fn(async (userId) => (userId === 20 ? [1, 2, 3] : [])),
  campusDeLaEmpresa: vi.fn(async (issuerId) => (issuerId === 8 ? CEDIA : ICTESS)),
  campusEsDeLaEmpresa: vi.fn(async () => true),
  listByAmbito: vi.fn(async (ids, opts) => { llamadas.push({ ids, ...opts }); return conectores; }),
  findById: vi.fn(async (id) => conectores.find((c) => c.id === id) || null),
  create: vi.fn(async (d) => ({ id: 99, ...d })),
}));
vi.mock('../src/modules/mcp/mcp.model.js', () => ({
  tokensDeConectores: vi.fn(async () => []),
  revocarTokensDelConector: vi.fn(async () => {}),
  crearToken: vi.fn(async () => ({ id: 1 })),
}));

const ctrl = await import('../src/modules/connectors/connectors.controller.js');
const model = await import('../src/modules/connectors/connectors.model.js');

const MANUEL = { userId: 1, role: 'superadmin' };
const ANTONIO = { userId: 20, role: 'admin' }; // admin de los tres campus de CEDIA

async function pedir(fn, user, { query = {}, params = {}, body = {} } = {}) {
  let salida = null;
  let error = null;
  const res = { json: (d) => { salida = d; }, status() { return this; } };
  await fn({ user, query, params, body }, res, (e) => { error = e; });
  return { salida, error };
}

beforeEach(() => {
  llamadas.length = 0;
  conectores = [];
});

describe('con «Todos los proyectos» arriba', () => {
  it('Manuel (super admin) lo ve todo, también lo de todo el sistema', async () => {
    const { error } = await pedir(ctrl.list, MANUEL, { query: { tipo: 'mcp' } });
    expect(error).toBeNull();
    expect(llamadas[0]).toEqual({ ids: null, tipo: 'mcp', incluirSistema: true });
  });

  it('Antonio (admin) ve lo de sus campus y su empresa, y nada de todo el sistema', async () => {
    const { error } = await pedir(ctrl.list, ANTONIO, { query: { tipo: 'mcp' } });
    expect(error).toBeNull();
    expect(llamadas[0]).toEqual({ ids: [1, 2, 3], tipo: 'mcp', incluirSistema: false });
  });

  it('ya no pide elegir campus o empresa', async () => {
    const { error } = await pedir(ctrl.list, ANTONIO, { query: { tipo: 'datos' } });
    expect(error).toBeNull();
    expect(llamadas[0].tipo).toBe('datos');
  });
});

describe('con una empresa arriba', () => {
  it('la suya: sus campus', async () => {
    await pedir(ctrl.list, ANTONIO, { query: { issuerId: '8' } });
    expect(llamadas[0].ids).toEqual([1, 2, 3]);
  });

  it('una empresa en la que no está: vacío, sin preguntar a la base', async () => {
    const { salida } = await pedir(ctrl.list, ANTONIO, { query: { issuerId: '9' } });
    expect(salida).toEqual({ success: true, data: [] });
    expect(llamadas).toHaveLength(0);
  });
});

describe('lo que puede tocar cada uno', () => {
  it('Antonio toca lo de su empresa y su campus; lo de otro, no', async () => {
    conectores = [
      { id: 1, alcance: 'empresa', issuer_id: 8, project_id: 1, type: 'mcp', config: {} },
      { id: 2, alcance: 'campus', project_id: 2, type: 'mcp', config: {} },
      { id: 3, alcance: 'campus', project_id: 4, type: 'mcp', config: {} },
    ];
    const { salida } = await pedir(ctrl.list, ANTONIO, {});
    expect(salida.data.map((c) => [c.id, c.puede_tocar])).toEqual([[1, true], [2, true], [3, false]]);
  });

  it('Manuel lo toca todo', async () => {
    conectores = [{ id: 5, alcance: 'sistema', project_id: 1, type: 'mcp', config: {} }];
    const { salida } = await pedir(ctrl.list, MANUEL, {});
    expect(salida.data[0].puede_tocar).toBe(true);
  });

  it('una de todo el sistema, Antonio ni la abre', async () => {
    conectores = [{ id: 5, alcance: 'sistema', project_id: 1, type: 'mcp', config: {} }];
    const { error } = await pedir(ctrl.getById, ANTONIO, { params: { id: '5' } });
    expect(error?.statusCode).toBe(403);
  });
});

describe('quién la creó', () => {
  it('el alta guarda a quien la crea', async () => {
    await pedir(ctrl.create, ANTONIO, {
      body: { project_id: 1, type: 'mcp', label: 'Claude de CEDIA', alcance: 'empresa', issuer_id: 8 },
    });
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ created_by: 20, alcance: 'empresa', issuer_id: 8 }));
  });
});
