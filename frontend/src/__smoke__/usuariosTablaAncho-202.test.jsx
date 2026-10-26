// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * #202 (gemela de la #221 de MultiCRM): en Configuración → Usuarios la tabla se
 * salía por la derecha y se cortaban «Invitar usuario» y las acciones.
 *
 * En ISEIE la tabla es otra (cuatro columnas, dentro de SettingsPage), pero el
 * fallo era el mismo: la caja con `overflow-hidden` recortaba lo que no cabía.
 * Ahora la tabla se desplaza dentro de su caja, y ni el botón ni «Editar» /
 * «Desactivar» se parten en dos líneas.
 */

const ADMIN = {
  isAuthenticated: true,
  loading: false,
  projects: [],
  user: { id: 1, role: 'admin', roles_extra: [] },
};
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ADMIN }));
vi.mock('@/shared/components/ui/useConfirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/shared/api/client', () => ({
  default: {
    get: vi.fn(async (url) => (String(url).startsWith('/users')
      ? {
          data: [{
            id: 7, nombre: 'Una gestora con un nombre bastante largo', role: 'gestor', active: true,
            email: 'una.direccion.de.correo.muy.larga.para.probar@ejemplo-de-campus.com',
          }],
        }
      : { data: [] })),
    post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(),
  },
}));

import SettingsPage from '@/shared/pages/SettingsPage';

afterEach(cleanup);

describe('Configuración → Usuarios no se sale por la derecha (#202)', () => {
  it('la tabla se desplaza dentro de su caja y las acciones no se parten', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    const editar = await screen.findByRole('button', { name: 'Editar' });

    const tabla = editar.closest('table');
    expect(tabla).toBeTruthy();
    const caja = tabla.parentElement;
    expect(caja.className).toContain('overflow-x-auto');
    expect(caja.className).not.toContain('overflow-hidden');
    expect(tabla.className).toMatch(/min-w-\[/);

    expect(editar.closest('td').className).toContain('whitespace-nowrap');

    const invitar = screen.getByRole('button', { name: /Invitar usuario/ });
    expect(invitar.className).toContain('flex-shrink-0');
    expect(invitar.className).toContain('whitespace-nowrap');
  });
});
