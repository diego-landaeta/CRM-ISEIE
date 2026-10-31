import { describe, it, expect, vi, beforeEach } from 'vitest';

// La moneda de las facturas de colaboradores (247, 31/10). Andrea factura a CEDIA en
// dólares ($356.03) y el CRM lo enseñaba como «356,03 €». Cada empresa de la ficha lleva
// su moneda, la factura del mes la hereda y el colaborador la puede cambiar al subirla.
// No se convierte: los totales se suman cada moneda por su lado.

vi.mock('../src/shared/config/db.js', () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return { default: { query }, query, getClient: vi.fn() };
});
vi.mock('../src/modules/facturas-colaborador/facturas-colaborador.service.js', () => ({ ambitoDe: vi.fn(async () => null) }));
vi.mock('../src/modules/facturas-colaborador/facturas.model.js', async (orig) => ({
  ...(await orig()),
  pendientesDePreparar: vi.fn(async () => [{ colaborador_id: 59, issuer_id: 8, importe_acordado: null, moneda: 'USD' }]),
  crearDelMes: vi.fn(async () => 17),
  delMes: vi.fn(async () => [
    { estado: 'recibida', moneda: 'USD', importe: '356.03', base: null, importe_esperado: null },
    { estado: 'recibida', moneda: 'EUR', importe: '636.00', base: '600.00', importe_esperado: '600.00' },
    { estado: 'enviado', moneda: 'EUR', importe: null, base: null, importe_esperado: '400.00' },
    { estado: 'anulada', moneda: 'USD', importe: '999.00', base: null, importe_esperado: null },
  ]),
}));

const db = await import('../src/shared/config/db.js');
const model = await import('../src/modules/facturas-colaborador/facturas.model.js');
const service = await import('../src/modules/facturas-colaborador/facturas.service.js');
const { conMoneda, porMoneda } = await import('../src/modules/facturas-colaborador/moneda.js');
const { subidaSchema, normalizarImporte } = await import('../src/modules/facturas-colaborador/facturas-colaborador.validation.js');
const { armarCorreoDelMes } = await import('../src/modules/facturas-colaborador/facturas.emails.js');
const { ponerEmpresa } = await import('../src/modules/facturas-colaborador/facturas-colaborador.model.js');

beforeEach(() => vi.clearAllMocks());

describe('el formato y las sumas', () => {
  it('cada importe con su moneda', () => {
    expect(conMoneda(356.03, 'USD')).toBe('356,03 US$');
    expect(conMoneda(1113, 'EUR')).toBe('1.113,00 €');
    expect(conMoneda(5)).toBe('5,00 €');
  });
  it('las sumas no mezclan monedas, y los euros van primero', () => {
    const filas = [{ moneda: 'USD', i: 356.03 }, { moneda: 'EUR', i: 600 }, { moneda: 'USD', i: 10 }, { i: 1 }];
    expect(porMoneda(filas, { total: (f) => f.i })).toEqual([
      { moneda: 'EUR', total: 601 },
      { moneda: 'USD', total: 366.03 },
    ]);
  });
});

describe('la subida', () => {
  it('acepta el importe con «$» y la moneda', () => {
    expect(normalizarImporte('$356.03')).toBe('356.03');
    const r = subidaSchema.parse({ importe: '$356.03', numero_factura: 'INV 2', moneda: 'USD' });
    expect(r).toMatchObject({ importe: 356.03, moneda: 'USD' });
  });
  it('sin moneda, se queda la de la ficha; otra que no sea EUR o USD no vale', () => {
    expect(subidaSchema.parse({ importe: '600', numero_factura: 'F-1' }).moneda).toBeUndefined();
    expect(() => subidaSchema.parse({ importe: '600', numero_factura: 'F-1', moneda: 'GBP' })).toThrow();
  });
  it('guarda la moneda elegida, o deja la que tenía', async () => {
    const cliente = { query: vi.fn(async () => ({ rows: [] })) };
    await model.guardarSubida(cliente, 17, { importe: 356.03, moneda: 'USD' });
    const [sql, params] = cliente.query.mock.calls[0];
    expect(sql).toMatch(/moneda = COALESCE\(\$17, moneda\)/);
    expect(params[16]).toBe('USD');
    await model.guardarSubida(cliente, 17, { importe: 600 });
    expect(cliente.query.mock.calls[1][1][16]).toBeNull();
  });
});

describe('el mes', () => {
  it('la factura del mes sale con la moneda de la ficha', async () => {
    model.crearDelMes.mockResolvedValueOnce(17);
    await service.prepararMes('2026-11-01');
    expect(model.crearDelMes.mock.calls[0][1]).toMatchObject({ colaboradorId: 59, issuerId: 8, moneda: 'USD' });
  });
  it('la cabecera suma cada moneda por su lado, sin las anuladas', async () => {
    const r = await service.delMes({ userId: 1 }, { periodo: '2026-10-01' });
    expect(r.resumen.por_moneda).toEqual([
      { moneda: 'EUR', importe_recibido: 600, importe_acordado: 1000 },
      { moneda: 'USD', importe_recibido: 356.03, importe_acordado: 0 },
    ]);
    // Los de antes, solo con los euros: los dólares ya no se cuentan como euros.
    expect(r.resumen).toMatchObject({ importe_recibido: 600, importe_acordado: 1000 });
  });
  it('el correo del mes dice la moneda', () => {
    const { asunto, htmlContent } = armarCorreoDelMes({
      f: { periodo: '2026-10-01', razon_social: 'CEDIA Investigación y Desarrollo SL', colaborador_nombre: 'Andrea', importe_esperado: '356.03', moneda: 'USD', area: 'desarrollo' },
      token: 'x'.repeat(48),
    });
    expect(asunto).toContain('356,03 US$');
    expect(htmlContent).toContain('356,03 US$');
  });
});

describe('la ficha', () => {
  it('guarda la moneda de cada empresa; sin ella, no la cambia', async () => {
    await ponerEmpresa(db.default, 59, { issuer_id: 8, moneda: 'USD' });
    let [sql, params] = db.default.query.mock.calls[0];
    expect(sql).toMatch(/moneda = COALESCE\(\$9, colaborador_empresas\.moneda\)/);
    expect(params[8]).toBe('USD');
    await ponerEmpresa(db.default, 59, { issuer_id: 9 });
    [, params] = db.default.query.mock.calls[1];
    expect(params[8]).toBeNull();
  });
});
