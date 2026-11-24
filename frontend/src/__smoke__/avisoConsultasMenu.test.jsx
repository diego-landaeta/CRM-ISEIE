// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

/**
 * Gemela de CRM#1082 (Diego, 24/11): el aviso en «Consultas» del menú con las que
 * esperan respuesta. La tutora, las suyas; administración, las de su campus.
 */
const estado = vi.hoisted(() => ({ role: 'tutor', permisos: {} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 3, role: estado.role }, activeProject: { id: 10 } }) }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => !!estado.permisos[k] }) }));
const get = vi.fn();
vi.mock('@/shared/api/client', () => ({ default: { get: (...a) => get(...a) } }));
const { default: ContadorConsultas } = await import('@/shared/components/layout/ContadorConsultas');

beforeEach(() => { get.mockReset(); get.mockResolvedValue({ success: true, data: { consultas: [], total: 3, plazoHoras: 24 } }); });
afterEach(() => cleanup());

describe('ContadorConsultas', () => {
  it('la tutora: sus pendientes', async () => {
    estado.permisos = { 'consultas.atender': true };
    render(<ContadorConsultas />);
    expect(await screen.findByText('3')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/consultas/mias?estado=pendientes');
  });
  it('administración: las de su campus', async () => {
    estado.permisos = { 'consultas.view': true };
    render(<ContadorConsultas />);
    await waitFor(() => expect(get.mock.calls[0][0]).toMatch(/^\/consultas\?estado=pendientes&projectId=10$/));
  });
  it('sin nada pendiente, no pinta nada; sin permiso, no pregunta', async () => {
    estado.permisos = { 'consultas.atender': true };
    get.mockResolvedValue({ success: true, data: { consultas: [], total: 0 } });
    const { container } = render(<ContadorConsultas />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    cleanup(); get.mockClear(); estado.permisos = {};
    render(<ContadorConsultas />);
    await new Promise((r) => setTimeout(r, 30));
    expect(get).not.toHaveBeenCalled();
  });
});
