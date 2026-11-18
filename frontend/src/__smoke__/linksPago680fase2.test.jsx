// @vitest-environment jsdom
// Gemela de la de MultiCRM (#407, gemela de CRM#680, fase 2). ISEIE no tiene un setup
// común de pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';

/**
 * CRM#680, fase 2 · Los links de pago en la ficha del prospecto y de la venta, y
 * las reglas del campus en Integraciones.
 */

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put, delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
// El servidor tiene los links encendidos (`/auth/me`).
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 2, funciones: { links_pago: true } } }) }));

const { default: LinksDePagoCard } = await import('@/modules/links-pago/components/LinksDePagoCard');
const { ReglasDeLosLinks } = await import('@/modules/links-pago/components/ConfigLinksPago');

const CONFIG = {
  project_id: 1, descuento_max_pct: 10, caducidad_dias: 7, caducidad_max_dias: 30,
  cuotas_admitidas: true, cuotas_max: 12, monedas: ['EUR'], moneda_defecto: 'EUR',
};
const CURSOS = [{ id: 5, nombre: 'Máster en Educación Inclusiva', precio: '1000.00', moneda: 'EUR' }];
const LINK = {
  id: 9, project_id: 1, lead_id: 3, conversion_id: null, product_id: 5, product_nombre: 'Máster en Educación Inclusiva',
  created_by: 2, creado_por_nombre: 'Gestora Uno', precio_catalogo: '1000.00', importe: '900.00', descuento_pct: '10.00',
  moneda: 'EUR', modalidad: 'unico', estado: 'creado', url: 'https://buy.stripe.com/test_x', caduca_el: '2026-11-25T10:00:00Z',
  pagado_el: null, anulado_por_nombre: null, anulado_el: null, motivo_anulacion: null, created_at: '2026-11-18T10:00:00Z',
};

beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset();
  get.mockImplementation(async (url) => {
    if (url === '/links-pago') return { success: true, data: [LINK] };
    if (url.startsWith('/links-pago/config')) return { success: true, data: CONFIG };
    if (url === '/products') return { success: true, data: CURSOS };
    return { success: true, data: [] };
  });
});

afterEach(cleanup);

describe('la tarjeta de la ficha', () => {
  it('sin permiso de links, no sale ni pide nada', () => {
    permisos.mapa = {};
    const { container } = render(<LinksDePagoCard projectId={1} leadId={3} />);
    expect(container.textContent).toBe('');
    expect(get).not.toHaveBeenCalled();
  });

  it('lista los links del prospecto con su estado, y deja copiar y anular los vivos', async () => {
    permisos.mapa = { 'links_pago.crear': true };
    render(<LinksDePagoCard projectId={1} leadId={3} />);
    expect(await screen.findByText('Pendiente')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/links-pago', { params: { leadId: 3, limit: 50 } });
    expect(screen.getByRole('button', { name: /Copiar/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Anular/ })).toBeTruthy();
  });

  it('desde la venta, pide los de la venta', async () => {
    permisos.mapa = { 'links_pago.crear': true };
    render(<LinksDePagoCard projectId={1} conversionId={8} productoId={5} />);
    await screen.findByText('Pendiente');
    expect(get).toHaveBeenCalledWith('/links-pago', { params: { conversionId: 8, limit: 50 } });
  });

  it('crear: el precio del catálogo sale sugerido; pasarse del tope no deja enviar; dentro, manda lo que toca', async () => {
    permisos.mapa = { 'links_pago.crear': true };
    post.mockResolvedValue({ success: true, data: { ...LINK, id: 10, importe: '950.00' } });
    render(<LinksDePagoCard projectId={1} leadId={3} productoId={5} />);
    fireEvent.click(await screen.findByRole('button', { name: /Crear link de pago/ }));
    const dialogo = await screen.findByRole('dialog');
    const importe = within(dialogo).getByLabelText('Importe');
    await vi.waitFor(() => expect(importe.value).toBe('1000'));
    expect(within(dialogo).getByLabelText(/Caduca a los/).value).toBe('7');

    fireEvent.change(importe, { target: { value: '850' } });
    expect(within(dialogo).getByText(/máximo en este campus es un 10 %/)).toBeTruthy();
    expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(true);

    fireEvent.change(importe, { target: { value: '950' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear link' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago', {
      leadId: 3, productId: 5, importe: 950, moneda: 'EUR', caducidad_dias: 7,
    }));
    expect(await within(dialogo).findByText('Link creado')).toBeTruthy();
    expect(within(dialogo).getByLabelText('Link de pago').value).toBe('https://buy.stripe.com/test_x');
  });
});

describe('las reglas del campus en Integraciones', () => {
  it('salen las guardadas y solo se manda lo que cambia', async () => {
    put.mockResolvedValue({ success: true, data: { ...CONFIG, caducidad_dias: 5, monedas: ['EUR', 'USD'] } });
    render(<ReglasDeLosLinks projectId={1} />);
    const dias = await screen.findByLabelText('Caduca a los (días)');
    await vi.waitFor(() => expect(dias.value).toBe('7'));
    expect(screen.getByLabelText(/Descuento máximo/).value).toBe('10');
    expect(screen.getByRole('button', { name: /Guardar reglas/ }).disabled).toBe(true);

    fireEvent.change(dias, { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Monedas admitidas'), { target: { value: 'eur, usd' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar reglas/ }));
    await vi.waitFor(() => expect(put).toHaveBeenCalledWith('/links-pago/config', {
      projectId: 1, caducidad_dias: 5, monedas: ['EUR', 'USD'],
    }));
  });
});
