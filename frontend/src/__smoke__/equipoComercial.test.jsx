// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

/*
  «Equipo comercial a su cargo» en la ficha de una persona (Carlos, 09/11/2026).
  Se ve si ya lleva a alguien o si quien mira tiene `equipos.gestionar`; con el
  permiso se marca y se guarda; sin él, solo se lee.
*/

const sesion = vi.hoisted(() => ({ user: { id: 1, role: 'superadmin' }, permissions: {} }));
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ default: api }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: avisos.toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => sesion }));

const { default: EquipoComercial } = await import('@/modules/equipo-comercial/components/EquipoComercial');

const EQUIPO = {
  lider: { id: 5, nombre: 'Raquel', role: 'admin' },
  gestoraIds: [11],
  gestoras: [{ id: 11, nombre: 'Fabiola', role: 'gestor', active: true }],
  candidatas: [
    { id: 11, nombre: 'Fabiola', role: 'gestor', campus: ['Campus A'] },
    { id: 12, nombre: 'Malena', role: 'gestor', campus: ['Campus A'] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  sesion.user = { id: 1, role: 'superadmin' };
  sesion.permissions = {};
  api.get.mockResolvedValue({ success: true, data: EQUIPO });
  api.put.mockImplementation(async (_url, body) => ({ success: true, data: { ...EQUIPO, gestoraIds: body.gestoraIds } }));
});
afterEach(cleanup);

describe('Equipo comercial a su cargo', () => {
  it('con el permiso: se ve, se marca otra gestora y se guarda la lista entera', async () => {
    render(<EquipoComercial userId={5} />);
    expect(await screen.findByText('Equipo comercial a su cargo')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/users/5/equipo-comercial');
    expect(screen.getByLabelText(/^Fabiola/)).toBeChecked();
    const malena = screen.getByLabelText(/^Malena/);
    expect(malena).not.toBeChecked();
    const guardar = screen.getByRole('button', { name: 'Guardar equipo' });
    expect(guardar).toBeDisabled();

    fireEvent.click(malena);
    expect(guardar).toBeEnabled();
    fireEvent.click(guardar);
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/users/5/equipo-comercial', { gestoraIds: [11, 12] }));
    await waitFor(() => expect(avisos.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Equipo guardado' })));
  });

  it('un error del servidor se dice y no se da por guardado', async () => {
    api.put.mockRejectedValueOnce(new Error('tiene que compartir algún campus'));
    render(<EquipoComercial userId={5} />);
    fireEvent.click(await screen.findByLabelText(/^Malena/));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar equipo' }));
    await waitFor(() => expect(avisos.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'No se ha guardado', description: 'tiene que compartir algún campus', variant: 'destructive',
    })));
  });

  it('sin el permiso: solo lectura, con sus gestoras y sin casillas', async () => {
    sesion.user = { id: 2, role: 'admin' };
    sesion.permissions = { 'users.view': true };
    render(<EquipoComercial userId={5} />);
    expect(await screen.findByText('Fabiola')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar equipo' })).not.toBeInTheDocument();
  });

  it('sin el permiso y sin equipo: no se pinta nada', async () => {
    sesion.user = { id: 2, role: 'admin' };
    sesion.permissions = { 'users.view': true };
    api.get.mockResolvedValue({ success: true, data: { ...EQUIPO, gestoraIds: [], gestoras: [] } });
    const { container } = render(<EquipoComercial userId={5} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('con el permiso dado por excepción a una admin, también se puede cambiar', async () => {
    sesion.user = { id: 2, role: 'admin' };
    sesion.permissions = { 'users.view': true, 'equipos.gestionar': true };
    render(<EquipoComercial userId={5} />);
    expect(await screen.findByRole('button', { name: 'Guardar equipo' })).toBeInTheDocument();
  });
});
