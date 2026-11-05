// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  Gemela de la de MultiCRM. El tablero de tutores (Diego, 04/11/2026): quien lleva las colaboraciones de
  los profesores está en el equipo de colaboradores y en el de tutores, y ve los
  DOS tableros por separado, cada uno en su pestaña, con solo las tareas de ese
  equipo. Quien está en un solo equipo (un tutor) no ve pestañas.
*/

const { api, yo, permisos } = vi.hoisted(() => ({
  api: { getTasks: vi.fn(), getMyTeams: vi.fn(), getTeams: vi.fn() },
  yo: { id: 7, nombre: 'Colaboradora', role: 'colaborador', roles_extra: ['tutor'] },
  permisos: { ver_todo: false },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: yo }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ projects: [], activeIssuerId: null, activeProject: null }) }));
vi.mock('@/shared/hooks/usePermission', () => ({
  default: () => ({ can: (k) => (k === 'tasks.view_all' || k === 'tasks.assign' ? permisos.ver_todo : true) }),
}));
vi.mock('@/shared/components/ui/RecorridoGuiado', () => ({ default: () => null, recorridoPendiente: () => false }));
vi.mock('@/modules/tasks/api/tasks.api', () => ({
  getTasks: (...a) => api.getTasks(...a),
  getReviewTasks: vi.fn(async () => []),
  getReviewCount: vi.fn(async () => ({ count: 0 })),
  getAreas: vi.fn(async () => []),
  getExternalProjects: vi.fn(async () => []),
  getColumns: vi.fn(async () => []),
  getAssignees: vi.fn(async () => []),
  getTeams: (...a) => api.getTeams(...a),
  getMyTeams: (...a) => api.getMyTeams(...a),
  getTagNames: vi.fn(async () => []),
  getTeamMetrics: vi.fn(async () => []),
  getTeamMetricsByArea: vi.fn(async () => []),
  getTaskById: vi.fn(async () => null),
}));

const { default: TasksPage } = await import('@/modules/tasks/pages/TasksPage');

const EMPRESA = 'Empresa de prueba SL';
const DEV = { team_id: 11, team_name: 'Desarrollo y SEO', team_color: 'blue', team_tipo: 'colaboradores', issuer_id: 1, empresa: EMPRESA, team_role_id: 1, cargo: 'Miembro', nivel: 1, puede_delegar: false };
const TUT = { team_id: 22, team_name: 'Tutores', team_color: 'green', team_tipo: 'tutores', issuer_id: 1, empresa: EMPRESA, team_role_id: 2, cargo: 'Encargado', nivel: 2, puede_delegar: true };
const equipo = (m) => ({ id: m.team_id, issuer_id: 1, empresa: EMPRESA, name: m.team_name, tipo: m.team_tipo, color: m.team_color, is_active: true, sort_order: 0, miembros: 2, cargos: [] });

const tarea = (id, title, team_id) => ({
  id, title, description: null, status: 'por_hacer', position: id * 1000, priority: 'media', due_date: null,
  project_id: null, external_project_id: null, area_id: null, assigned_to: 7, assigned_to_name: 'Colaboradora',
  created_by: 7, completed_at: null, archived_at: null, created_at: '2026-11-04T10:00:00Z', updated_at: '2026-11-04T10:00:00Z',
  tags: [], team_id,
});

beforeEach(() => {
  permisos.ver_todo = false;
  api.getTasks.mockReset();
  // El servidor filtra por equipo: aquí, igual.
  api.getTasks.mockImplementation(async (q) => [tarea(1, 'Arreglar la web', 11), tarea(2, 'Revisar un temario', 22)]
    .filter((t) => q.team_id == null || t.team_id === q.team_id));
});
afterEach(() => cleanup());

const abrir = () => render(<MemoryRouter initialEntries={['/tareas']}><TasksPage /></MemoryRouter>);
// Las pestañas de equipo (el periodo también usa pestañas: Hoy, Esta semana…).
const deEquipos = async () => within(await screen.findByRole('tablist', { name: 'Equipos' })).getAllByRole('tab');
const ultimaPeticion = () => api.getTasks.mock.calls[api.getTasks.mock.calls.length - 1][0];

describe('«Mi tablero» con pestañas por equipo', () => {
  it('en dos equipos: una pestaña por equipo, cada una con solo sus tareas', async () => {
    api.getMyTeams.mockResolvedValue([DEV, TUT]);
    api.getTeams.mockResolvedValue([equipo(DEV), equipo(TUT)]);
    abrir();
    const pestanas = await deEquipos();
    expect(pestanas.map((p) => p.textContent)).toEqual(['Desarrollo y SEO', 'Tutores']);
    // La primera, elegida: solo lo de desarrollo.
    await screen.findByText('Arreglar la web');
    await waitFor(() => expect(ultimaPeticion().team_id).toBe(11));
    expect(screen.queryByText('Revisar un temario')).toBeNull();
    // Con pestañas no hay desplegable de equipo.
    expect(screen.queryByRole('combobox', { name: 'Equipo' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Tutores' }));
    await screen.findByText('Revisar un temario');
    expect(ultimaPeticion().team_id).toBe(22);
    expect(screen.queryByText('Arreglar la web')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Tutores' }).getAttribute('aria-selected')).toBe('true');
  });

  it('en un solo equipo (un tutor): sin pestañas', async () => {
    Object.assign(yo, { role: 'tutor', roles_extra: [] });
    api.getMyTeams.mockResolvedValue([TUT]);
    api.getTeams.mockResolvedValue([equipo(TUT)]);
    abrir();
    await screen.findByText('Revisar un temario');
    expect(screen.queryByRole('tablist', { name: 'Equipos' })).toBeNull();
    Object.assign(yo, { role: 'colaborador', roles_extra: ['tutor'] });
  });

  it('quien ve todo tiene además «Todos los equipos», sin filtrar', async () => {
    permisos.ver_todo = true;
    api.getMyTeams.mockResolvedValue([DEV, TUT]);
    api.getTeams.mockResolvedValue([equipo(DEV), equipo(TUT)]);
    abrir();
    const pestanas = await deEquipos();
    expect(pestanas.map((p) => p.textContent)).toEqual(['Todos los equipos', 'Desarrollo y SEO', 'Tutores']);
    await screen.findByText('Revisar un temario');
    expect(ultimaPeticion().team_id).toBeUndefined();
  });
});
