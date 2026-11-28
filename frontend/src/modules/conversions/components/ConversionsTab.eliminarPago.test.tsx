// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

/*
  CRM-ISEIE#856 + CRM-ISEIE#858 (gemelas CRM#1228 + #1230) · «Eliminar pago» dice lo
  mismo que «Deshacer el pago» y que el servidor: cada pago llega con
  `cobro_bloqueo` (el texto del 409, o null si se puede). Con factura vigente
  lo explica sin preguntar «¿Eliminar pago?»; con la factura anulada y a cero
  pregunta y lo borra; si la API dice 409 igualmente, lo explica y recarga.
*/

const VIGENTE = 'Ese cobro tiene la factura ISEIE-2026/0201. Anúlala antes de borrar el cobro.';
const venta = {
  id: 77, lead_id: 9, project_id: 2, producto_contratado: 'Curso', importe_total: 300,
  importe_pagado: 200, metodo_pago: 'transferencia', fecha_conversion: '2026-11-02', payments_count: 2,
};
const pagos = [
  { id: 501, importe: 100, fecha: '2026-11-03', factura_id: 1, factura_codigo: 'ISEIE-2026/0201', factura_estado: 'pagada',
    factura_anulada: false, factura_anulada_a_cero: false, cobro_bloqueo: VIGENTE },
  { id: 502, importe: 100, fecha: '2026-11-04', factura_id: 2, factura_codigo: 'ISEIE-2026/0202', factura_estado: 'pagada',
    factura_anulada: true, factura_anulada_a_cero: true, cobro_bloqueo: null },
];

const api = vi.hoisted(() => ({ removePayment: vi.fn(), toast: vi.fn(), byLead: vi.fn() }));
vi.mock('../api/conversions.api', () => ({
  conversionsApi: new Proxy({}, {
    get: (_t, nombre) => {
      if (nombre === 'byLead') return api.byLead;
      if (nombre === 'getById') return () => Promise.resolve({ success: true, data: { ...venta, payments: pagos } });
      if (nombre === 'removePayment') return api.removePayment;
      return () => Promise.resolve({ success: true, data: [] });
    },
  }),
}));
vi.mock('@/shared/hooks/useToast', () => ({ toast: api.toast }));
vi.mock('@/modules/invoices/api/invoices.api', () => ({
  invoicesApi: new Proxy({}, { get: () => () => Promise.resolve({ success: true, data: [] }) }),
}));
vi.mock('@/modules/invoices/components/InvoiceButton', () => ({ default: () => null }));
vi.mock('@/modules/invoices/components/EmitirBorradorDialog', () => ({ default: () => null }));
vi.mock('@/modules/invoices/components/SendInvoiceDialog', () => ({ default: () => null }));
vi.mock('./ConversionDialog', () => ({ default: () => null }));
vi.mock('./PaymentDialog', () => ({ default: () => null }));
vi.mock('./RefundDialog', () => ({ default: () => null }));
vi.mock('./EditConversionDialog', () => ({ default: () => null }));
vi.mock('./InstallmentsDialog', () => ({ default: () => null }));

const { default: ConversionsTab } = await import('./ConversionsTab');

// Las papeleras salen en el orden de los pagos: 501 (vigente) y 502 (anulada).
const papeleras = () => screen.findAllByRole('button', { name: 'Eliminar pago', hidden: true }, { timeout: 5000 });

afterEach(() => { cleanup(); });
beforeEach(() => {
  vi.clearAllMocks();
  api.byLead.mockResolvedValue({ success: true, data: [venta] });
});

describe('«Eliminar pago» con la regla del servidor (CRM-ISEIE#856 + CRM-ISEIE#858)', () => {
  it('con factura vigente: lo explica con el texto del servidor y no pregunta ni borra', async () => {
    render(<ConversionsTab lead={{ id: 9 }} projectId={2} canManage />);
    const [boton] = await papeleras();
    expect(boton).toHaveProperty('title', VIGENTE);
    fireEvent.click(boton);
    expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'No se puede eliminar este pago', description: VIGENTE, variant: 'destructive',
    }));
    expect(screen.queryByText('¿Eliminar pago?')).toBeNull();
    expect(api.removePayment).not.toHaveBeenCalled();
  });

  it('un doble clic en la papelera no apila el mismo aviso', async () => {
    render(<ConversionsTab lead={{ id: 9 }} projectId={2} canManage />);
    const [boton] = await papeleras();
    fireEvent.click(boton);
    fireEvent.click(boton);
    expect(api.toast).toHaveBeenCalledTimes(1);
  });

  it('con la factura anulada y a cero: pregunta y lo borra', async () => {
    api.removePayment.mockResolvedValue({ success: true, data: { message: 'Pago eliminado', aviso: null } });
    render(<ConversionsTab lead={{ id: 9 }} projectId={2} canManage />);
    const [, boton] = await papeleras();
    expect(boton).toHaveProperty('title', 'Eliminar pago');
    fireEvent.click(boton);
    expect(await screen.findByText('¿Eliminar pago?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(api.removePayment).toHaveBeenCalledWith(502));
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Pago eliminado' })));
  });

  it('si la API dice 409 igualmente (cambió con la pantalla abierta), el mismo título y texto', async () => {
    const motivo = 'Ese cobro tiene una comisión de tutor ya pagada. Revierte la comisión antes de borrar el cobro.';
    api.removePayment.mockRejectedValue(Object.assign(new Error(motivo), {
      status: 409, data: { success: false, error: motivo, code: 'PAYMENT_HAS_PAID_COMMISSION' },
    }));
    render(<ConversionsTab lead={{ id: 9 }} projectId={2} canManage />);
    fireEvent.click((await papeleras())[1]);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'No se puede eliminar este pago', description: motivo, variant: 'destructive',
    })));
  });
});
