import { describe, it, expect, vi, beforeEach } from 'vitest';

// «Este mes no facturo a esta empresa» (Diego, 31/10): desde el enlace del correo. La
// factura queda «sin factura»: no le llega el recordatorio del día 5, no se reenvía y no
// sale como pendiente. Se deshace desde el mismo enlace, o subiendo la factura.

const cliente = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
vi.mock('../src/shared/config/db.js', () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return { default: { query }, query, getClient: vi.fn(async () => cliente) };
});
vi.mock('../src/modules/facturas-colaborador/facturas-colaborador.model.js', () => ({ anotar: vi.fn(async () => {}) }));
const FILA = { id: 7, estado: 'abierto', periodo: '2026-10-01', issuer_id: 8, colaborador_nombre: 'Ana', razon_social: 'CEDIA', importe_esperado: null, caduca_at: '2099-01-01' };
vi.mock('../src/modules/facturas-colaborador/facturas.model.js', async (orig) => ({
  ...(await orig()),
  porTokenHash: vi.fn(async () => ({ ...FILA })),
  bloquear: vi.fn(async () => ({ id: 7, subida_at: null, anulada_at: null, caduca_at: '2099-01-01' })),
  marcarSinFactura: vi.fn(async () => {}),
  quitarSinFactura: vi.fn(async () => {}),
  tieneEvento: vi.fn(async () => false),
  campusDeLaEmpresa: vi.fn(async () => []),
}));

const db = await import('../src/shared/config/db.js');
const model = await import('../src/modules/facturas-colaborador/facturas.model.js');
const { anotar } = await import('../src/modules/facturas-colaborador/facturas-colaborador.model.js');
const service = await import('../src/modules/facturas-colaborador/facturas.service.js');
const TOKEN = 'x'.repeat(48);

beforeEach(() => vi.clearAllMocks());

describe('el estado y los envíos', () => {
  it('«sin_factura» es un estado, después de «recibida»', () => {
    expect(model.ESTADO).toMatch(/sin_factura_at IS NOT NULL THEN 'sin_factura'/);
    expect(model.ESTADO.indexOf("'recibida'")).toBeLessThan(model.ESTADO.indexOf("'sin_factura'"));
  });
  it('el recordatorio del día 5 y el reenvío se las saltan', async () => {
    await model.sinSubir('2026-10-01');
    await model.sinEnviar('2026-10-01');
    for (const [sql] of db.query.mock.calls) expect(sql).toMatch(/f\.sin_factura_at IS NULL/);
  });
});

describe('desde el enlace', () => {
  it('lo marca con su motivo y lo deja anotado', async () => {
    await service.sinFacturaPorEnlace(TOKEN, { motivo: '  No trabajé para CEDIA  ' }, '1.2.3.4');
    expect(model.marcarSinFactura).toHaveBeenCalledWith(cliente, 7, 'No trabajé para CEDIA');
    expect(anotar.mock.calls[0][1]).toMatchObject({ facturaId: 7, evento: 'sin_factura' });
    expect(cliente.query).toHaveBeenCalledWith('COMMIT');
  });
  it('se deshace', async () => {
    await service.sinFacturaPorEnlace(TOKEN, { deshacer: true }, '1.2.3.4');
    expect(model.quitarSinFactura).toHaveBeenCalledWith(cliente, 7);
    expect(anotar.mock.calls[0][1]).toMatchObject({ evento: 'sin_factura_deshecho' });
  });
  it('una factura ya recibida no se toca', async () => {
    model.bloquear.mockResolvedValueOnce({ id: 7, subida_at: '2026-10-31', anulada_at: null, caduca_at: '2099-01-01' });
    await expect(service.sinFacturaPorEnlace(TOKEN, {}, '1.2.3.4')).rejects.toMatchObject({ code: 'YA_SUBIDA' });
    expect(model.marcarSinFactura).not.toHaveBeenCalled();
    expect(cliente.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
