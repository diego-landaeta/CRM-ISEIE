// @vitest-environment jsdom
// Traída de MultiCRM. ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';

despuesDeCada(limpiar);
if (typeof window !== 'undefined') {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
}
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * #517 (gemela de MultiCRM #850) · El bloque «Plugin del CRM» de Integraciones › Campus (Moodle), en producción.
 *
 * Antes lo decidía una constante de compilación (SOLO_EN_PRUEBAS): en producción no salía
 * nunca sin cambiar el código y recompilar. Ahora lo dice el servidor con
 * `user.funciones.plugin_moodle` de `/auth/me` (PLUGIN_MOODLE_EN_PRODUCCION=1 en su `.env`).
 *
 * Aquí se compila «como producción» (SOLO_EN_PRUEBAS = false) y se cambia solo lo que dice
 * el servidor:
 *   · apagado (o sin decir nada, como hoy): ni el bloque ni la petición de su estado;
 *   · encendido: el bloque sale, con «Conectar campus».
 *
 *   npx vitest run src/__smoke__/pluginMoodleDelServidor850.test.jsx
 */

vi.mock('@/shared/lib/enPruebas', () => ({ SOLO_EN_PRUEBAS: false, PROCESO_EN_PRUEBAS: false }));
const sesion = vi.hoisted(() => ({ user: null }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: sesion.user, permissions: null }) }));
const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, put: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true }) }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 1, nombre: 'ISSLOGG', type: 'crm' }, isAllProjects: false, activeIssuerId: null }),
}));

const { default: IntegrationsPage } = await import('@/modules/accounting/pages/IntegrationsPage');
const { pluginMoodleEncendido } = await import('@/shared/lib/pluginMoodle');

const RUTA_ESTADO = '/consultas/campus/1/plugin';
const SIN_CONECTAR = {
  configurado: false, activo: false, ultimo_aviso_at: null, clave_desde: null, ruta: '/api/moodle-avisos/1',
};

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url) => {
    if (url === RUTA_ESTADO) return { success: true, data: SIN_CONECTAR };
    if (url.startsWith('/integrations/moodle')) return { success: true, data: { provider: 'moodle', active: true, has_secret: true, config_public: {} } };
    return { success: true, data: null };
  });
});

async function abrirIntegraciones() {
  render(<IntegrationsPage />);
  // La tarjeta de Moodle ya ha pedido su conexión: lo de abajo es ya su estado final.
  await waitFor(() => expect(get).toHaveBeenCalledWith('/integrations/moodle?projectId=1'));
  await screen.findByText('Campus (Moodle)');
}

describe('el interruptor del plugin del CRM, leído del servidor (#850)', () => {
  it('compilado como producción y el servidor sin decir nada (la producción de hoy): no sale el bloque', async () => {
    sesion.user = { id: 1, role: 'superadmin' };
    await abrirIntegraciones();
    expect(screen.queryByTestId('plugin-del-crm')).toBeNull();
    expect(screen.queryByText('O, sin el plugin, a mano:')).toBeNull();
    expect(get).not.toHaveBeenCalledWith(RUTA_ESTADO);
  });

  it('compilado como producción y el servidor apagado (funciones.plugin_moodle: false): no sale el bloque', async () => {
    sesion.user = { id: 1, role: 'superadmin', funciones: { plugin_moodle: false } };
    await abrirIntegraciones();
    expect(screen.queryByTestId('plugin-del-crm')).toBeNull();
    expect(get).not.toHaveBeenCalledWith(RUTA_ESTADO);
  });

  it('compilado como producción y el servidor encendido (funciones.plugin_moodle: true): sale, con «Conectar campus»', async () => {
    sesion.user = { id: 1, role: 'superadmin', funciones: { plugin_moodle: true } };
    await abrirIntegraciones();
    const bloque = await screen.findByTestId('plugin-del-crm');
    expect(bloque.textContent).toContain('Plugin del CRM');
    expect(bloque.textContent).toContain('Sin conectar');
    expect(screen.getByRole('button', { name: /Conectar campus/ })).toBeTruthy();
    expect(screen.getByText('O, sin el plugin, a mano:')).toBeTruthy();
    expect(get).toHaveBeenCalledWith(RUTA_ESTADO);
  });

  it('pluginMoodleEncendido: compilado como producción, solo con un true del servidor', () => {
    expect(pluginMoodleEncendido(undefined)).toBe(false);
    expect(pluginMoodleEncendido(null)).toBe(false);
    expect(pluginMoodleEncendido(false)).toBe(false);
    expect(pluginMoodleEncendido(true)).toBe(true);
  });
});
