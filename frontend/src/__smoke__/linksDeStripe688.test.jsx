// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Links de pago creados directamente en Stripe (CRM-ISEIE#688, gemela de CRM#1019): la parte de la
 * pantalla «Links de pago».
 *
 *   · con «Ver los links de todos», los links de Stripe salen como «Creado en
 *     Stripe», con lo que cobran, si están activos y si admiten códigos;
 *   · «Traer de Stripe» los lee ahora (solo con un campus elegido);
 *   · la bandeja «Cobros de Stripe por vincular» dice por qué no se vinculó solo,
 *     propone las ventas candidatas y busca otras; elegir una pide confirmar y
 *     vincula;
 *   · sin el permiso no sale nada.
 */

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));

const { default: LinksDeStripe } = await import('@/modules/links-pago/components/LinksDeStripe');

const LINK = {
  id: 3, project_id: 1, project_nombre: 'Campus Uno', stripe_payment_link_id: 'plink_1', url: 'https://buy.stripe.com/test_1',
  activo: true, nombre: 'Máster hecho en Stripe', importe: '450.00', moneda: 'EUR', codigos_promocionales: true,
  visto_el: '2026-11-23T10:00:00Z', actualizado_el: '2026-11-23T10:00:00Z', cobros: 2, cobrado: 900, por_vincular: 1,
};
const COBRO = {
  id: 7, project_id: 1, project_nombre: 'Campus Uno', stripe_id: 'ch_1', importe: 300, moneda: 'EUR', cobrado_el: '2026-11-23T11:00:00Z',
  email: 'pagadora@correo.test', nombre: 'Pagadora', telefono: null, descuento: 30, codigo: 'VERANO',
  motivo: 'varias_coincidencias', motivo_texto: 'Hay varias ventas o fichas que podrían ser',
  candidatos: [
    { conversion_id: 81, lead_id: 3, lead_nombre: 'Ana Pérez', producto: 'Máster', importe_total: 1000, pendiente: 370 },
    { conversion_id: 82, lead_id: 3, lead_nombre: 'Ana Pérez', producto: 'Experto', importe_total: 600, pendiente: 600 },
  ],
  link_id: 3, link_nombre: 'Máster hecho en Stripe', link_url: 'https://buy.stripe.com/test_1',
};

beforeEach(() => {
  get.mockReset(); post.mockReset();
  permisos.mapa = { 'links_pago.ver_todos': true };
  get.mockImplementation(async (url, opts) => {
    if (url === '/links-pago/externos') return { success: true, data: [LINK] };
    if (url === '/links-pago/por-vincular') return { success: true, data: [COBRO] };
    if (url === '/links-pago/por-vincular/ventas') {
      return { success: true, data: opts?.params?.q === 'luis' ? [{ conversion_id: 90, lead_id: 9, lead_nombre: 'Luis Gil', producto: 'Curso', pendiente: 300 }] : [] };
    }
    return { success: true, data: [] };
  });
  post.mockResolvedValue({ success: true, data: { conversion_id: 81, conversion_payment_id: 5, links: 1, nuevos: 0, cobros: 0 } });
});
afterEach(cleanup);

const pintar = (ambito = { projectId: 1 }) => render(<MemoryRouter><LinksDeStripe ambito={ambito} /></MemoryRouter>);

describe('los links creados en Stripe', () => {
  it('salen como «Creado en Stripe», con su importe, su estado y si admiten códigos', async () => {
    pintar();
    const fila = (await screen.findByText('Máster hecho en Stripe')).closest('li');
    expect(within(fila).getByText('Creado en Stripe')).toBeTruthy();
    expect(within(fila).getByText('Activo')).toBeTruthy();
    expect(fila.textContent).toMatch(/450,00/);
    expect(fila.textContent).toMatch(/admite códigos promocionales/);
    expect(fila.textContent).toMatch(/2 cobros/);
    expect(fila.textContent).toMatch(/1 por vincular/);
    expect(get).toHaveBeenCalledWith('/links-pago/externos', { params: { projectId: 1 } });
  });

  it('«Traer de Stripe» los lee para el campus elegido; sin campus, no se puede', async () => {
    pintar();
    await screen.findByText('Máster hecho en Stripe');
    fireEvent.click(screen.getByRole('button', { name: /Traer de Stripe/ }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago/externos/sincronizar', { projectId: 1 }));
    cleanup();
    pintar({});
    await screen.findByText('Máster hecho en Stripe');
    expect(screen.getByRole('button', { name: /Traer de Stripe/ }).disabled).toBe(true);
  });

  it('sin «Ver los links de todos» no sale nada ni se pide nada', () => {
    permisos.mapa = { 'links_pago.crear': true };
    const { container } = pintar();
    expect(container.textContent).toBe('');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('«Cobros de Stripe por vincular»', () => {
  it('dice por qué y propone las ventas; elegir una pide confirmar y la vincula', async () => {
    pintar();
    const bandeja = (await screen.findByText(/Cobros de Stripe por vincular \(1\)/)).closest('section');
    expect(bandeja.textContent).toMatch(/Hay varias ventas o fichas que podrían ser/);
    expect(bandeja.textContent).toMatch(/VERANO/);
    fireEvent.click(within(bandeja).getByRole('button', { name: /Venta n\.º 81/ }));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo.textContent).toMatch(/venta n\.º 81/);
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Vincular' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago/por-vincular/7/vincular', { conversionId: 81 }));
  });

  it('busca otra venta del campus del cobro', async () => {
    pintar();
    const bandeja = (await screen.findByText(/Cobros de Stripe por vincular/)).closest('section');
    fireEvent.change(within(bandeja).getByLabelText('Buscar la venta'), { target: { value: 'luis' } });
    fireEvent.click(within(bandeja).getByRole('button', { name: /Buscar/ }));
    expect(await within(bandeja).findByRole('button', { name: /Venta n\.º 90/ })).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/links-pago/por-vincular/ventas', { params: { cargoId: 7, q: 'luis' } });
  });

  it('sin cobros por vincular, la bandeja no sale', async () => {
    get.mockImplementation(async (url) => (url === '/links-pago/externos' ? { success: true, data: [LINK] } : { success: true, data: [] }));
    pintar();
    await screen.findByText('Máster hecho en Stripe');
    expect(screen.queryByText(/Cobros de Stripe por vincular/)).toBeNull();
  });
});
