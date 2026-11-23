// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  Errores de producción del 23/11: `GET /tasks/assignees` contestaba 403
  FORBIDDEN («No tienes permiso para ver el equipo») a colaboradores y otros sin
  «ver el equipo». Lo pedía la ficha de tarea al abrir una con equipo, para
  cualquiera. Ahora solo lo pide quien el servidor deja (`listAssignees`): «Ver
  todas», «Asignar», «Gestionar el tablero», o quien delega en ese equipo.
*/

const api = vi.hoisted(() => ({ tarea: null }));
vi.mock('@/modules/tasks/api/tasks.api', () => ({
  getTaskById: vi.fn(async () => api.tarea),
  getAssignees: vi.fn(async () => []),
}));

const tasksApi = await import('@/modules/tasks/api/tasks.api');
const { TaskModal } = await import('@/modules/tasks/components/TaskModal');
const { puedeVerElEquipo } = await import('@/modules/tasks/lib/verElEquipo');

const TAREA = {
  id: 7, title: 'Maquetar la home', description: null, status: 'en_curso', position: 1000, priority: 'media',
  due_date: null, project_id: null, external_project_id: null, area_id: null, assigned_to: 20, assigned_to_name: 'Diana',
  supervisor_id: null, supervisor_name: null, created_by: 20, completed_at: null, archived_at: null,
  created_at: '2026-11-23T10:00:00Z', updated_at: '2026-11-23T10:00:00Z', tags: [],
  team_id: 3, team_name: 'Desarrollo y SEO', team_color: 'blue', assigned_cargo: 'Miembro',
  checklist: [], comments: [], links: [], events: [],
  permisos: { mover: true, comentar: true, revisar: false, cerrar: true, editar: true, delegar: false },
};
const noop = () => {};

function abrir(props = {}) {
  render(
    <MemoryRouter>
      <TaskModal open taskId={7} onClose={noop} onChanged={noop} currentUserId={20} canAssign={false} canArchiveAny={false}
        assignees={[]} projects={[]} columns={[{ key: 'en_curso', name: 'En curso', is_active: true }]} {...props} />
    </MemoryRouter>
  );
}
const pidioElEquipo = () => tasksApi.getAssignees.mock.calls.some(([o]) => o?.team_id === 3);

beforeEach(() => { api.tarea = TAREA; tasksApi.getAssignees.mockClear(); tasksApi.getTaskById.mockClear(); });
afterEach(() => cleanup());

describe('la regla, la misma que el servidor', () => {
  it('con «Ver todas», «Asignar» o «Gestionar el tablero», sí', () => {
    expect(puedeVerElEquipo({ viewAll: true })).toBe(true);
    expect(puedeVerElEquipo({ assign: true })).toBe(true);
    expect(puedeVerElEquipo({ manage: true })).toBe(true);
  });

  it('sin ellas, solo en un equipo donde delega', () => {
    expect(puedeVerElEquipo({}, [3, 5], 3)).toBe(true);
    expect(puedeVerElEquipo({}, [3, 5], '5')).toBe(true);
    expect(puedeVerElEquipo({}, [5], 3)).toBe(false);
    expect(puedeVerElEquipo({}, [], 3)).toBe(false);
    expect(puedeVerElEquipo({}, [3], null)).toBe(false);
  });
});

describe('la ficha de una tarea con equipo', () => {
  it('un colaborador sin «ver el equipo» no pide la gente del equipo', async () => {
    abrir({ misEquipos: [{ team_id: 3, team_name: 'Desarrollo y SEO', cargo: 'Miembro', nivel: 1, puede_delegar: false }] });
    // Ya cargada (el título en su caja): el equipo ya está puesto.
    await waitFor(() => expect(screen.queryByDisplayValue('Maquetar la home') || screen.queryAllByText('Maquetar la home')[0]).toBeTruthy());
    await new Promise((ok) => setTimeout(ok, 20));
    expect(tasksApi.getTaskById).toHaveBeenCalled();
    expect(pidioElEquipo()).toBe(false);
  });

  it('quien delega en ese equipo, sí', async () => {
    abrir({ misEquipos: [{ team_id: 3, team_name: 'Desarrollo y SEO', cargo: 'Encargado', nivel: 2, puede_delegar: true }] });
    await waitFor(() => expect(pidioElEquipo()).toBe(true));
  });

  it('con «Gestionar el tablero», sí', async () => {
    abrir({ canManage: true });
    await waitFor(() => expect(pidioElEquipo()).toBe(true));
  });
});
