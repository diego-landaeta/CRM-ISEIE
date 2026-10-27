import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
  Por dónde entra el webhook de transferencias (Diego, 15/10; migración 206).

  Los caminos que apuntan un cobro a mano —alta de la venta con su primer pago,
  abono, proforma «Cobrada», cuota cobrada— y la edición de una cuota que pasa A
  transferencia llaman todos a `cobroApuntado`, que llama a `dispararCobro`. Aquí
  se comprueba que cada camino llama, con el cobro y quién lo apuntó, y que la
  edición que solo cambia el importe de uno ya avisado no vuelve a llamar.

  Qué forma de pago sale y cuál no se prueba en webhookTransferencias.test.js.
*/

const disparados = [];
vi.mock('../src/modules/webhooks-salientes/webhooks-salientes.service.js', () => ({
  dispararCobro: vi.fn((paymentId, opciones) => { disparados.push({ paymentId, ...opciones }); }),
}));
vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async () => ({ rows: [] })),
}));
vi.mock('../src/modules/commissions/commission.model.js', () => ({
  createCommissionForConversion: vi.fn(async () => {}),
  recalculateCommission: vi.fn(async () => {}),
}));
vi.mock('../src/modules/email-sequences/sequence.model.js', () => ({ startRun: vi.fn() }));
vi.mock('../src/modules/leads/lead.model.js', () => ({ updateStatus: vi.fn() }));
vi.mock('../src/modules/conversions/conversion.model.js', () => ({
  leadBelongsToProject: vi.fn(async () => true),
  create: vi.fn(async () => ({
    id: 70, lead_id: 5, _initial_payment_id: 900, _initial_payment_importe: 300, _initial_payment_metodo: 'transferencia',
  })),
  addPayment: vi.fn(async (_id, pago) => ({ payment: { id: 901, importe: pago.importe, metodo: pago.metodo || null }, nuevoImportePagado: 600 })),
}));
vi.mock('../src/modules/conversions/installments.model.js', () => ({
  markPaid: vi.fn(async (_id, d) => ({ id: 3, conversion_id: 70, payment_id: 902, importe_cobrado: d.importe_cobrado, metodo: d.metodo })),
  editPaid: vi.fn(),
}));

vi.mock('../src/modules/invoices/invoices.model.js', () => ({
  findById: vi.fn(async () => ({ id: 44, tipo: 'proforma', estado: 'emitida', numero: 12, conversion_id: 70 })),
  tieneLaClave: vi.fn(async () => true),
  esProformaDe: vi.fn(async () => true),
  motivoParaNoCobrarProforma: vi.fn(async () => null),
  emitirFacturaDePago: vi.fn(async () => ({ id: 44, codigo: 'P-12', estado: 'pagada' })),
}));

const ctrl = await import('../src/modules/conversions/conversion.controller.js');
const invoices = await import('../src/modules/invoices/invoices.service.js');
const service = await import('../src/modules/conversions/conversion.service.js');
const installments = await import('../src/modules/conversions/installments.model.js');

async function pedir(fn, { user = { userId: 3, role: 'gestor' }, params = {}, body = {} } = {}) {
  let salida = null;
  let error = null;
  const res = { json: (d) => { salida = d; }, status() { return this; } };
  await fn({ user, params, body, query: {} }, res, (e) => { error = e; });
  return { salida, error };
}

beforeEach(() => { disparados.length = 0; });

describe('cada camino que apunta un cobro avisa', () => {
  it('el alta de la venta con su primer pago', async () => {
    await service.create({ lead_id: 5, project_id: 1, producto_contratado: 'X', importe_total: 900, importe_pagado: 300 }, 3);
    expect(disparados).toEqual([{ paymentId: 900, userId: 3, metodo: 'transferencia' }]);
  });

  it('el abono (POST /conversions/:id/payments), con quien lo apunta', async () => {
    const { error } = await pedir(ctrl.addPayment, { params: { id: '70' }, body: { importe: 300, metodo: 'deposito', referencia: 'OP-1' } });
    expect(error).toBeNull();
    expect(disparados).toEqual([{ paymentId: 901, userId: 3, metodo: 'deposito' }]);
  });

  it('el abono con tarjeta también pasa por el punto común (que es quien dice que no)', async () => {
    await pedir(ctrl.addPayment, { params: { id: '70' }, body: { importe: 300, metodo: 'tarjeta' } });
    expect(disparados).toEqual([{ paymentId: 901, userId: 3, metodo: 'tarjeta' }]);
  });

  it('el depósito bancario es una forma de cobro válida', async () => {
    const { error } = await pedir(ctrl.addPayment, { params: { id: '70' }, body: { importe: 10, metodo: 'deposito' } });
    expect(error).toBeNull();
  });

  it('la proforma «Cobrada», con quien la cobra', async () => {
    await invoices.cobrarProforma(44, { importe: 300, fecha: '2026-10-15', metodo: 'transferencia', referencia: 'TRF-7' },
      { userId: 8, role: 'admin' });
    expect(disparados).toEqual([{ paymentId: 901, userId: 8, metodo: 'transferencia' }]);
  });

  it('la cuota cobrada', async () => {
    const { error } = await pedir(ctrl.payInstallment, {
      params: { instId: '3' }, body: { fecha_cobro: '2026-10-15', importe_cobrado: 150, metodo: 'transferencia', referencia: 'TRF-9' },
    });
    expect(error).toBeNull();
    expect(installments.markPaid).toHaveBeenCalledWith(3, expect.objectContaining({ metodo: 'transferencia', referencia: 'TRF-9' }));
    expect(disparados).toEqual([{ paymentId: 902, userId: 3, metodo: 'transferencia' }]);
  });

  it('la cuota con un método que no existe se rechaza', async () => {
    const { error } = await pedir(ctrl.payInstallment, {
      params: { instId: '3' }, body: { fecha_cobro: '2026-10-15', metodo: 'cheque-regalo' },
    });
    expect(error?.statusCode).toBe(400);
    expect(disparados).toEqual([]);
  });
});

describe('la edición de una cuota cobrada', () => {
  it('si pasa A transferencia, avisa', async () => {
    installments.editPaid.mockResolvedValueOnce({ id: 3, payment_id: 902, metodo: 'transferencia', metodo_antes: 'tarjeta' });
    const { error } = await pedir(ctrl.editPaidInstallment, { params: { instId: '3' }, body: { metodo: 'transferencia' } });
    expect(error).toBeNull();
    expect(installments.editPaid).toHaveBeenLastCalledWith(3, { metodo: 'transferencia' });
    expect(disparados).toEqual([{ paymentId: 902, userId: 3, metodo: 'transferencia' }]);
  });

  it('si pasa de nada A depósito, avisa', async () => {
    installments.editPaid.mockResolvedValueOnce({ id: 3, payment_id: 902, metodo: 'deposito', metodo_antes: null });
    await pedir(ctrl.editPaidInstallment, { params: { instId: '3' }, body: { metodo: 'deposito' } });
    expect(disparados).toHaveLength(1);
  });

  it('si solo cambia el importe de una que ya era transferencia, NO vuelve a avisar', async () => {
    installments.editPaid.mockResolvedValueOnce({ id: 3, payment_id: 902, metodo: 'transferencia', metodo_antes: 'transferencia' });
    await pedir(ctrl.editPaidInstallment, { params: { instId: '3' }, body: { importe_cobrado: 175 } });
    expect(disparados).toEqual([]);
  });

  it('si pasa de transferencia a tarjeta, no avisa', async () => {
    installments.editPaid.mockResolvedValueOnce({ id: 3, payment_id: 902, metodo: 'tarjeta', metodo_antes: 'transferencia' });
    await pedir(ctrl.editPaidInstallment, { params: { instId: '3' }, body: { metodo: 'tarjeta' } });
    expect(disparados).toEqual([]);
  });

  it('sin nada que cambiar, 400', async () => {
    const { error } = await pedir(ctrl.editPaidInstallment, { params: { instId: '3' }, body: {} });
    expect(error?.statusCode).toBe(400);
  });
});
