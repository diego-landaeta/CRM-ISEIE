// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

/**
 * FRACCIONADO: ¿se cobra con link de pago? (Diego, 24/11/2026).
 *
 * «Cuando alguien pone fraccionado, no siempre pagan con link de pago: hay que
 * poner usar link de pago o no. Si es no, no sale para generar; y si es sí,
 * algunas veces pagan la inicial con otro link de pago o transferencia: pedir
 * esos datos.»
 *
 * Antes venía todo marcado de serie («Generar link» y «la inicial con link»).
 * Ahora es una pregunta sin nada marcado, y la inicial ya pagada lleva su
 * método real y su referencia.
 */
vi.mock('@/shared/lib/linksPago', () => ({ useLinksPagoEncendidos: () => true, linksPagoEncendidos: () => true }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => k === 'links_pago.crear', llevaEquipo: false }) }));
vi.mock('@/shared/components/ui/portal', () => ({ default: ({ children }) => children }));
vi.mock('@/shared/hooks/useDialogA11y', () => ({ useEscapeKey: () => {} }));
vi.mock('@/modules/products/hooks/useProducts', () => ({ useProducts: () => ({ products: [] }) }));
vi.mock('@/modules/conversions/hooks/useProductosConCurso', async (original) => ({ ...(await original()), useProductosConCurso: () => null }));

const createMock = vi.fn();
const cuotasMock = vi.fn();
vi.mock('@/modules/conversions/api/conversions.api', () => ({
  conversionsApi: { create: (...a) => createMock(...a), generateInstallments: (...a) => cuotasMock(...a) },
}));
const planMock = vi.fn();
const linkMock = vi.fn();
vi.mock('@/modules/links-pago/api/linksPago.api', () => ({
  generarPlan: (...a) => planMock(...a),
  crearLink: (...a) => linkMock(...a),
}));
const toastMock = vi.fn();
vi.mock('@/shared/hooks/useToast', () => ({ toast: (...a) => toastMock(...a) }));

const { default: ConversionDialog } = await import('@/modules/conversions/components/ConversionDialog');

const lead = { id: 99, nombre: 'Ana Test' };

afterEach(() => cleanup());
beforeEach(() => {
  createMock.mockReset(); createMock.mockResolvedValue({ success: true, data: { id: 7 } });
  cuotasMock.mockReset(); cuotasMock.mockResolvedValue({ success: true });
  planMock.mockReset(); planMock.mockResolvedValue({ success: true, data: { cuotas: [] } });
  linkMock.mockReset(); toastMock.mockReset();
});

/** Una venta de 900 € con «Parcial» de 300 €: el resto, fraccionado. */
function ventaFraccionada() {
  const r = render(<ConversionDialog open onClose={vi.fn()} lead={lead} projectId={1} />);
  const { container } = r;
  const inicio = container.querySelector('#venta-fecha-inicio');
  if (inicio) fireEvent.change(inicio, { target: { value: '2026-12-01' } });
  fireEvent.change(container.querySelector('input[placeholder*="producto"]'), { target: { value: 'Máster X' } });
  fireEvent.change(container.querySelector('input[type="number"][required]'), { target: { value: '900' } });
  fireEvent.click(screen.getByRole('button', { name: /^Parcial$/i }));
  fireEvent.change(container.querySelector('input[aria-label="Cuánto pagó hoy"]'), { target: { value: '300' } });
  return r;
}
const enviar = (container) => fireEvent.submit(container.querySelector('form'));

describe('fraccionado: ¿se cobra con link de pago?', () => {
  it('pregunta, sin nada marcado, y sin la casilla «Generar link» de siempre', () => {
    ventaFraccionada();
    expect(screen.getByText('¿Se cobra con link de pago?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sí, con link' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'No' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText(/Generar link de pago de Stripe/)).toBeNull();
  });

  it('sin contestar, no se registra', async () => {
    const { container } = ventaFraccionada();
    enviar(container);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Falta decir si se cobra con link de pago' })));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('con «No», ningún link: la venta con su inicial cobrada y su método', async () => {
    const { container } = ventaFraccionada();
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(screen.queryByText('¿Cómo paga la inicial?')).toBeNull();
    fireEvent.change(container.querySelector('#venta-ref-inicial'), { target: { value: 'OP-123' } });
    enviar(container);
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const body = createMock.mock.calls[0][0];
    expect(body.importe_pagado).toBe(300);
    expect(body.referencia_pago_inicial).toBe('OP-123');
    await waitFor(() => expect(cuotasMock).toHaveBeenCalled());
    expect(planMock).not.toHaveBeenCalled();
    expect(linkMock).not.toHaveBeenCalled();
  });

  it('con «Sí», hay que decir cómo paga la inicial', async () => {
    const { container } = ventaFraccionada();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, con link' }));
    expect(screen.getByText('¿Cómo paga la inicial?')).toBeTruthy();
    enviar(container);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Falta decir cómo paga la inicial' })));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('«Sí» + «ya la pagó por transferencia»: inicial cobrada por transferencia, con su referencia, y links de las cuotas', async () => {
    const { container } = ventaFraccionada();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, con link' }));
    fireEvent.click(screen.getByLabelText('Ya la pagó por transferencia.'));
    // El método va implícito: no se pregunta otra vez.
    expect(container.querySelector('#venta-metodo-inicial')).toBeNull();
    fireEvent.change(container.querySelector('#venta-ref-inicial'), { target: { value: 'TRF-9' } });
    enviar(container);
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const body = createMock.mock.calls[0][0];
    expect(body.importe_pagado).toBe(300);
    expect(body.metodo_pago_inicial).toBe('transferencia');
    expect(body.referencia_pago_inicial).toBe('TRF-9');
    await waitFor(() => expect(planMock).toHaveBeenCalledWith(7));
  });

  it('«Sí» + «ya la pagó con otro link»: la inicial cobrada como Stripe', async () => {
    const { container } = ventaFraccionada();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, con link' }));
    fireEvent.click(screen.getByLabelText('Ya la pagó con otro link de pago.'));
    enviar(container);
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const body = createMock.mock.calls[0][0];
    expect(body.importe_pagado).toBe(300);
    expect(body.metodo_pago_inicial).toBe('tarjeta_stripe');
  });

  it('«Sí» + «con el link»: la inicial NO está cobrada (va como cuota 1 con su link)', async () => {
    const { container } = ventaFraccionada();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, con link' }));
    fireEvent.click(screen.getByLabelText(/Con el link de pago \(aún no la ha pagado\)/));
    enviar(container);
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0].importe_pagado).toBe(0);
    await waitFor(() => expect(planMock).toHaveBeenCalledWith(7));
  });
});
