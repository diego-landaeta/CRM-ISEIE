// @vitest-environment jsdom
// Gemela de la de MultiCRM (#407, gemela de CRM#870). ISEIE no tiene un setup común
// de pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * CRM#680 · Los links de pago en el frontal de PRODUCCIÓN.
 *
 * Antes la tarjeta de la ficha y la de Integraciones iban detrás de
 * `SOLO_EN_PRUEBAS`: en producción no salían nunca, aunque el servidor tuviera
 * LINKS_PAGO_EN_PRODUCCION=1. Ahora mandan el servidor (`/auth/me` →
 * `user.funciones.links_pago`) y los permisos `links_pago.*`. Aquí se compila
 * «como producción» (`SOLO_EN_PRUEBAS` = false).
 */

vi.mock('@/shared/lib/enPruebas', () => ({ SOLO_EN_PRUEBAS: false, PROCESO_EN_PRUEBAS: false }));
const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
const sesion = vi.hoisted(() => ({ user: null }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => sesion }));
const ctx = vi.hoisted(() => ({ valor: {} }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ctx.valor }));

const { default: LinksDePagoCard } = await import('@/modules/links-pago/components/LinksDePagoCard');
const { default: IntegrationsPage } = await import('@/modules/accounting/pages/IntegrationsPage');
const { linksPagoEncendidos } = await import('@/shared/lib/linksPago');

const LINK = {
  id: 9, project_id: 1, lead_id: 3, product_id: 5, product_nombre: 'Curso de prueba', created_by: 2,
  creado_por_nombre: 'Gestora', importe: '100.00', descuento_pct: '0', moneda: 'EUR', modalidad: 'unico',
  estado: 'creado', url: 'https://buy.stripe.com/test_x', caduca_el: '2026-11-25T10:00:00Z', created_at: '2026-11-18T10:00:00Z',
};

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url) => (url === '/links-pago' ? { success: true, data: [LINK] } : { success: true, data: null }));
  ctx.valor = { activeProject: { id: 1, nombre: 'Campus' } };
});
afterEach(cleanup);

describe('qué dice el servidor', () => {
  it('lo que diga /auth/me; si no dice nada (servidor anterior), como antes: solo en pruebas', () => {
    expect(linksPagoEncendidos({ funciones: { links_pago: true } })).toBe(true);
    expect(linksPagoEncendidos({ funciones: { links_pago: false } })).toBe(false);
    expect(linksPagoEncendidos({ id: 1 })).toBe(false);
    expect(linksPagoEncendidos(null)).toBe(false);
  });
});

describe('la tarjeta de la ficha, en producción', () => {
  it('con los links encendidos en el servidor y permiso: sale, sin la etiqueta «PRUEBAS»', async () => {
    sesion.user = { id: 2, funciones: { links_pago: true } };
    permisos.mapa = { 'links_pago.crear': true };
    render(<LinksDePagoCard projectId={1} leadId={3} />);
    expect(await screen.findByText('Pendiente')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Crear link de pago/ })).toBeTruthy();
    expect(screen.queryByText('PRUEBAS')).toBeNull();
  });

  it('con los links apagados en el servidor: no sale ni pide nada, aunque tenga permiso', () => {
    sesion.user = { id: 2, funciones: { links_pago: false } };
    permisos.mapa = { 'links_pago.crear': true, 'links_pago.ver_todos': true };
    const { container } = render(<LinksDePagoCard projectId={1} leadId={3} />);
    expect(container.textContent).toBe('');
    expect(get).not.toHaveBeenCalled();
  });

  it('encendidos pero sin permiso de links: no sale', () => {
    sesion.user = { id: 2, funciones: { links_pago: true } };
    permisos.mapa = {};
    const { container } = render(<LinksDePagoCard projectId={1} leadId={3} />);
    expect(container.textContent).toBe('');
  });
});

describe('Integraciones › Links de pago, en producción', () => {
  it('encendidos y con permiso: sale la tarjeta, sin «PRUEBAS»', async () => {
    sesion.user = { id: 1, funciones: { links_pago: true } };
    permisos.mapa = { 'integrations.view': true, 'links_pago.configurar': true };
    render(<IntegrationsPage />);
    const titulo = await screen.findByRole('heading', { name: /Links de pago/ });
    expect(titulo.textContent).not.toMatch(/PRUEBAS/);
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith('/integrations/stripe_links?projectId=1'));
  });

  it('apagados en el servidor: ni la tarjeta ni su petición', async () => {
    sesion.user = { id: 1, funciones: { links_pago: false } };
    permisos.mapa = { 'integrations.view': true, 'integrations.edit': true, 'links_pago.configurar': true };
    render(<IntegrationsPage />);
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('/integrations/stripe?projectId=1')));
    expect(screen.queryByRole('heading', { name: /Links de pago/ })).toBeNull();
    expect(get).not.toHaveBeenCalledWith('/integrations/stripe_links?projectId=1');
  });

  it('encendidos, pero sin poder poner la clave ni las reglas: no sale', async () => {
    sesion.user = { id: 1, funciones: { links_pago: true } };
    permisos.mapa = { 'integrations.view': true };
    render(<IntegrationsPage />);
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('/integrations/stripe?projectId=1')));
    expect(screen.queryByRole('heading', { name: /Links de pago/ })).toBeNull();
  });
});
