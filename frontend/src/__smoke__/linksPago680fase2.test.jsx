// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(() => cleanup());
import { render as pintar, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * #680, fase 2 · Los links de pago en la ficha del prospecto y de la venta, y
 * las reglas del campus en Integraciones.
 */

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
// El asistente mira el campus activo (link sencillo, 20/11): uno, el 1.
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeProject: { id: 1, nombre: 'Campus 1' }, projects: [{ id: 1, nombre: 'Campus 1' }] }) }));
vi.mock('@/shared/api/client', () => ({ default: { get, post, put, delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
// El servidor tiene los links encendidos (`/auth/me`).
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 2, funciones: { links_pago: true } } }) }));

// La tarjeta enlaza a la venta y el asistente navega (WhatsApp): con router.
const render = (ui) => pintar(<MemoryRouter>{ui}</MemoryRouter>);
const { default: LinksDePagoCard } = await import('@/modules/links-pago/components/LinksDePagoCard');
const { ReglasDeLosLinks } = await import('@/modules/links-pago/components/ConfigLinksPago');

const CONFIG = {
  project_id: 1, descuento_max_pct: 10, caducidad_dias: 7, caducidad_max_dias: 30,
  cuotas_admitidas: true, cuotas_max: 12, monedas: ['EUR'], moneda_defecto: 'EUR',
};
const CURSOS = [{ id: 5, nombre: 'Máster en Psicología', precio: '1000.00', moneda: 'EUR' }];
const LINK = {
  id: 9, project_id: 1, lead_id: 3, conversion_id: null, product_id: 5, product_nombre: 'Máster en Psicología',
  created_by: 2, creado_por_nombre: 'Gestora Uno', precio_catalogo: '1000.00', importe: '900.00', descuento_pct: '10.00',
  moneda: 'EUR', modalidad: 'unico', estado: 'creado', url: 'https://buy.stripe.com/test_x', caduca_el: '2026-11-25T10:00:00Z',
  pagado_el: null, anulado_por_nombre: null, anulado_el: null, motivo_anulacion: null, created_at: '2026-11-18T10:00:00Z',
};

beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset();
  get.mockImplementation(async (url) => {
    if (url === '/links-pago') return { success: true, data: [LINK] };
    // El asistente (19/11): el prospecto y sus ventas (aquí, ninguna).
    if (url === '/links-pago/ventas-del-prospecto') {
      return { success: true, data: { lead: { id: 3, nombre: 'Ana', email: null, telefono: null, project_id: 1, producto_interes_id: 5 }, ventas: [] } };
    }
    if (url.startsWith('/links-pago/config')) return { success: true, data: CONFIG };
    if (url === '/products') return { success: true, data: CURSOS };
    return { success: true, data: [] };
  });
});

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

  it('sin ninguna venta, el link sencillo: curso, pago único y crear (Carlos, 20/11)', async () => {
    permisos.mapa = { 'links_pago.crear': true };
    render(<LinksDePagoCard projectId={1} leadId={3} productoId={5} />);
    fireEvent.click(await screen.findByRole('button', { name: /Crear link de pago/ }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).queryByText('Este prospecto no tiene ninguna venta')).toBeNull();
    expect(await within(dialogo).findByRole('button', { name: 'Crear link' })).toBeTruthy();
  });
});

describe('crear sin clave de links en el campus (QA de /testeo del 18/11)', () => {
  const conAviso = (aviso_clave) => get.mockImplementation(async (url) => {
    if (url === '/links-pago') return { success: true, data: [] };
    if (url === '/links-pago/ventas-del-prospecto') {
      return { success: true, data: { lead: { id: 3, nombre: 'Ana', email: null, telefono: null, project_id: 1, producto_interes_id: 5 }, ventas: [] } };
    }
    if (url.startsWith('/links-pago/config')) return { success: true, data: { ...CONFIG, aviso_clave } };
    if (url === '/products') return { success: true, data: CURSOS };
    return { success: true, data: [] };
  });

  it('el asistente lo dice en cuanto sabe el campus y no deja rellenar ni enviar', async () => {
    permisos.mapa = { 'links_pago.crear': true };
    conAviso({ code: 'SIN_CLAVE_DE_LINKS', error: 'Este campus no tiene la clave de links de pago. La pone un admin en Integraciones › Links de pago.' });
    render(<LinksDePagoCard projectId={1} leadId={3} productoId={5} />);
    fireEvent.click(await screen.findByRole('button', { name: /Crear link de pago/ }));
    const dialogo = await screen.findByRole('dialog');
    const alerta = await within(dialogo).findByRole('alert');
    expect(alerta.textContent).toContain('no tiene la clave de links de pago');
    // En ISEIE el asistente va curso › importe › cómo paga; la venta, en «Para un
    // prospecto o una venta concretos». Lo que se rellena queda deshabilitado.
    expect(within(dialogo).getByLabelText('Importe').closest('fieldset').disabled).toBe(true);
    expect(within(dialogo).getByRole('radiogroup', { name: 'Cómo paga' }).closest('fieldset').disabled).toBe(true);
    expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(true);
    // El aviso no se repite en la lista de «por qué no deja»: lo dice una vez, arriba.
    expect(within(dialogo).getAllByText(/no tiene la clave de links de pago/)).toHaveLength(1);
    expect(within(dialogo).getByRole('button', { name: 'Cerrar' })).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('con clave (aviso_clave null) se rellena como siempre', async () => {
    permisos.mapa = { 'links_pago.crear': true };
    conAviso(null);
    render(<LinksDePagoCard projectId={1} leadId={3} productoId={5} />);
    fireEvent.click(await screen.findByRole('button', { name: /Crear link de pago/ }));
    const dialogo = await screen.findByRole('dialog');
    const importe = within(dialogo).getByLabelText('Importe');
    await vi.waitFor(() => expect(importe.closest('fieldset').disabled).toBe(false));
    expect(within(dialogo).queryByRole('alert')).toBeNull();
    await vi.waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(false));
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
