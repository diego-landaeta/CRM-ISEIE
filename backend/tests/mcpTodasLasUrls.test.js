import { describe, it, expect, vi, beforeEach } from 'vitest';

// Conexión → MCP: quien administra ve TODAS las URLs que alcanza, y el super
// admin revoca la de cualquiera. Diego, 05/10: «aquí deben de aparecer todas
// las conexiones hechas»; «el superadmin decide quién tiene acceso».

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
}));

const USUARIOS = {
  1: { id: 1, nombre: 'Manuel', role: 'superadmin', active: true },
  20: { id: 20, nombre: 'Antonio', role: 'admin', active: true },
  30: { id: 30, nombre: 'Ana', role: 'gestor', active: true, usa_mcp: true },
};

vi.mock('../src/modules/mcp/mcp.model.js', async (original) => ({
  ...(await original()),
  findUserById: vi.fn(async (id) => USUARIOS[id] || null),
  proyectosDeLaPersona: vi.fn(async () => [{ id: 1, nombre: 'ISEIH' }]),
  listarTokens: vi.fn(async (id) => [{ id: 100 + id, nombre: 'La mía', vivo: true }]),
  listarTodasLasUrls: vi.fn(async () => [
    { id: 101, user_id: 1, persona: 'Manuel', nombre: 'La mía', vivo: true },
    { id: 130, user_id: 30, persona: 'Ana', nombre: 'Claude de Ana', vivo: true },
  ]),
  revocarToken: vi.fn(async () => true),
  revocarCualquierToken: vi.fn(async () => true),
}));
vi.mock('../src/modules/mcp/mcp.interruptor.js', async (original) => ({
  ...(await original()),
  estado: vi.fn(async () => ({ apagado: false })),
}));

const ctrl = await import('../src/modules/mcp/mcp.controller.js');
const model = await import('../src/modules/mcp/mcp.model.js');

async function pedir(fn, userId, { params = {} } = {}) {
  let salida = null;
  let error = null;
  const res = { json: (d) => { salida = d; }, status() { return this; } };
  await fn({ user: { userId }, params, body: {} }, res, (e) => { error = e; });
  return { salida, error };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('la lista del panel', () => {
  it('el super admin recibe todas las URLs y puede revocarlas', async () => {
    const { salida, error } = await pedir(ctrl.estado, 1);
    expect(error).toBeNull();
    expect(salida.data.todas.map((t) => t.id)).toEqual([101, 130]);
    expect(salida.data.puedeRevocarTodas).toBe(true);
    expect(model.listarTodasLasUrls).toHaveBeenCalledWith(USUARIOS[1]);
  });

  it('un admin recibe las que alcanza, pero no revoca las de otros', async () => {
    const { salida } = await pedir(ctrl.estado, 20);
    expect(salida.data.todas).toBeDefined();
    expect(salida.data.puedeRevocarTodas).toBe(false);
  });

  it('una gestora solo ve las suyas', async () => {
    const { salida } = await pedir(ctrl.estado, 30);
    expect(salida.data.todas).toBeUndefined();
    expect(salida.data.tokens.map((t) => t.id)).toEqual([130]);
    expect(model.listarTodasLasUrls).not.toHaveBeenCalled();
  });
});

describe('revocar', () => {
  it('el super admin revoca la URL de otra persona', async () => {
    const { error } = await pedir(ctrl.revocarToken, 1, { params: { id: '130' } });
    expect(error).toBeNull();
    expect(model.revocarCualquierToken).toHaveBeenCalledWith(130);
    expect(model.revocarToken).not.toHaveBeenCalled();
  });

  it('un admin solo revoca las suyas (la consulta exige que sea su dueño)', async () => {
    await pedir(ctrl.revocarToken, 20, { params: { id: '130' } });
    expect(model.revocarToken).toHaveBeenCalledWith(130, 20);
    expect(model.revocarCualquierToken).not.toHaveBeenCalled();
  });
});
