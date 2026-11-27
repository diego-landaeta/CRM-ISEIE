// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/*
  25/11 · Ana (venta 540): cobró la cuota y no le salió dónde emitir su factura.

  Al cobrar, InstallmentsDialog llama a `onSaved` → la pestaña recarga la lista.
  Con `if (loading) return <esqueleto/>` la pestaña se desmontaba entera, con
  el diálogo abierto dentro, y al volver salía de cero: sin el bloque «Emitir ya
  la factura de este cobro» (CRM#1043). En el registro de nginx: tras
  `POST /installments/332/pay`, ni un `GET /invoices/cola/venta/540`.

  Esta prueba monta la pestaña con un diálogo de cuotas de mentira que cuenta
  cuántas veces se monta: al recargar tiene que seguir siendo el mismo.
*/

let montajes = 0;
let byLeadPendiente: ((v: unknown) => void) | null = null;
const venta = {
  id: 540, lead_id: 3524, project_id: 2, producto_contratado: 'Curso', importe_total: 850,
  importe_pagado: 300, metodo_pago: 'fraccionado', fecha_conversion: '2026-09-02', payments: [],
};

vi.mock('../api/conversions.api', () => ({
  conversionsApi: new Proxy({}, {
    get: (_t, nombre) => {
      if (nombre === 'byLead') {
        return () => (montajes === 0
          ? Promise.resolve({ success: true, data: [venta] })
          : new Promise((r) => { byLeadPendiente = r; }));
      }
      return () => Promise.resolve({ success: true, data: [] });
    },
  }),
}));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/shared/components/ui/useConfirm', () => ({ useConfirm: () => vi.fn() }));
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
vi.mock('./InstallmentsDialog', () => ({
  default: function DialogoDeCuotas({ conversion, onSaved }: { conversion: unknown; onSaved?: () => void }) {
    useEffect(() => { if (conversion) montajes += 1; }, [conversion]);
    if (!conversion) return null;
    return <div data-testid="dialogo-cuotas"><button type="button" onClick={() => onSaved?.()}>cobrar cuota</button></div>;
  },
}));

const { default: ConversionsTab } = await import('./ConversionsTab');

beforeEach(() => { montajes = 0; byLeadPendiente = null; });

describe('ConversionsTab · el diálogo abierto sobrevive a la recarga (25/11, venta 540)', () => {
  it('al cobrar una cuota la lista recarga sin desmontar el diálogo de cuotas', async () => {
    render(<ConversionsTab lead={{ id: 3524 }} projectId={2} canManage />);
    fireEvent.click(await screen.findByRole('button', { name: /Cuotas/ }));
    expect(await screen.findByTestId('dialogo-cuotas')).toBeTruthy();
    expect(montajes).toBe(1);

    // Cobrar → onSaved → load(): mientras la lista recarga, el diálogo sigue ahí.
    fireEvent.click(screen.getByRole('button', { name: 'cobrar cuota' }));
    expect(screen.getByTestId('dialogo-cuotas')).toBeTruthy();

    await act(async () => { byLeadPendiente?.({ success: true, data: [venta] }); });
    await waitFor(() => expect(screen.getByTestId('dialogo-cuotas')).toBeTruthy());
    // El mismo diálogo, no uno nuevo: con su «Emitir ya la factura» dentro.
    expect(montajes).toBe(1);
  });

  it('la primera carga sí enseña el esqueleto', async () => {
    const { container } = render(<ConversionsTab lead={{ id: 3524 }} projectId={2} canManage />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    await screen.findByRole('button', { name: /Cuotas/ });
  });
});
