// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  Gemela de CRM#960 (issue CRM#893) · En «APIs globales», que se vea qué clave
  usa la IA de verdad (la del campus, la global de la web o la del servidor),
  sin enseñar la clave.

  En ISEIE «APIs globales» es la sección `IntegrationsSection` de
  Configuración (en MultiCRM, `ApisTab`).
*/

const { api, toast } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() }, toast: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ default: { get: (...a) => api.get(...a), post: (...a) => api.post(...a), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: (...a) => toast(...a) }));
vi.mock('@/shared/components/ui/useConfirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'superadmin' }, permissions: {}, projects: [] }) }));

const { IntegrationsSection } = await import('@/shared/pages/SettingsPage');

const abrir = () => render(<MemoryRouter><IntegrationsSection isAdmin /></MemoryRouter>);

function servidor(ia) {
  api.get.mockImplementation(async (url) => {
    if (url === '/credentials') return { success: true, data: [] };
    if (url === '/credentials/ia') return { success: true, data: ia };
    return { success: true, data: null };
  });
}

beforeEach(() => { api.get.mockReset(); api.post.mockReset(); toast.mockReset(); });
afterEach(() => cleanup());

describe('APIs globales dice qué clave usa la IA', () => {
  it('la global de la web', async () => {
    servidor({ origen: 'global', texto: 'La IA usa la global de la web.' });
    abrir();
    const linea = await screen.findByRole('status');
    expect(linea).toHaveTextContent('La IA usa la global de la web.');
    expect(linea).toHaveAttribute('data-ia-en-uso', 'global');
    expect(linea.textContent).not.toMatch(/sk-/);
  });

  it('ninguna: lo dice en tono de aviso', async () => {
    servidor({ origen: null, texto: 'No hay ninguna clave de Claude: la IA no funciona.' });
    abrir();
    const linea = await screen.findByRole('status');
    expect(linea).toHaveAttribute('data-ia-en-uso', 'ninguna');
    expect(linea.className).toMatch(/warning/);
  });

  it('si el servidor no contesta, no se inventa nada', async () => {
    api.get.mockImplementation(async (url) => {
      if (url === '/credentials/ia') throw Object.assign(new Error('no'), { status: 403 });
      return { success: true, data: [] };
    });
    abrir();
    await screen.findByText('Anthropic Claude');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('«Test» dice cuándo falla', () => {
  it('una clave que Anthropic rechaza sale como fallo', async () => {
    api.get.mockImplementation(async (url) => {
      if (url === '/credentials') return { success: true, data: [{ id: 9, service: 'claude', project_id: null, masked_value: '••••abcd' }] };
      return { success: true, data: { origen: 'global', texto: 'La IA usa la global de la web.' } };
    });
    api.post.mockResolvedValue({ success: true, data: { result: 'failed', message: 'Anthropic rechaza la clave: no es válida o está revocada.' } });
    abrir();
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: /^Test$/ }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Test fallido', variant: 'destructive' }));
  });
});
