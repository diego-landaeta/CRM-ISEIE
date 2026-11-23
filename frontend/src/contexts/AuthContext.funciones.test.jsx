// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

/*
  Diego, 23/11/2026: en producción de ISEIE nadie veía «Links de pago» aunque el
  servidor los tuviera encendidos y la persona tuviera los permisos. El usuario de
  la sesión salía del refresh/login, que no trae `funciones`; /auth/me sí lo trae,
  pero de ahí solo se cogían los permisos. Ahora se suma al usuario.
*/
vi.mock('@/shared/api/client', () => ({
  default: {
    get: vi.fn(async (url) => (url === '/auth/me'
      ? { success: true, data: {
        user: { id: 93, role: 'admin', funciones: { links_pago: true, plugin_moodle: false }, lleva_equipo: false },
        permissions: { 'links_pago.crear': true }, alcance_comercial: null,
      } }
      : { success: true, data: {} })),
    post: vi.fn(),
  },
  setAccessToken: vi.fn(),
  setOnAuthFailure: vi.fn(),
  API_BASE_URL: '/api',
}));

const { AuthProvider, useAuth } = await import('./AuthContext.jsx');
const { linksPagoEncendidos } = await import('@/shared/lib/linksPago');

function Mira() {
  const { user } = useAuth();
  if (!user) return <p>sin sesión</p>;
  return <p>links:{String(linksPagoEncendidos(user))} rol:{user.role} funciones:{JSON.stringify(user.funciones ?? null)}</p>;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('la sesión lleva lo que el servidor tiene encendido', () => {
  it('tras /auth/me, user.funciones.links_pago llega y «Links de pago» se enciende', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { accessToken: 'tok', user: { id: 93, role: 'admin' }, projects: [{ id: 10 }] } }),
    })));
    render(<AuthProvider><Mira /></AuthProvider>);
    // Lo que importa: la sesión LLEVA `funciones` (sin ellas, en producción se apagaba).
    await waitFor(() => expect(screen.getByText(/funciones:\{"links_pago":true,"plugin_moodle":false\}/)).toBeTruthy());
    expect(screen.getByText(/links:true/)).toBeTruthy();
    expect(screen.getByText(/rol:admin/)).toBeTruthy();
  });
});
