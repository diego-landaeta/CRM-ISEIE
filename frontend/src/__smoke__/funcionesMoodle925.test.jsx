// @vitest-environment jsdom
// Gemela de la de MultiCRM (CRM#925). ISEIE no tiene un setup común de pruebas: el
// entorno y la limpieza entre pruebas se ponen aquí.
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';

despuesDeCada(limpiar);
if (typeof window !== 'undefined') {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
}
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

/**
 * #517 (gemela de CRM#925) · Integraciones › Campus (Moodle): las 12 funciones.
 *
 *   · el tutorial lista las 12, por grupo, y el paso «Puede descargar archivos»;
 *   · si la última prueba dice que al servicio le faltan funciones, la tarjeta no
 *     sale en verde («Faltan funciones») y dice cuáles, por grupo;
 *   · las de Consultas no cuentan con «Leer las consultas» apagado;
 *   · «Probar conexión» con aviso no dice «✓ Conexión OK».
 *
 *   npx vitest run src/__smoke__/funcionesMoodle925.test.jsx
 */

vi.mock('@/shared/lib/enPruebas', () => ({ SOLO_EN_PRUEBAS: false, PROCESO_EN_PRUEBAS: false }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'superadmin' }, permissions: null }) }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), moodle: null }));
vi.mock('@/shared/api/client', () => ({ default: { get: api.get, put: vi.fn(), post: api.post, delete: vi.fn() } }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/shared/hooks/useToast', () => ({ toast }));
vi.mock('@/shared/components/ui/useConfirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => false }) }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 3, nombre: 'FONO', type: 'crm' }, isAllProjects: false, activeIssuerId: null }),
}));

const { default: IntegrationsPage } = await import('@/modules/accounting/pages/IntegrationsPage');

const MI_CAMPUS = [
  'core_enrol_get_users_courses', 'core_enrol_get_enrolled_users',
  'mod_assign_get_assignments', 'mod_assign_get_submissions', 'mod_assign_get_grades', 'core_course_get_contents',
];
const LAS_12 = [
  'core_webservice_get_site_info', 'core_user_get_users_by_field', ...MI_CAMPUS,
  'core_message_get_conversations', 'core_message_get_conversation_messages',
  'gradereport_user_get_grade_items', 'core_course_get_courses_by_field',
];

const grupos = (faltan = {}) => [
  { clave: 'base', titulo: 'Conexión', total: 2, faltan: faltan.base || [] },
  { clave: 'mi_campus', titulo: 'Mi campus', total: 6, faltan: faltan.mi_campus || [] },
  { clave: 'consultas', titulo: 'Consultas', total: 2, faltan: faltan.consultas || [] },
  { clave: 'notas', titulo: 'Notas y avisos', total: 2, faltan: faltan.notas || [] },
];

const moodle = (config = {}, extra = {}) => ({
  provider: 'moodle', active: true, has_secret: true, secret_preview: 'abcd…wxyz',
  config_public: { url: 'https://campus.fono.example', ...config },
  last_test_status: 'success', last_test_message: 'Conexión OK con Campus FONO.', last_test_at: '2026-11-19T10:00:00Z',
  ...extra,
});

beforeEach(() => {
  toast.mockReset();
  api.post.mockReset();
  api.get.mockReset();
  api.get.mockImplementation(async (url) => {
    if (url.startsWith('/integrations/moodle')) return { success: true, data: api.moodle };
    return { success: true, data: null };
  });
});

async function tarjetaMoodle() {
  render(<IntegrationsPage />);
  const titulo = await screen.findByText('Campus (Moodle)');
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/integrations/moodle?projectId=3'));
  // La tarjeta entera: el contenedor con borde que tiene el título.
  return titulo.closest('.rounded-lg');
}

describe('#925 · el tutorial del campus', () => {
  it('lista las 12 funciones, por grupo, y el paso «Puede descargar archivos»', async () => {
    api.moodle = moodle();
    const tarjeta = await tarjetaMoodle();
    fireEvent.click(within(tarjeta).getByRole('button', { name: /Cómo obtener el token del campus/ }));
    const lista = await screen.findByTestId('moodle-funciones-tutorial');
    const codigos = [...lista.querySelectorAll('code')].map((c) => c.textContent);
    expect(codigos).toHaveLength(12);
    expect(codigos.sort()).toEqual([...LAS_12].sort());
    for (const g of ['Conexión', 'Mi campus', 'Consultas', 'Notas y avisos']) expect(lista.textContent).toContain(g);
    expect(tarjeta.textContent).toMatch(/estas 12/);
    expect(tarjeta.textContent).toMatch(/marca «Puede descargar archivos»/);
  });
});

describe('#925 · lo que dijo la última prueba', () => {
  it('faltan las de Mi campus: «Faltan funciones» (no «Conectado») y dice cuáles', async () => {
    api.moodle = moodle({ funciones: { grupos: grupos({ mi_campus: MI_CAMPUS, consultas: ['core_message_get_conversations', 'core_message_get_conversation_messages'] }), descargas: false } });
    const tarjeta = await tarjetaMoodle();
    expect(within(tarjeta).getByText('Faltan funciones')).toBeTruthy();
    expect(within(tarjeta).queryByText('Conectado')).toBeNull();
    const panel = within(tarjeta).getByTestId('moodle-funciones');
    const mi = panel.querySelector('[data-grupo="mi_campus"]');
    expect(mi.textContent).toContain('faltan 6 de 6');
    for (const f of MI_CAMPUS) expect(mi.textContent).toContain(f);
    expect(panel.querySelector('[data-grupo="base"]').textContent).toContain('2 de 2');
    // «Leer las consultas» apagado: se dicen, pero no hacen falta.
    expect(panel.querySelector('[data-grupo="consultas"]').textContent).toContain('no hacen falta');
    expect(panel.querySelector('[data-grupo="descargas"]').textContent).toContain('sin marcar');
  });

  it('solo faltan las de Consultas y «Leer las consultas» apagado: Conectado', async () => {
    api.moodle = moodle({ funciones: { grupos: grupos({ consultas: ['core_message_get_conversations'] }), descargas: true } });
    const tarjeta = await tarjetaMoodle();
    expect(within(tarjeta).getByText('Conectado')).toBeTruthy();
    expect(within(tarjeta).queryByText('Faltan funciones')).toBeNull();
  });

  it('una prueba anterior al cambio (sin la lista): Conectado y sin panel, no se inventa nada', async () => {
    api.moodle = moodle();
    const tarjeta = await tarjetaMoodle();
    expect(within(tarjeta).getByText('Conectado')).toBeTruthy();
    expect(within(tarjeta).queryByTestId('moodle-funciones')).toBeNull();
  });

  it('«Probar conexión» con aviso no dice «✓ Conexión OK»', async () => {
    api.moodle = moodle();
    api.post.mockResolvedValue({ success: true, data: { ok: true, aviso: true, message: 'Conecta con Campus FONO, pero…' } });
    const tarjeta = await tarjetaMoodle();
    fireEvent.click(within(tarjeta).getByRole('button', { name: /Probar conexión/ }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Conecta, pero faltan funciones' }));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: '✓ Conexión OK' }));
  });
});
