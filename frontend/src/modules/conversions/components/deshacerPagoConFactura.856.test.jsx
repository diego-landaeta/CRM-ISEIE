// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/*
  CRM-ISEIE#856 (gemela CRM#1228) · «Deshacer el pago» de una cuota con
  factura. La API ya dice que no (409 PAYMENT_HAS_INVOICE); la pantalla lo
  explica en vez de preguntar «¿se borra el cobro?» o de enseñar un «Error»
  vacío, y sin factura sigue igual que siempre.
*/

const api = vi.hoisted(() => ({
  listInstallments: vi.fn(), unpayInstallment: vi.fn(), toast: vi.fn(),
}));
vi.mock('@/modules/conversions/api/conversions.api', () => ({ conversionsApi: api }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: api.toast }));

import InstallmentsDialog from '@/modules/conversions/components/InstallmentsDialog';

const conversion = { id: 7, importe_total: 600, importe_pagado: 200, metodo_pago: 'transferencia' };
const cuota = (extra = {}) => ({
  id: 31, numero: 1, importe_previsto: 200, fecha_vencimiento: '2026-11-01',
  fecha_cobro: '2026-11-01', importe_cobrado: 200, payment_id: 90, ...extra,
});
const abrir = async (cuotas) => {
  api.listInstallments.mockResolvedValue({ success: true, data: cuotas });
  const onSaved = vi.fn();
  render(<InstallmentsDialog conversion={conversion} onClose={vi.fn()} onSaved={onSaved} />);
  return { boton: await screen.findByRole('button', { name: 'Deshacer' }), onSaved };
};

describe('#856 · «Deshacer el pago» con factura', () => {
  let confirmar;
  beforeEach(() => {
    vi.clearAllMocks();
    confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => { cleanup(); confirmar.mockRestore(); });

  it('con factura no pregunta ni llama a la API: explica qué hacer', async () => {
    const { boton } = await abrir([cuota({ factura_id: 5, factura_codigo: 'ISEIE-2026/0101', factura_estado: 'emitida' })]);
    expect(boton).toHaveAttribute('title', expect.stringContaining('ISEIE-2026/0101'));
    fireEvent.click(boton);
    expect(confirmar).not.toHaveBeenCalled();
    expect(api.unpayInstallment).not.toHaveBeenCalled();
    expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'No se puede deshacer este pago',
      description: expect.stringContaining('ISEIE-2026/0101'),
      variant: 'destructive',
    }));
  });

  it('si la API dice 409 (la factura salió con la pantalla abierta), lo explica y recarga', async () => {
    const { boton, onSaved } = await abrir([cuota()]);
    const motivo = 'Ese cobro tiene la factura ISEIE-2026/0102. Anulala o emite una rectificativa antes de borrarlo.';
    api.unpayInstallment.mockRejectedValue(Object.assign(new Error(motivo), {
      status: 409, data: { success: false, error: motivo, code: 'PAYMENT_HAS_INVOICE' },
    }));
    fireEvent.click(boton);
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'No se puede deshacer este pago', description: motivo, variant: 'destructive',
    })));
    await waitFor(() => expect(api.listInstallments).toHaveBeenCalledTimes(2));
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeInTheDocument();
  });

  it('sin factura, igual que hoy: pregunta, deshace y avisa', async () => {
    api.unpayInstallment.mockResolvedValue({ success: true, data: {} });
    const { boton, onSaved } = await abrir([cuota()]);
    expect(boton).toHaveAttribute('title', 'Deshacer el pago (vuelve a pendiente)');
    fireEvent.click(boton);
    expect(confirmar).toHaveBeenCalled();
    await waitFor(() => expect(api.unpayInstallment).toHaveBeenCalledWith(31));
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Pago deshecho' })));
    expect(onSaved).toHaveBeenCalled();
  });
});
