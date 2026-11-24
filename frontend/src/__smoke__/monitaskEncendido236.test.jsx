// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * #236 (gemela de CRM#236) · Monitask en el frontal de PRODUCCIÓN, compilado «como producción»
 * (`SOLO_EN_PRUEBAS` = false).
 *
 *   · «Equipo › Actividad» iba detrás de SOLO_EN_PRUEBAS: en /crm no salía nunca,
 *     aunque el servidor tuviera MONITASK_ACTIVO=1. Ahora manda el servidor
 *     (`/auth/me` → `user.funciones.monitask`).
 *   · Con Monitask apagado, la tarjeta de Integraciones y la pantalla ya no piden
 *     /monitask/estado (contestaba 404 y llenaba el registro de «Peticion rechazada»).
 *   · La tarjeta enseña los avisos de la última sincronización (una persona que
 *     falla, o datos de Monitask que el CRM no sabe leer), que antes no se veían.
 */

vi.mock('@/shared/lib/enPruebas', async (importOriginal) => ({ ...(await importOriginal()), SOLO_EN_PRUEBAS: false }));
const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ can: (k) => permisos.mapa[k] === true }),
}));
const sesion = vi.hoisted(() => ({ user: null, permissions: null }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => sesion }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({}) }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'dark' }));

const { funcionEncendida } = await import('@/shared/lib/funcionesDelServidor');
const { NAV_SECTIONS, canSeeItem } = await import('@/shared/components/layout/Sidebar');
const { default: MonitaskCard } = await import('@/modules/monitask/components/MonitaskCard');
const { default: MonitaskActividadPage } = await import('@/modules/monitask/pages/MonitaskActividadPage');

function buscar(items, ruta) {
  for (const it of items || []) {
    if (it.to === ruta) return it;
    const hijo = buscar(it.children, ruta);
    if (hijo) return hijo;
  }
  return null;
}
const ACTIVIDAD = NAV_SECTIONS.map((s) => buscar(s.items, '/equipo/actividad')).find(Boolean);

const ESTADO = {
  activo: true, client_id: 'app-del-crm', tiene_secreto: true, secreto_cola: 'ab12', conectada: true,
  conectada_at: '2026-11-20T10:00:00Z', conectada_por: 'Diego', renueva_sola: true, access_caduca_at: null,
  margen_pct: 10, redirect_uri: 'https://crm.iseie.com/api/monitask/oauth/callback',
  ultima_sync_at: '2026-11-24T02:00:00Z', ultimo_error: null, ultimo_error_at: null, sincronizando: false,
  ultima_sync: {
    personas: 3, dias: 0, sin_actividad: false,
    errores: [
      { que: 'formato', error: 'Monitask devolvió 4 entradas de tiempo y el CRM no ha sabido leer ninguna. Campos que trae: desdeLas, hastaLas, id.' },
      { que: 'actividad persona 7', error: 'Monitask /activity/getByDateRange HTTP 500' },
    ],
  },
};

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async () => ({ success: true, data: ESTADO }));
  permisos.mapa = { 'monitask.view': true, 'monitask.configurar': true };
});

describe('qué dice el servidor', () => {
  it('lo que diga /auth/me; si no dice nada (servidor anterior), como antes: solo en pruebas', () => {
    expect(funcionEncendida({ funciones: { monitask: true } }, 'monitask')).toBe(true);
    expect(funcionEncendida({ funciones: { monitask: false } }, 'monitask')).toBe(false);
    expect(funcionEncendida({ funciones: { links_pago: true } }, 'monitask')).toBe(false);
    expect(funcionEncendida(null, 'monitask')).toBe(false);
  });
});

describe('el menú «Equipo › Actividad» en producción', () => {
  it('existe en el menú de producción y pide monitask.view y la función del servidor', () => {
    expect(ACTIVIDAD).toBeTruthy();
    expect(ACTIVIDAD.funcion).toBe('monitask');
    expect(ACTIVIDAD.permiso).toBe('monitask.view');
  });

  it('con MONITASK_ACTIVO encendido sale al superadmin; apagado, no', () => {
    const can = () => true;
    expect(canSeeItem(ACTIVIDAD, 'superadmin', false, { funciones: { monitask: true } }, can)).toBe(true);
    expect(canSeeItem(ACTIVIDAD, 'superadmin', false, { funciones: { monitask: false } }, can)).toBe(false);
  });

  it('encendido pero sin el permiso monitask.view: no sale', () => {
    const can = (k) => k !== 'monitask.view';
    expect(canSeeItem(ACTIVIDAD, 'admin', false, { funciones: { monitask: true } }, can)).toBe(false);
  });
});

describe('Integraciones › Monitask', () => {
  it('apagado en el servidor: no sale ni pregunta nada', () => {
    sesion.user = { id: 1, funciones: { monitask: false } };
    const { container } = render(<MemoryRouter><MonitaskCard /></MemoryRouter>);
    expect(container.textContent).toBe('');
    expect(get).not.toHaveBeenCalled();
  });

  it('encendido: enseña los avisos de la última sincronización, también el de formato', async () => {
    sesion.user = { id: 1, funciones: { monitask: true } };
    render(<MemoryRouter><MonitaskCard /></MemoryRouter>);
    expect(await screen.findByTestId('monitask-avisos')).toBeTruthy();
    expect(screen.getByText(/Avisos de la última sincronización \(2\)/)).toBeTruthy();
    expect(screen.getByText(/no ha sabido leer ninguna\. Campos que trae: desdeLas, hastaLas, id\./)).toBeTruthy();
    expect(screen.getByText(/actividad persona 7: Monitask \/activity\/getByDateRange HTTP 500/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/monitask/estado');
  });
});

describe('Equipo › Actividad', () => {
  it('apagado en el servidor: lo dice sin pedir /monitask/estado', async () => {
    sesion.user = { id: 1, funciones: { monitask: false } };
    render(<MemoryRouter><MonitaskActividadPage /></MemoryRouter>);
    expect(await screen.findByText(/Monitask no está encendido en este servidor/)).toBeTruthy();
    expect(get).not.toHaveBeenCalledWith('/monitask/estado');
  });
});
