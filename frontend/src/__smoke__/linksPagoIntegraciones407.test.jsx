// @vitest-environment jsdom
// Gemela de la de MultiCRM (CRM#680, fase 1, en su integracionesTodos218). ISEIE no tiene
// un setup común de pruebas: el entorno, los matchers y la limpieza se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * #407 (gemela de CRM#680) · La tarjeta «Links de pago» de Integraciones: la clave de
 * escritura, aparte de la de lectura, y el descuento máximo del campus solo para quien
 * puede configurar los links. En ISEIE siempre hay un campus elegido.
 */

const ctx = vi.hoisted(() => ({ valor: {} }));
const get = vi.hoisted(() => vi.fn());
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ctx.valor }));
vi.mock('@/shared/api/client', () => ({ default: { get, put: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
// El servidor tiene los links encendidos (`/auth/me`, CRM#870).
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, funciones: { links_pago: true } } }) }));

const { default: IntegrationsPage } = await import('@/modules/accounting/pages/IntegrationsPage');

const CAMPUS_1 = { activeProject: { id: 1, nombre: 'ISEIE' } };

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async () => ({ success: true, data: null }));
});
afterEach(cleanup);

describe('#407 · la tarjeta de links de pago', () => {
  it('sale con su clave aparte y los permisos que necesita', async () => {
    permisos.mapa = { 'integrations.view': true, 'integrations.edit': true };
    ctx.valor = CAMPUS_1;
    render(<IntegrationsPage />);
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith('/integrations/stripe_links?projectId=1'));
    expect(screen.getByRole('heading', { name: /Links de pago/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Clave restringida de escritura/)).toBeInTheDocument();
    expect(screen.getByText('Checkout Sessions')).toBeInTheDocument();
    // Sin «Configurar los links de pago», ni el campo del descuento ni su petición.
    expect(screen.queryByLabelText(/Descuento máximo/)).toBeNull();
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining('/links-pago/config'));
  });

  it('con «Configurar los links de pago», el descuento máximo del campus', async () => {
    permisos.mapa = { 'integrations.view': true, 'integrations.edit': true, 'links_pago.configurar': true };
    get.mockImplementation(async (url) => (String(url).startsWith('/links-pago/config')
      ? { success: true, data: { project_id: 1, descuento_max_pct: 10 } }
      : { success: true, data: null }));
    ctx.valor = CAMPUS_1;
    render(<IntegrationsPage />);
    const campo = await screen.findByLabelText(/Descuento máximo/);
    await vi.waitFor(() => expect(campo.value).toBe('10'));
  });
});
