// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  (Base copiada de tableroUnico.test.jsx.) Un solo tablero (Diego, 27/10/2026): «Esto tiene que tener fecha de cuándo se
  creó y cuándo se terminó, y clasificarla en vistas por día, semana y mes, PERO
  QUE SEA UN SOLO TABLERO TODO Y YA CON FILTROS, NO MÚLTIPLES TABLEROS.»

  Cuatro columnas con todas las tareas, sin un bloque de columnas por persona;
  los filtros en una fila, combinables, con los activos a la vista y «Quitar
  filtros»; y en la tarjeta, «Creada …» y, si está hecha, «Terminada …».
*/

const { api, yo } = vi.hoisted(() => ({
  api: {
    getTasks: vi.fn(),
  },
  // Quien mira: superadmin salvo en las pruebas que lo cambian.
  yo: { id: 1, nombre: 'Diego', role: 'superadmin', roles_extra: [] },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: yo }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ projects: [], activeIssuerId: null, activeProject: null }) }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true }) }));
vi.mock('@/shared/components/ui/RecorridoGuiado', () => ({ default: () => <div data-testid="recorrido" />, recorridoPendiente: () => true }));
vi.mock('@/modules/tasks/api/tasks.api', () => ({
  getTasks: (...a) => api.getTasks(...a),
  getReviewTasks: vi.fn(async () => []),
  getReviewCount: vi.fn(async () => ({ count: 0 })),
  getAreas: vi.fn(async () => []),
  getExternalProjects: vi.fn(async () => []),
  getColumns: vi.fn(async () => []),
  getAssignees: vi.fn(async () => [
    { id: 1, nombre: 'Diego', email: 'd@x', role: 'superadmin' },
    { id: 2, nombre: 'Ruth Sánchez', email: 'r@x', role: 'colaborador' },
    { id: 3, nombre: 'Emmanuel Lozada', email: 'e@x', role: 'colaborador' },
  ]),
  getTeams: vi.fn(async () => []),
  getMyTeams: vi.fn(async () => []),
  getTagNames: vi.fn(async () => []),
  getTeamMetrics: vi.fn(async () => []),
  getTeamMetricsByArea: vi.fn(async () => []),
  getTaskById: vi.fn(async () => ({ id: 5, title: 'Abierta', status: 'por_hacer', priority: 'media', assigned_to: 1, created_by: 1, created_at: '2026-10-27T10:00:00Z',
    updated_at: '2026-10-27T10:00:00Z', tags: [], checklist: [], comments: [], links: [], events: [], permisos: { mover: true, comentar: true, revisar: false, cerrar: false, editar: true, delegar: false } })),
}));

const { default: TasksPage } = await import('@/modules/tasks/pages/TasksPage');

/*
  27/10/2026, urgente: «no deja guardar tareas a ninguno». El recorrido guiado se
  abría solo a los 0,8 s de entrar y su capa (fixed inset-0, z-90) quedaba encima de
  la ficha: el clic en «Crear tarea» no llegaba. Con una ficha abierta, no se abre.
*/
beforeEach(() => {
  api.getTasks.mockReset();
  api.getTasks.mockResolvedValue([]);
});
afterEach(() => cleanup());

const abrirEn = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><TasksPage /></MemoryRouter>);

describe('el recorrido guiado no tapa la ficha', () => {
  it('sin ficha abierta, la primera vez sale solo', async () => {
    abrirEn('/tareas');
    expect(await screen.findByTestId('recorrido', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('con la ficha de una tarea abierta, no sale', async () => {
    abrirEn('/tareas?id=5');
    await new Promise((r) => setTimeout(r, 1500));
    expect(screen.queryByTestId('recorrido')).toBeNull();
  });

  it('si estaba abierto y se abre «Nueva tarea», se cierra', async () => {
    abrirEn('/tareas');
    await screen.findByTestId('recorrido', {}, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Nueva/ })[0]);
    await waitFor(() => expect(screen.queryByTestId('recorrido')).toBeNull());
  });
});
