// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Seguimiento de los links que no se pagan (gemela de CRM#984, #659; Diego, 21/11/2026).
 *
 *   · en «Links de pago», cada link dice cuándo lo abrió el alumno, qué
 *     recordatorios le han salido y si se renovó;
 *   · un caducado tiene «Renovar»: crea uno nuevo igual y recarga la lista; un
 *     link vivo, pagado o ya renovado, no;
 *   · la tarjeta de Integraciones guarda las horas del aviso a la gestora y si
 *     se mandan los recordatorios.
 */

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put, delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 2, funciones: { links_pago: true } }, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeProject: { id: 1 }, activeIssuerId: null, projects: [{ id: 1, nombre: 'Campus Uno' }] }) }));
vi.mock('@/shared/components/layout/CabeceraContext', () => ({ useCabecera: () => null }));

const { default: LinksDePagoPage } = await import('@/modules/links-pago/pages/LinksDePagoPage');
const { ReglasDeLosLinks } = await import('@/modules/links-pago/components/ConfigLinksPago');

const BASE = {
  project_id: 1, project_nombre: 'Campus Uno', lead_id: 3, lead_nombre: 'Laura Gómez', conversion_id: null,
  product_id: 5, product_nombre: 'Psicopedagogía', created_by: 2, creado_por_nombre: 'Gestora Uno',
  precio_catalogo: '900.00', importe: '900.00', descuento_pct: '0', moneda: 'EUR', modalidad: 'unico',
  url: 'https://buy.stripe.com/test_1', caduca_el: '2026-11-28T10:00:00Z', pagado_el: null,
  anulado_por_nombre: null, anulado_el: null, motivo_anulacion: null, created_at: '2026-11-19T10:00:00Z',
};
const ABIERTO = { ...BASE, id: 41, estado: 'abierto', abierto_el: '2026-11-20T09:30:00Z', aviso_gestora_el: '2026-11-20T11:30:00Z', recordatorio_24h_el: '2026-11-20T10:00:00Z' };
const CADUCADO = { ...BASE, id: 42, estado: 'caducado', url: 'https://buy.stripe.com/test_2' };
const RENOVADO = { ...BASE, id: 43, estado: 'caducado', renovado_por: 50 };
let lista;

beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset();
  permisos.mapa = { 'links_pago.crear': true };
  lista = [ABIERTO, CADUCADO, RENOVADO];
  get.mockImplementation(async (url) => {
    if (url === '/links-pago') return { success: true, data: lista, pagination: { total: lista.length, page: 1, limit: 25, totalPages: 1 } };
    return { success: true, data: [] };
  });
});
afterEach(cleanup);

const pintar = () => render(<MemoryRouter><LinksDePagoPage /></MemoryRouter>);

describe('la lista de «Links de pago»', () => {
  it('cuenta cuándo se abrió, los avisos y la renovación', async () => {
    pintar();
    const abierto = await screen.findByText(/abierto el .* sin pagar/);
    expect(abierto.textContent).toContain('aviso a la gestora enviado');
    expect(abierto.textContent).toContain('recordatorio de 24 h al alumno');
    expect(screen.getByText('renovado en el n.º 50')).toBeTruthy();
    expect(screen.getAllByText('Abierto').length).toBeGreaterThan(0);
  });

  it('«Renovar» solo en el caducado sin renovar; crea el nuevo y recarga', async () => {
    post.mockResolvedValue({ success: true, data: { ...BASE, id: 51, estado: 'creado', renovado_de: 42 } });
    pintar();
    const botones = await screen.findAllByRole('button', { name: /Renovar/ });
    expect(botones).toHaveLength(1);
    const llamadasAntes = get.mock.calls.filter(([u]) => u === '/links-pago').length;
    fireEvent.click(botones[0]);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago/42/renovar', {}));
    await waitFor(() => expect(get.mock.calls.filter(([u]) => u === '/links-pago').length).toBeGreaterThan(llamadasAntes));
  });

  it('sin permiso para crear links, no hay «Renovar»', async () => {
    permisos.mapa = { 'links_pago.ver_todos': true };
    pintar();
    await screen.findByText(/abierto el/);
    expect(screen.queryByRole('button', { name: /Renovar/ })).toBeNull();
  });
});

describe('la tarjeta de Integraciones', () => {
  it('guarda las horas del aviso y los recordatorios', async () => {
    get.mockImplementation(async () => ({
      success: true,
      data: {
        project_id: 1, descuento_max_pct: 0, caducidad_dias: 7, caducidad_max_dias: 30, cuotas_admitidas: false, cuotas_max: 12,
        monedas: ['EUR'], moneda_defecto: 'EUR', aviso_abierto_horas: 2, recordatorios: true,
      },
    }));
    put.mockResolvedValue({ success: true, data: { project_id: 1, aviso_abierto_horas: 6, recordatorios: false } });
    render(<ReglasDeLosLinks projectId={1} />);
    const horas = await screen.findByLabelText(/avisar a la gestora a las/);
    fireEvent.change(horas, { target: { value: '6' } });
    fireEvent.click(screen.getByLabelText(/Recordar el pago al alumno/));
    fireEvent.click(screen.getByRole('button', { name: /Guardar reglas/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/links-pago/config', { projectId: 1, aviso_abierto_horas: 6, recordatorios: false }));
  });
});
