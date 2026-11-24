// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { useState } from 'react';

/**
 * CRM-ISEIE#762, gemela de CRM#1107 (Diego, 24/11/2026).
 *
 *   · Crear un link desde un prospecto ya crea su venta: la pantalla del link lo
 *     dice (venta nueva, la que ya tenía la ficha, o que se creará al pagarlo).
 *   · En la venta, cuando la inicial ya se pagó con otro link o con Stripe, el
 *     campo «Link de pago usado»: «Buscar en Stripe» dice lo que encontraría y,
 *     al registrar, se avisa de si el cobro se unió a la venta o por qué no.
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
vi.mock('@/modules/links-pago/api/linksPago.api', () => ({
  generarPlan: (...a) => planMock(...a),
  crearLink: vi.fn(),
}));
const buscarMock = vi.fn();
vi.mock('@/modules/conversions/api/linkUsado.api', async (original) => ({
  ...(await original()),
  buscarCobro: (...a) => buscarMock(...a),
}));
const toastMock = vi.fn();
vi.mock('@/shared/hooks/useToast', () => ({ toast: (...a) => toastMock(...a) }));

const { default: ConversionDialog } = await import('@/modules/conversions/components/ConversionDialog');
const { default: LinkDePagoUsado } = await import('@/modules/conversions/components/LinkDePagoUsado');
const { pareceDeStripe, acortarReferencia } = await import('@/modules/conversions/api/linkUsado.api');
const { textoDeLaVenta } = await import('@/modules/links-pago/components/CrearLinkAsistente');

afterEach(() => cleanup());

beforeEach(() => {
  createMock.mockReset(); createMock.mockResolvedValue({ success: true, data: { id: 7 } });
  cuotasMock.mockReset(); cuotasMock.mockResolvedValue({ success: true });
  planMock.mockReset(); planMock.mockResolvedValue({ success: true, data: { cuotas: [] } });
  buscarMock.mockReset(); toastMock.mockReset();
});

describe('lo que se pega como link de pago usado', () => {
  it('reconoce los links y los ids de Stripe; una referencia de banco, no', () => {
    expect(pareceDeStripe('https://buy.stripe.com/test_abc123')).toBe(true);
    expect(pareceDeStripe('pi_3Nabcdef')).toBe(true);
    expect(pareceDeStripe('plink_1Qabcdef')).toBe(true);
    expect(pareceDeStripe('cs_live_a1B2c3d4')).toBe(true);
    expect(pareceDeStripe('TRF-12345')).toBe(false);
  });
  it('lo largo cabe en la referencia: el id de Stripe, o sin lo de después de «?»', () => {
    const largo = `https://checkout.stripe.com/c/pay/cs_live_a1B2c3d4e5#${'x'.repeat(200)}`;
    expect(acortarReferencia(largo)).toBe('cs_live_a1B2c3d4e5');
    expect(acortarReferencia(`https://buy.stripe.com/abc?prefilled_email=${'y'.repeat(200)}`)).toBe('https://buy.stripe.com/abc');
    expect(acortarReferencia('pi_corto123')).toBe('pi_corto123');
  });
});

describe('la pantalla del link dice qué venta lleva', () => {
  it('la nueva, la que ya tenía la ficha, la que no se pudo crear y la del link sin prospecto', () => {
    expect(textoDeLaVenta({ venta_del_link: { conversion_id: 31, creada: true } }, null, 'Ana'))
      .toMatch(/^Venta n\.º 31 creada a tu nombre, pendiente de cobro/);
    expect(textoDeLaVenta({ venta_del_link: { conversion_id: 12, creada: false } }, null, 'Ana'))
      .toMatch(/venta n\.º 12 que ya tenía de este curso/);
    expect(textoDeLaVenta({ venta_del_link: { conversion_id: null, creada: false, error: 'caído' } }, null, 'Ana'))
      .toMatch(/se creará al pagarlo/);
    expect(textoDeLaVenta({}, null, null)).toMatch(/^Sin prospecto/);
  });
});

describe('«Link de pago usado»', () => {
  it('«Buscar en Stripe» solo con algo de Stripe, y enseña lo que encontró', async () => {
    buscarMock.mockResolvedValue({ success: true, data: { estado: 'encontrado', mensaje: 'Encontrado: 300,00 € del 20/11/2026 (pagó con otra@x.com).' } });
    function Envoltorio() {
      const [v, setV] = useState('');
      return <LinkDePagoUsado projectId={4} importe={300} value={v} onChange={setV} />;
    }
    render(<Envoltorio />);
    const boton = screen.getByRole('button', { name: /Buscar en Stripe/ });
    fireEvent.change(screen.getByLabelText(/Link de pago usado/), { target: { value: 'TRF-1' } });
    expect(boton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Link de pago usado/), { target: { value: 'https://buy.stripe.com/test_abc' } });
    expect(boton.disabled).toBe(false);
    fireEvent.click(boton);
    await waitFor(() => expect(screen.getByTestId('link-usado-resultado').textContent).toMatch(/otra@x\.com/));
    expect(buscarMock).toHaveBeenCalledWith(4, 'https://buy.stripe.com/test_abc', 300);
  });

  it('en la venta: «Sí, con link» + «ya la pagó con otro link» lo pide, y al registrar dice si se unió', async () => {
    createMock.mockResolvedValue({
      success: true,
      data: { id: 7, cargo_inicial: { estado: 'en_otra_venta', mensaje: 'Ese cobro de Stripe ya está unido a la venta n.º 3: no se ha movido.' } },
    });
    const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={{ id: 99, nombre: 'Ana Test' }} projectId={1} />);
    const inicio = container.querySelector('#venta-fecha-inicio');
    if (inicio) fireEvent.change(inicio, { target: { value: '2026-12-01' } });
    fireEvent.change(container.querySelector('input[placeholder*="producto"]'), { target: { value: 'Máster X' } });
    fireEvent.change(container.querySelector('input[type="number"][required]'), { target: { value: '900' } });
    fireEvent.click(screen.getByRole('button', { name: /^Parcial$/i }));
    fireEvent.change(container.querySelector('input[aria-label="Cuánto pagó hoy"]'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sí, con link' }));
    fireEvent.click(screen.getByLabelText('Ya la pagó con otro link de pago.'));
    expect(screen.getByText('Link de pago usado (opcional)')).toBeTruthy();
    fireEvent.change(container.querySelector('#venta-ref-inicial'), { target: { value: 'pi_3Nabcdef' } });
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const body = createMock.mock.calls[0][0];
    expect(body).toMatchObject({ importe_pagado: 300, metodo_pago_inicial: 'tarjeta_stripe', referencia_pago_inicial: 'pi_3Nabcdef' });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'El cobro de Stripe no se ha unido', description: expect.stringMatching(/venta n\.º 3/), variant: 'destructive',
    })));
  });
});

