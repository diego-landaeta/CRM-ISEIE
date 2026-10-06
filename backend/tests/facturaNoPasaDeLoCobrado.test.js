import { describe, it, expect, vi, beforeEach } from 'vitest';
// Paso en MultiCRM (ICTESS y CEDIA, 06/10); va igual en ISEIE por paridad.

// Una factura de una venta no pasa de lo cobrado (06/10).
//
// Tres cosas del mismo dia, con sus casos de verdad:
//   - ICTESS, la 87: segunda cuota (111 €) de un curso de 333 en plazos,
//     facturada por los 333 enteros. La primera ya tenia la suya, la 0077.
//   - CEDIA, la 0188 de Delia Garcia Moratilla: cobrados 285,50 y facturados
//     345,45, con el IVA sumado encima. Y su cobro, atascado en la cola.
//   - ICTESS, la 0086 de Yolanda: una factura sin venta ni ficha que no le
//     salia a quien la hizo.

const consultas = [];
let respuestas = [];
let cuadre;

vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    return respuestas.length ? respuestas.shift() : { rows: [] };
  }),
  getClient: vi.fn(),
}));

const real = await vi.importActual('../src/modules/invoices/invoices.model.js');
const { motivoParaNoFacturarDeMas } = real;

describe('la regla', () => {
  const CUOTA_2 = { cobrado: 222, facturado: 111, totalVenta: 333, ivaPct: 0 };

  it('la 87: los 333 enteros no, y dice cuanto queda y por que', () => {
    const m = motivoParaNoFacturarDeMas({ total: 333, base: 333, ...CUOTA_2 });
    expect(m).toContain('lleva cobrados 222.00 € y ya tiene facturados 111.00 €');
    expect(m).toContain('lo que queda por facturar son 111.00 €, y esta factura es de 333.00 €');
    expect(m).toContain('va a plazos');
    expect(m).toContain('confírmalo y se emite igual');
  });

  it('la 87 bien hecha, por su cuota, pasa', () => {
    expect(motivoParaNoFacturarDeMas({ total: 111, base: 111, ...CUOTA_2 })).toBeNull();
  });

  it('la 0188 de Delia: avisa de que la diferencia es el IVA', () => {
    const m = motivoParaNoFacturarDeMas({
      total: 345.46, base: 285.5, ivaPct: 21, ivaIncluido: false,
      cobrado: 285.5, facturado: 0, totalVenta: 285.5,
    });
    expect(m).toContain('lleva cobrados 285.50 €,');
    expect(m).not.toContain('ya tiene facturados');
    expect(m).toContain('marca «IVA incluido»');
    expect(m).not.toContain('plazos');
  });

  it('y con el IVA incluido, 285,50, pasa', () => {
    expect(motivoParaNoFacturarDeMas({
      total: 285.5, base: 235.95, ivaPct: 21, ivaIncluido: true,
      cobrado: 285.5, facturado: 0, totalVenta: 285.5,
    })).toBeNull();
  });

  it('todo lo cobrado ya facturado: no queda nada, hasta el proximo cobro', () => {
    const m = motivoParaNoFacturarDeMas({ total: 111, base: 111, cobrado: 222, facturado: 222, totalVenta: 333 });
    expect(m).toContain('no queda nada por facturar');
    expect(m).toContain('cola de facturación');
  });

  it('un abono devuelve lo que anula: se puede volver a facturar', () => {
    // Facturada por 333 y anulada con su abono de -333: lo facturado es 0.
    expect(motivoParaNoFacturarDeMas({ total: 333, base: 333, cobrado: 333, facturado: 0, totalVenta: 333 })).toBeNull();
  });

  it('un céntimo de redondeo no bloquea', () => {
    expect(motivoParaNoFacturarDeMas({ total: 111.01, base: 111.01, ...CUOTA_2 })).toBeNull();
    expect(motivoParaNoFacturarDeMas({ total: 111.03, base: 111.03, ...CUOTA_2 })).not.toBeNull();
  });
});

// El controlador, con el modelo simulado salvo la regla, que es la de verdad.
vi.mock('../src/modules/invoices/invoices.model.js', async () => {
  const actual = await vi.importActual('../src/modules/invoices/invoices.model.js');
  return {
    motivoParaNoFacturarDeMas: actual.motivoParaNoFacturarDeMas,
    conversionSinPago: vi.fn(async () => false),
    proformaActivaDeConversion: vi.fn(async () => null),
    esFacturaManager: vi.fn(async () => true),
    cuadreDeVenta: vi.fn(async () => cuadre),
    create: vi.fn(async (data) => ({ id: 1, codigo: '2026/0087', ...data })),
  };
});

const { create } = await import('../src/modules/invoices/invoices.controller.js');
const model = await import('../src/modules/invoices/invoices.model.js');

const CARLOS = {
  projectId: 4, conversionId: 569, leadId: 3546,
  clienteNombre: 'Carlos', clienteNif: '12345678Z', clienteDireccion: 'Calle 1',
  clienteCiudad: 'Valencia', clienteCp: '46021', clientePais: 'España',
  ivaPct: 0, metodoPago: 'transferencia',
};
const YOLANDA = { userId: 11, role: 'gestor' };

async function emitir(body, user = YOLANDA) {
  const res = { json: vi.fn() };
  const next = vi.fn();
  await create({ body, user }, res, next);
  return { res, next, error: next.mock.calls[0]?.[0] };
}

beforeEach(() => {
  cuadre = { cobrado: 222, facturado: 111, totalVenta: 333 };
  vi.clearAllMocks();
});

describe('al emitir', () => {
  it('la 87 por los 333 no se crea: 409 con el motivo', async () => {
    const { error } = await emitir({ ...CARLOS, items: [{ descripcion: 'Curso', cantidad: 1, precio_unitario: 333 }] });
    expect(error?.code).toBe('MAS_QUE_LO_COBRADO');
    expect(error?.statusCode ?? error?.status).toBe(409);
    expect(error.message).toContain('111.00 €');
    expect(model.create).not.toHaveBeenCalled();
  });

  it('por su cuota, se crea', async () => {
    const { res, error } = await emitir({ ...CARLOS, items: [{ descripcion: 'Curso', cantidad: 1, precio_unitario: 111 }] });
    expect(error).toBeUndefined();
    expect(model.create).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it('«Emitir igualmente» pasa sin mirar', async () => {
    const { error } = await emitir({
      ...CARLOS, permitirMasDeLoCobrado: true,
      items: [{ descripcion: 'Curso', cantidad: 1, precio_unitario: 333 }],
    });
    expect(error).toBeUndefined();
    expect(model.cuadreDeVenta).not.toHaveBeenCalled();
    expect(model.create).toHaveBeenCalledTimes(1);
  });

  it('un borrador no se mira al crearlo (se mira al emitirlo)', async () => {
    const { error } = await emitir({ ...CARLOS, borrador: true, items: [{ descripcion: 'Curso', cantidad: 1, precio_unitario: 333 }] });
    expect(error).toBeUndefined();
    expect(model.cuadreDeVenta).not.toHaveBeenCalled();
  });

  it('una proforma es un presupuesto: va por el total', async () => {
    model.conversionSinPago.mockResolvedValueOnce(true);
    const { error } = await emitir({ ...CARLOS, tipo: 'proforma', items: [{ descripcion: 'Curso', cantidad: 1, precio_unitario: 333 }] });
    expect(error).toBeUndefined();
    expect(model.cuadreDeVenta).not.toHaveBeenCalled();
  });

  it('una factura sin venta no tiene con que compararse', async () => {
    const { conversionId, leadId, ...suelta } = CARLOS;
    const { error } = await emitir({ ...suelta, items: [{ descripcion: 'Ponencia', cantidad: 1, precio_unitario: 200 }] });
    expect(error).toBeUndefined();
    expect(model.cuadreDeVenta).not.toHaveBeenCalled();
  });
});

describe('de quien es una factura, para una gestora', () => {
  beforeEach(() => { consultas.length = 0; respuestas = []; });

  it('la lista de Yolanda incluye las que escribio ella (la 0086, sin venta ni ficha)', async () => {
    respuestas = [{ rows: [] }, { rows: [{ total: 0 }] }];
    await real.list({ projectId: 4, responsableId: 11 });
    const lista = consultas[0];
    expect(lista.sql).toMatch(/i\.created_by = \$\d+ OR COALESCE\(cv\.vendedora_id, l\.responsable_id\) = \$\d+/);
    expect(lista.params).toContain(11);
    // Y el recuento, con la misma condicion: si no, la paginacion no cuadra.
    expect(consultas[1].sql).toContain('i.created_by =');
  });

  it('y puede tocar la suya aunque no tenga ficha', async () => {
    respuestas = [{ rows: [{ factura_manager: true }] }, { rows: [{ '?column?': 1 }] }];
    expect(await real.puedeGestionarFactura(11, 'gestor', 392)).toBe(true);
    const sql = consultas[1].sql;
    expect(sql).toContain('i.created_by = $2');
    expect(sql).toContain('LEFT JOIN conversions cv');
  });

  it('pero no la de otra', async () => {
    respuestas = [{ rows: [{ factura_manager: true }] }, { rows: [] }];
    expect(await real.puedeGestionarFactura(6, 'gestor', 392)).toBe(false);
  });
});

describe('la cola', () => {
  beforeEach(() => { consultas.length = 0; respuestas = []; });

  it('no pide factura de un cobro que ya cubre una factura de la venta entera (Delia)', async () => {
    await real.listPagosSinFactura(2);
    const sql = consultas[0].sql;
    // La misma condicion con la que «Generar factura» devuelve la que ya hay.
    expect(sql).toContain('t.total >= (SELECT v.importe_total FROM conversions v');
    expect(sql).toMatch(/SUM\(s\.total\)[\s\S]*\+ 0\.01\s*>= \(SELECT COALESCE\(SUM\(p\.importe\), 0\)/);
  });

  it('y el orden de la cola mira lo mismo', async () => {
    respuestas = [{ rows: [{ hay: false }] }];
    await real.hayPendientesAnteriores(2, '2026-10-05', 900);
    expect(consultas[0].sql).toContain('t.total >= (SELECT v.importe_total FROM conversions v');
  });
});
