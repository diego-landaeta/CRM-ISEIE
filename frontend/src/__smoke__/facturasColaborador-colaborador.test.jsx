// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * #202 · un usuario que solo es colaborador entra en «Mi factura».
 *
 * El tablero (#210) le recorta al colaborador lo que puede abrir: en el frontal,
 * ProtectedRoute lo devuelve a su tablero desde cualquier otra pantalla; en el
 * servidor, `verifyToken` (su prueba, en backend/tests/facturasColaboradorMias).
 * «Mi factura» tiene que estar en las dos listas, y en el menú: si no, el
 * colaborador nunca llega a subir su factura. La página pública del enlace
 * (/factura-colaborador/:token) va fuera de ProtectedRoute: no lleva sesión.
 */

const { sesion } = vi.hoisted(() => ({ sesion: { value: null } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => sesion.value }));

import ProtectedRoute from '@/shared/components/layout/ProtectedRoute';
import { NAV_SECTIONS } from '@/shared/components/layout/Sidebar';

const COLABORADOR = { isAuthenticated: true, loading: false, user: { id: 4, role: 'colaborador', roles_extra: [] } };

function abrir(ruta) {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/mi-factura" element={<ProtectedRoute><p>Pantalla de Mi factura</p></ProtectedRoute>} />
        <Route path="/accounting/facturas-colaboradores" element={<ProtectedRoute><p>Administración</p></ProtectedRoute>} />
        <Route path="/tareas" element={<p>Su tablero</p>} />
        <Route path="/preferencias" element={<p>Sus preferencias</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('el colaborador y «Mi factura»', () => {
  it('ProtectedRoute le deja entrar en /mi-factura', () => {
    sesion.value = COLABORADOR;
    abrir('/mi-factura');
    expect(screen.getByText('Pantalla de Mi factura')).toBeTruthy();
  });

  it('a lo de administración, no: vuelve a su tablero', () => {
    sesion.value = COLABORADOR;
    abrir('/accounting/facturas-colaboradores');
    expect(screen.queryByText('Administración')).toBeNull();
    expect(screen.getByText('Su tablero')).toBeTruthy();
  });

  it('«Mi factura» está en su menú (colaborador y tutor redactor)', () => {
    const entradas = NAV_SECTIONS.flatMap((s) => s.items);
    const mia = entradas.find((e) => e.to === '/mi-factura');
    expect(mia).toBeTruthy();
    // Desde el 11/11 también el tutor redactor sube su factura del mes (#420).
    expect(mia.roles).toEqual(['colaborador', 'tutor_redactor']);
    // Y lo de administración no lleva el rol colaborador.
    expect(entradas.find((e) => e.to === '/accounting/facturas-colaboradores').roles).not.toContain('colaborador');
  });
});
