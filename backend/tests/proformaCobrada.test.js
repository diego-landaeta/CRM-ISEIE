import { describe, it, expect, vi, beforeEach } from 'vitest';

// «Cobrada» en una proforma (Yolanda, 29/09).
//
// Se prueba lo que NO puede pasar: que se apunte un cobro y la proforma se
// quede como estaba, que lo haga quien no factura, o que una gestora cobre la
// proforma de otra. Y que, cuando se puede, el cobro va a la venta y la factura
// sale de la misma proforma.

const pagos = [];
let proforma;
let motivo = null;
let facturaManager = true;
let esSuya = true;
let devuelta = null;

vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  getClient: vi.fn(),
}));
vi.mock('../src/modules/invoices/invoices.model.js', () => ({
  findById: vi.fn(async () => proforma),
  esFacturaManager: vi.fn(async () => facturaManager),
  esProformaDe: vi.fn(async () => esSuya),
  motivoParaNoCobrarProforma: vi.fn(async () => motivo),
  emitirFacturaDePago: vi.fn(async () => devuelta),
}));
vi.mock('../src/modules/conversions/conversion.service.js', () => ({
  addPayment: vi.fn(async (conversionId, datos) => {
    pagos.push({ conversionId, ...datos });
    return { payment: { id: 900, importe: String(datos.importe) } };
  }),
}));

const { cobrarProforma } = await import('../src/modules/invoices/invoices.service.js');
const model = await import('../src/modules/invoices/invoices.model.js');

const COBRO = { importe: 550, fecha: '2026-09-29', metodo: 'transferencia' };
const YOLANDA = { userId: 11, role: 'gestor' };

beforeEach(() => {
  pagos.length = 0;
  proforma = { id: 364, codigo: '2026/0085', numero: 85, tipo: 'proforma', estado: 'emitida', conversion_id: 614, project_id: 4 };
  motivo = null;
  facturaManager = true;
  esSuya = true;
  devuelta = { ...proforma, tipo: 'normal', estado: 'pagada' };
  vi.clearAllMocks();
});

async function falla(user = YOLANDA) {
  try {
    await cobrarProforma(364, COBRO, user);
  } catch (e) {
    return e;
  }
  throw new Error('tenia que fallar');
}

describe('cuando se puede', () => {
  it('apunta el cobro en la venta y devuelve la misma proforma, ya factura', async () => {
    const inv = await cobrarProforma(364, COBRO, YOLANDA);
    expect(pagos).toEqual([{ conversionId: 614, importe: 550, fecha: '2026-09-29', metodo: 'transferencia', notas: undefined }]);
    expect(model.emitirFacturaDePago).toHaveBeenCalledWith(614, { paymentId: 900, importe: 550 }, 11);
    expect(inv.id).toBe(364);
    expect(inv.estado).toBe('pagada');
  });

  it('el superadmin no necesita la marca de facturacion', async () => {
    facturaManager = false;
    await cobrarProforma(364, COBRO, { userId: 1, role: 'superadmin' });
    expect(pagos).toHaveLength(1);
  });
});

describe('lo que no deja hacer, y sin apuntar ningun cobro', () => {
  it('una factura que no es proforma', async () => {
    proforma.tipo = 'normal';
    expect((await falla()).code).toBe('NOT_PROFORMA');
    expect(pagos).toHaveLength(0);
  });

  it('una proforma esperando aprobacion, sin numero', async () => {
    proforma.estado = 'borrador';
    proforma.numero = null;
    expect((await falla()).code).toBe('SIN_NUMERO');
    expect(pagos).toHaveLength(0);
  });

  it('una proforma cancelada', async () => {
    proforma.estado = 'cancelada';
    expect((await falla()).code).toBe('CANCELADA');
    expect(pagos).toHaveLength(0);
  });

  it('una proforma sin venta: no hay donde apuntar el cobro', async () => {
    proforma.conversion_id = null;
    const e = await falla();
    expect(e.code).toBe('SIN_VENTA');
    expect(e.message).toMatch(/Asociar a venta/);
    expect(pagos).toHaveLength(0);
  });

  it('quien no lleva la facturacion', async () => {
    facturaManager = false;
    expect((await falla()).statusCode).toBe(403);
    expect(pagos).toHaveLength(0);
  });

  it('una gestora con la proforma de otra', async () => {
    esSuya = false;
    expect((await falla()).statusCode).toBe(403);
    expect(pagos).toHaveLength(0);
  });

  it('la venta tiene otra proforma mas reciente', async () => {
    motivo = { code: 'OTRA_PROFORMA', texto: 'La venta tiene otra proforma más reciente' };
    const e = await falla();
    expect(e.code).toBe('OTRA_PROFORMA');
    expect(e.statusCode).toBe(409);
    expect(pagos).toHaveLength(0);
  });
});

describe('si al final no se convierte', () => {
  it('lo dice, en vez de dar por hecha una factura que no salio', async () => {
    devuelta = { id: 999, tipo: 'normal' };
    const e = await falla();
    expect(e.code).toBe('NO_CONVERTIDA');
    expect(e.message).toMatch(/cola de facturación/);
  });
});
