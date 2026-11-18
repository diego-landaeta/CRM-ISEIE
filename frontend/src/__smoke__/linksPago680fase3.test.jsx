// @vitest-environment jsdom
// Gemela de la de MultiCRM (#407, gemela de CRM#872 y CRM#891). ISEIE no tiene un setup
// común de pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';

/**
 * CRM#680, fase 3 · Desde una venta, la tarjeta de links sugiere lo pendiente y
 * mide el tope de descuento contra lo pendiente, como el servidor. Y un link
 * pagado dice cuándo.
 */

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
// La tarjeta mira en la sesión si los links están encendidos en el servidor (CRM#870).
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 2, funciones: { links_pago: true } } }) }));

const { default: LinksDePagoCard } = await import('@/modules/links-pago/components/LinksDePagoCard');

const CONFIG = {
  project_id: 1, descuento_max_pct: 10, caducidad_dias: 7, caducidad_max_dias: 30,
  cuotas_admitidas: true, cuotas_max: 12, monedas: ['EUR'], moneda_defecto: 'EUR',
};
const CURSOS = [{ id: 5, nombre: 'Máster en Educación Inclusiva', precio: '1000.00', moneda: 'EUR' }];
const PAGADO = {
  id: 9, project_id: 1, lead_id: 3, conversion_id: 8, product_id: 5, product_nombre: 'Máster en Educación Inclusiva',
  created_by: 2, creado_por_nombre: 'Gestora Uno', precio_catalogo: '1000.00', importe: '400.00', descuento_pct: '0.00',
  moneda: 'EUR', modalidad: 'unico', estado: 'pagado', url: 'https://buy.stripe.com/test_x', caduca_el: '2026-11-25T10:00:00Z',
  pagado_el: '2026-11-19T09:30:00Z', anulado_por_nombre: null, anulado_el: null, motivo_anulacion: null, created_at: '2026-11-18T10:00:00Z',
};

beforeEach(() => {
  get.mockReset(); post.mockReset();
  permisos.mapa = { 'links_pago.crear': true };
  get.mockImplementation(async (url) => {
    if (url === '/links-pago') return { success: true, data: [PAGADO] };
    if (url.startsWith('/links-pago/config')) return { success: true, data: CONFIG };
    if (url === '/products') return { success: true, data: CURSOS };
    return { success: true, data: [] };
  });
});

afterEach(cleanup);

describe('links desde una venta (fase 3)', () => {
  it('un link pagado dice cuándo, y no deja copiar ni anular', async () => {
    render(<LinksDePagoCard projectId={1} conversionId={8} productoId={5} pendiente={400} />);
    expect(await screen.findByText('Pagado')).toBeTruthy();
    expect(screen.getByText(/pagado \d/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Copiar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Anular/ })).toBeNull();
  });

  it('sugiere lo pendiente y el tope se mide contra él, no contra el catálogo', async () => {
    render(<LinksDePagoCard projectId={1} conversionId={8} productoId={5} pendiente={400} />);
    fireEvent.click(await screen.findByRole('button', { name: /Crear link de pago/ }));
    const dialogo = await screen.findByRole('dialog');
    const importe = within(dialogo).getByLabelText('Importe');
    await vi.waitFor(() => expect(importe.value).toBe('400'));
    // 400 es el 60 % menos que el catálogo, pero es justo lo que falta: no es descuento.
    expect(within(dialogo).queryByText(/% menos/)).toBeNull();
    await vi.waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(false));

    fireEvent.change(importe, { target: { value: '350' } });
    expect(within(dialogo).getByText(/menos que lo pendiente de la venta/)).toBeTruthy();
    expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(true);
  });

  it('venta sin nada pendiente: solo el admin', async () => {
    render(<LinksDePagoCard projectId={1} conversionId={8} productoId={5} pendiente={0} />);
    fireEvent.click(await screen.findByRole('button', { name: /Crear link de pago/ }));
    const dialogo = await screen.findByRole('dialog');
    expect(await within(dialogo).findByText(/no tiene nada pendiente/)).toBeTruthy();
  });
});
