// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/*
  CRM-ISEIE#856 + CRM-ISEIE#858 (gemelas CRM#1228 + #1230) · «Deshacer el pago» de
  una cuota con factura. La regla es la del servidor (cobro-facturado.js), la
  misma que «Eliminar pago»: la cuota llega con `cobro_bloqueo` (el texto del
  409, o null si se puede) y la pantalla lo enseña antes de pulsar, en vez de
  preguntar «¿se borra el cobro?» o de enseñar un «Error» vacío. Con la
  factura anulada y a cero se deshace; sin factura, igual que siempre.
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
  fecha_cobro: '2026-11-01', importe_cobrado: 200, payment_id: 90, cobro_bloqueo: null, ...extra,
});
const abrir = async (cuotas) => {
  api.listInstallments.mockResolvedValue({ success: true, data: cuotas });
  const onSaved = vi.fn();
  render(<InstallmentsDialog conversion={conversion} onClose={vi.fn()} onSaved={onSaved} />);
  return { boton: await screen.findByRole('button', { name: 'Deshacer' }), onSaved };
};

// Los textos que manda el servidor: los mismos que su 409.
const VIGENTE = 'Ese cobro tiene la factura ISEIE-2026/0101. Anúlala antes de borrar el cobro.';
const BORRADOR = 'Ese cobro tiene una factura en borrador. Edítala o cancélala antes de borrar el cobro.';

describe('#856 + #858 · «Deshacer el pago» con factura', () => {
  let confirmar;
  beforeEach(() => {
    vi.clearAllMocks();
    confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => { cleanup(); confirmar.mockRestore(); });

  it('con factura vigente no pregunta ni llama a la API: explica qué hacer, con el texto del servidor', async () => {
    const { boton } = await abrir([cuota({
      factura_id: 5, factura_codigo: 'ISEIE-2026/0101', factura_estado: 'emitida', cobro_bloqueo: VIGENTE,
    })]);
    expect(boton).toHaveAttribute('title', VIGENTE);
    fireEvent.click(boton);
    expect(confirmar).not.toHaveBeenCalled();
    expect(api.unpayInstallment).not.toHaveBeenCalled();
    expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'No se puede deshacer este pago', description: VIGENTE, variant: 'destructive',
    }));
  });

  it('un doble (o triple) clic en «Deshacer» no apila el mismo aviso', async () => {
    const { boton } = await abrir([cuota({
      factura_id: 5, factura_codigo: 'ISEIE-2026/0101', factura_estado: 'emitida', cobro_bloqueo: VIGENTE,
    })]);
    fireEvent.click(boton);
    fireEvent.click(boton);
    fireEvent.click(boton);
    expect(api.toast).toHaveBeenCalledTimes(1);
    expect(api.unpayInstallment).not.toHaveBeenCalled();
  });

  it('pasado lo que dura el aviso, vuelve a salir si se pulsa otra vez', async () => {
    const { boton } = await abrir([cuota({
      factura_id: 5, factura_codigo: 'ISEIE-2026/0101', factura_estado: 'emitida', cobro_bloqueo: VIGENTE,
    })]);
    const ahora = Date.now();
    const reloj = vi.spyOn(Date, 'now').mockReturnValue(ahora);
    fireEvent.click(boton);
    reloj.mockReturnValue(ahora + 4001);
    fireEvent.click(boton);
    reloj.mockRestore();
    expect(api.toast).toHaveBeenCalledTimes(2);
  });

  it('en borrador dice «edítala o cancélala», no «anúlala»', async () => {
    const { boton } = await abrir([cuota({ factura_id: 6, factura_codigo: null, factura_estado: 'borrador', cobro_bloqueo: BORRADOR })]);
    fireEvent.click(boton);
    expect(api.unpayInstallment).not.toHaveBeenCalled();
    expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ description: BORRADOR }));
  });

  it('con la factura anulada y a cero (CRM#1230): pregunta y deshace, como el servidor', async () => {
    api.unpayInstallment.mockResolvedValue({ success: true, data: { aviso: null } });
    const { boton, onSaved } = await abrir([cuota({
      factura_id: 5, factura_codigo: 'ISEIE-2026/0103', factura_estado: 'pagada',
      factura_anulada: true, factura_anulada_a_cero: true, cobro_bloqueo: null,
    })]);
    expect(boton).toHaveAttribute('title', expect.stringContaining('está anulada'));
    expect(screen.getByText(/Factura ISEIE-2026\/0103 · anulada/)).toBeInTheDocument();
    fireEvent.click(boton);
    expect(confirmar).toHaveBeenCalled();
    await waitFor(() => expect(api.unpayInstallment).toHaveBeenCalledWith(31));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('si la API dice 409 (la factura salió con la pantalla abierta), lo explica y recarga', async () => {
    const { boton, onSaved } = await abrir([cuota()]);
    const motivo = 'Ese cobro tiene la factura ISEIE-2026/0102. Anúlala antes de borrar el cobro.';
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

  it('comisión de tutor pagada (409 PAYMENT_HAS_PAID_COMMISSION): el mismo trato', async () => {
    const { boton } = await abrir([cuota()]);
    const motivo = 'Ese cobro tiene una comisión de tutor ya pagada. Revierte la comisión antes de borrar el cobro.';
    api.unpayInstallment.mockRejectedValue(Object.assign(new Error(motivo), {
      status: 409, data: { success: false, error: motivo, code: 'PAYMENT_HAS_PAID_COMMISSION' },
    }));
    fireEvent.click(boton);
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'No se puede deshacer este pago', description: motivo,
    })));
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

  it('si la comisión de la gestora ya estaba pagada, lo avisa', async () => {
    const aviso = 'La comisión de la gestora de esta venta ya está pagada (20.00 €): no se ha rebajado. Regularízala a mano si hace falta.';
    api.unpayInstallment.mockResolvedValue({ success: true, data: { aviso } });
    const { boton } = await abrir([cuota()]);
    fireEvent.click(boton);
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Comisión ya pagada', description: aviso })));
  });
});
