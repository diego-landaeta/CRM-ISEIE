// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { ConfirmProvider } from '@/shared/components/ui/useConfirm';

afterEach(cleanup);

/*
  CRM-ISEIE#775, gemela de CRM#1120 (PR #1163): ningun test ejercitaba el
  dialogo de verdad - los vi.mock(useConfirm) siempre resuelven como
  "Cancelar". Este archivo no mockea useConfirm: usa el ConfirmProvider real
  para probar DUPLICATE_PAYMENT.
*/

vi.mock('@/shared/components/ui/portal', () => ({
  default: ({ children }) => children,
}));

vi.mock('@/shared/hooks/useDialogA11y', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useEscapeKey: () => {} };
});

const addPaymentMock = vi.fn();
vi.mock('@/modules/conversions/api/conversions.api', () => ({
  conversionsApi: {
    addPayment: (...args) => addPaymentMock(...args),
  },
}));

const toastMock = vi.fn();
vi.mock('@/shared/hooks/useToast', () => ({
  toast: (...args) => toastMock(...args),
}));

import PaymentDialog from '@/modules/conversions/components/PaymentDialog';

const baseConversion = {
  id: 42,
  importe_total: 1000,
  importe_pagado: 300,
  producto_contratado: 'Master IA',
};

const renderDialog = (props) => render(
  <ConfirmProvider><PaymentDialog {...props} /></ConfirmProvider>,
);

describe('PaymentDialog - posible cobro duplicado (dialogo real)', () => {
  beforeEach(() => {
    addPaymentMock.mockReset();
    toastMock.mockReset();
  });

  it('sale el dialogo y "Registrar" reenvia con permitir_duplicado', async () => {
    addPaymentMock
      .mockRejectedValueOnce({ data: { code: 'DUPLICATE_PAYMENT', error: 'Ya hay un cobro igual hoy' } })
      .mockResolvedValueOnce({ success: true });
    const onPaid = vi.fn();
    const onClose = vi.fn();
    const { container } = renderDialog({ open: true, onClose, conversion: baseConversion, onPaid });

    fireEvent.change(container.querySelector('input[type="number"]'), { target: { value: '100' } });
    fireEvent.submit(container.querySelector('form'));

    const titulo = await screen.findByText('Posible cobro duplicado');
    const caja = titulo.closest('[role="dialog"]');
    expect(within(caja).getByText('Ya hay un cobro igual hoy')).toBeInTheDocument();

    fireEvent.click(within(caja).getByText('Registrar'));

    await waitFor(() => expect(addPaymentMock).toHaveBeenCalledTimes(2));
    expect(addPaymentMock.mock.calls[1][1]).toMatchObject({ permitir_duplicado: true });
    expect(onPaid).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('"Cancelar" no reenvia', async () => {
    addPaymentMock.mockRejectedValueOnce({ data: { code: 'DUPLICATE_PAYMENT', error: 'Ya hay un cobro igual hoy' } });
    const onPaid = vi.fn();
    const { container } = renderDialog({ open: true, onClose: vi.fn(), conversion: baseConversion, onPaid });

    fireEvent.change(container.querySelector('input[type="number"]'), { target: { value: '100' } });
    fireEvent.submit(container.querySelector('form'));

    const titulo = await screen.findByText('Posible cobro duplicado');
    const caja = titulo.closest('[role="dialog"]');
    fireEvent.click(within(caja).getByText('Cancelar'));

    await waitFor(() => expect(screen.queryByText('Posible cobro duplicado')).not.toBeInTheDocument());
    expect(addPaymentMock).toHaveBeenCalledTimes(1);
    expect(onPaid).not.toHaveBeenCalled();
  });
});