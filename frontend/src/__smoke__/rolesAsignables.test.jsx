// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Gemela de CRM#644. Tony (admin de ICTESS en el 360, 03/11) intentó dar de
 * alta a una persona cinco veces con el rol «Soporte», y cinco veces el
 * servidor le dijo «Ese rol le daría lo que tú no tienes» sin decirle qué
 * cambiar. En ISEIE el alta es «Invitar usuario» de Configuración › Usuarios:
 * ahora pregunta antes qué roles puede dar (GET /users/roles-asignables) y los
 * que no, salen apagados y con su porqué. Si aun así el servidor dice
 * NO_LO_TIENES, se dice qué rol quitar.
 */

const ADMIN = { isAuthenticated: true, loading: false, projects: [], user: { id: 1, role: 'admin', roles_extra: [] } };
const si = { puede: true, faltan: [], cuantos: 0 };
const no = { puede: false, faltan: ['Recuperar prospectos borrados', 'Forma de los avisos', 'Ver las credenciales'], cuantos: 6 };
const LISTA = ['superadmin', 'admin', 'gestor', 'soporte', 'project_manager', 'tutor', 'colaborador'].map((rol) => ({
  rol, nombre: rol, principal: rol === 'soporte' || rol === 'superadmin' ? no : si, anadido: rol === 'soporte' || rol === 'superadmin' ? no : si,
}));

const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: avisos.toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ADMIN }));
vi.mock('@/shared/components/ui/useConfirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/shared/api/client', () => ({ default: { get: api.get, post: api.post, patch: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

import SettingsPage from '@/shared/pages/SettingsPage';
import { mensajeNoLoTienes } from '@/shared/lib/rolesAsignables';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (url) => {
    if (String(url).startsWith('/users/roles-asignables')) return { success: true, data: LISTA };
    if (String(url).startsWith('/users')) return { success: true, data: [] };
    return { success: true, data: [] };
  });
});

// Todo dentro de su contenedor: con un solo proceso para todas las pruebas,
// otro fichero puede dejar pintado su propio «Invitar usuario».
async function abrirInvitar() {
  const { container } = render(<MemoryRouter><SettingsPage /></MemoryRouter>);
  const screen = within(container);
  fireEvent.click(await screen.findByRole('button', { name: /Invitar usuario/ }));
  return screen;
}

describe('Invitar usuario: los roles que no puedes dar (gemela de CRM#644)', () => {
  it('el admin ve «Soporte» desactivado, con el aviso de por qué', async () => {
    const screen = await abrirInvitar();
    const aviso = await screen.findByTestId('rol-no-asignable-soporte');
    expect(aviso.textContent).toContain('No puedes dar este rol: le daría permisos que tú no tienes (Recuperar prospectos borrados, Forma de los avisos, Ver las credenciales…). Pídeselo a un superadmin.');
    const select = screen.getByLabelText('Rol *');
    const soporte = [...select.options].find((o) => o.value === 'soporte');
    expect(soporte.disabled).toBe(true);
    expect(soporte.textContent).toBe('Soporte (no puedes darlo)');
    // Los que sí puede dar, no.
    expect([...select.options].filter((o) => o.disabled).map((o) => o.value)).toEqual(['soporte']);
    expect(api.get).toHaveBeenCalledWith('/users/roles-asignables');
  });

  it('si la lista no llega, el formulario sigue como antes', async () => {
    api.get.mockImplementation(async (url) => {
      if (String(url).startsWith('/users/roles-asignables')) throw new Error('caído');
      return { success: true, data: [] };
    });
    const screen = await abrirInvitar();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/users/roles-asignables'));
    expect(screen.queryByTestId('rol-no-asignable-soporte')).toBeNull();
    expect([...screen.getByLabelText('Rol *').options].some((o) => o.disabled)).toBe(false);
  });
});

describe('si el servidor aun así dice NO_LO_TIENES, qué rol quitar', () => {
  const error = (data) => Object.assign(new Error('Ese rol le daría lo que tú no tienes: X'), {
    status: 403, data: { success: false, code: 'NO_LO_TIENES', error: 'Ese rol le daría lo que tú no tienes: X', data },
  });

  it('con el rol que dice el servidor', () => {
    expect(mensajeNoLoTienes(error({ roles: ['soporte'], faltan: ['Recuperar prospectos borrados'], cuantos: 1 }), { role: 'gestor', roles_extra: ['soporte'] }))
      .toBe('Quita «Soporte»: le daría permisos que tú no tienes (Recuperar prospectos borrados). Si de verdad lo necesita, pídeselo a un superadmin.');
  });

  it('sin él, los roles pedidos', () => {
    expect(mensajeNoLoTienes(error(undefined), { role: 'soporte', roles_extra: ['tutor'] }))
      .toMatch(/^Quita «Soporte» y «Tutor»: le daría permisos que tú no tienes\./);
  });

  it('otro error no es este', () => {
    expect(mensajeNoLoTienes(new Error('Error 500'), { role: 'gestor' })).toBeNull();
  });
});
