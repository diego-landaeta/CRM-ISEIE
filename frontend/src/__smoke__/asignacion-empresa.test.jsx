// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * CRM#513 · Asignación de leads, «por empresa y campus» (Diego, 28/10).
 *
 * En MultiCRM la pantalla sigue a la empresa o al campus de la cabecera (su prueba
 * es asignacion-empresa.test.jsx). ISEIE no tiene empresa en la cabecera y el
 * campus activo siempre está puesto: la pantalla enseña lo de ese campus. Si un día
 * la cabecera trae la empresa (`activeIssuerId`), la sigue, como en MultiCRM.
 */

const { cabecera, get } = vi.hoisted(() => ({ cabecera: { value: {} }, get: vi.fn() }));

const PROYECTOS = [
  { id: 10, nombre: 'ISEIE', sociedad_emisora_id: 3, sociedad_nombre: 'ISEIE SL' },
  { id: 11, nombre: 'Otro campus', sociedad_emisora_id: 4, sociedad_nombre: 'Otra' },
];
const config = (id, ambito, extra) => ({
  id, nombre: `Config ${id}`, activo: true, ambito, issuer_id: null, project_id: null, empresa: null, proyecto: null, ventana_min: 15,
  escenario1: { tipo: 'mailhook', cola: 'aaa' }, escenario2: { tipo: 'webhook', cola: 'bbb' }, clave_cola: 'ccc',
  created_at: '2026-10-28T10:00:00Z', updated_at: '2026-10-28T10:00:00Z', ultima_decision_at: null, fallidos_30_dias: 0, ...extra,
});
const CONFIGS = [config(1, 'campus', { project_id: 10, proyecto: 'ISEIE' }), config(2, 'campus', { project_id: 11, proyecto: 'Otro campus' })];

vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => cabecera.value }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'superadmin' }, projects: PROYECTOS }) }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true }) }));
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() }, API_BASE_URL: '/api' }));

import AsignacionLeadsPage, { vistaDeCabecera, configEnVista } from '@/modules/asignacion/pages/AsignacionLeadsPage';

const pedidoDeDecisiones = () => {
  const url = get.mock.calls.map((c) => c[0]).filter((u) => u.startsWith('/asignacion/decisiones')).at(-1);
  return new URLSearchParams(url.split('?')[1]);
};

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((url) => Promise.resolve({ success: true, data: url === '/asignacion' ? CONFIGS : [] }));
});
afterEach(cleanup);

describe('lo que se ve sigue a la cabecera', () => {
  it('con el campus puesto: ese campus; con una empresa (si un día la hay): sus campus', () => {
    expect(vistaDeCabecera({ activeProject: { id: 10 } }, PROYECTOS)).toMatchObject({ tipo: 'campus', campus: { id: 10 } });
    const e = vistaDeCabecera({ activeIssuerId: 3, activeIssuer: { nombre: 'ISEIE SL' } }, PROYECTOS);
    expect(e.campus.map((p) => p.id)).toEqual([10]);
    expect(CONFIGS.filter((c) => configEnVista(c, e)).map((c) => c.id)).toEqual([1]);
  });
});

describe('la pantalla', () => {
  it('con el campus ISEIE: su configuración y sus decisiones', async () => {
    cabecera.value = { activeProject: { id: 10, nombre: 'ISEIE' } };
    render(<MemoryRouter initialEntries={['/conexion/asignacion-leads']}><AsignacionLeadsPage /></MemoryRouter>);
    expect(await screen.findByText('Config 1')).toBeTruthy();
    expect(screen.queryByText('Config 2')).toBeNull();
    await waitFor(() => expect(pedidoDeDecisiones().get('project_id')).toBe('10'));
    expect(pedidoDeDecisiones().get('issuer_id')).toBeNull();
  });
});
