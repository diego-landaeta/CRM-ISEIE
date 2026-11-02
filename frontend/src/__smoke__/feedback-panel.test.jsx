// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Diego, 02/11: «el panel de feedback está fallando en producción».
 *
 * Abría en «Este mes»: el día 2 salía 0 enviados y 0 respondidos, como si no
 * funcionara. Ahora abre en «Desde siempre» (#242) y no manda fechas. En MultiCRM,
 * además, el muro de «Todos los proyectos» lo tapaba (su prueba es
 * feedback-panel.test.jsx); ISEIE no tiene ese muro.
 */

const { cabecera, get } = vi.hoisted(() => ({ cabecera: { value: {} }, get: vi.fn() }));

vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => cabecera.value }));
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn() }, API_BASE_URL: '/api' }));

import FeedbackPanelPage from '@/modules/feedback/pages/FeedbackPanelPage';

const PANEL = {
  totales: { enviados: 538, respondidos: 7, tasa: 1.3, en_revision: 0, bloqueados: 0, sin_correo: 0, fallidos: 0 },
  porMotivo: [{ clave: 'precio', n: 4 }], porDisparador: [], porCampus: [], porEmpresa: [], porGestora: [], porMes: [],
  motivos: [{ clave: 'precio', texto: 'El precio' }], disparadores: {}, preguntas: [],
};
const ultimoPedido = () => {
  const url = get.mock.calls.map((c) => c[0]).filter((u) => u.startsWith('/feedback/panel')).at(-1);
  return new URLSearchParams(url.split('?')[1] || '');
};

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ success: true, data: PANEL });
  cabecera.value = { activeProject: { id: 10, nombre: 'ISEIE' }, activeIssuerId: null, activeIssuer: null, projects: [] };
});
afterEach(cleanup);

describe('abre en «Desde siempre»', () => {
  it('con el campus de ISEIE: su projectId, sin fechas, y con las cifras de siempre', async () => {
    render(<MemoryRouter><FeedbackPanelPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('538')).toBeTruthy());
    expect(ultimoPedido().get('projectId')).toBe('10');
    expect(ultimoPedido().has('desde')).toBe(false);
    expect(screen.getByRole('button', { name: 'Desde siempre' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('«Este mes» pone las fechas y «Desde siempre» las quita', async () => {
    render(<MemoryRouter><FeedbackPanelPage /></MemoryRouter>);
    await waitFor(() => expect(get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Este mes' }));
    await waitFor(() => expect(ultimoPedido().has('desde')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Desde siempre' }));
    await waitFor(() => expect(ultimoPedido().has('desde')).toBe(false));
  });
});
