// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  CRM-ISEIE#419 (Diego y Carlos, 10/11/2026): quien hace la tarea la pasa a «Hecha»
  él mismo, sin pasar por «En revisión»; las de programación las manda a revisar
  y las cierra su supervisor. «Por revisar» pasa a «Historial de tareas».
*/

const api = vi.hoisted(() => ({ tarea: null, historial: [] }));
vi.mock('@/modules/tasks/api/tasks.api', () => ({
  getTaskById: vi.fn(async () => api.tarea),
  getAssignees: vi.fn(async () => []),
  getTeams: vi.fn(async () => [{ id: 3, name: 'Desarrollo y SEO', is_active: true }]),
  moveTask: vi.fn(async () => ({})),
  approveTask: vi.fn(async () => ({})),
  returnTask: vi.fn(async () => ({})),
  getHistorial: vi.fn(async () => ({
    filas: api.historial, paginacion: { total: api.historial.length, page: 1, limit: 50, totalPages: 1 },
  })),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 20, nombre: 'Diana', role: 'colaborador' } }) }));
vi.mock('@/shared/hooks/usePermission', () => ({
  default: () => ({ can: (k) => ['tasks.view_own', 'tasks.create', 'tasks.edit'].includes(k) }),
}));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const tasksApi = await import('@/modules/tasks/api/tasks.api');
const { TaskModal } = await import('@/modules/tasks/components/TaskModal');
const { default: TasksHistoryPage } = await import('@/modules/tasks/pages/TasksHistoryPage');
const { NAV_SECTIONS } = await import('@/shared/components/layout/Sidebar');

const base = {
  id: 7, title: 'Maquetar la home', description: null, status: 'en_curso', position: 1000, priority: 'media',
  due_date: null, project_id: null, external_project_id: null, area_id: null, assigned_to: 20, assigned_to_name: 'Diana',
  supervisor_id: 30, supervisor_name: 'Ángel', created_by: 10, completed_at: null, archived_at: null,
  created_at: '2026-10-26T10:00:00Z', updated_at: '2026-10-26T10:00:00Z', tags: [],
  team_id: 3, team_name: 'SEO', team_color: 'blue', assigned_cargo: 'Miembro', de_programacion: false,
};
const PERMISOS = { mover: true, comentar: true, revisar: false, cerrar: false, devolver: false, editar: false, delegar: false };
const noop = () => {};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function abrir(extra = {}, permisos = {}) {
  api.tarea = { ...base, ...extra, checklist: [], comments: [], links: [], events: [], permisos: { ...PERMISOS, ...permisos } };
  render(
    <MemoryRouter>
      <TaskModal open taskId={7} onClose={noop} onChanged={noop} currentUserId={20} canAssign={false} canArchiveAny={false}
        assignees={[]} projects={[]} columns={[{ key: 'en_curso', name: 'En curso', is_active: true }]} />
    </MemoryRouter>
  );
}

describe('la ficha: el botón de «Hecha» para quien la lleva', () => {
  it('quien la lleva (y puede cerrarla) ve «Hecha», y la pasa a «Hecha» sin pasar por revisión', async () => {
    abrir({}, { cerrar: true, revisar: true });
    const boton = await screen.findByRole('button', { name: /^Hecha$/ });
    fireEvent.click(boton);
    await waitFor(() => expect(tasksApi.moveTask).toHaveBeenCalledWith(7, { status: 'hecha' }));
    expect(screen.queryByRole('button', { name: /Mandar a revisar/ })).toBeNull();
  });

  it('programación: quien la lleva no ve «Hecha», sino «Mandar a revisar»', async () => {
    abrir({ de_programacion: true }, { cerrar: false });
    const boton = await screen.findByRole('button', { name: /Mandar a revisar/ });
    expect(screen.queryByRole('button', { name: /^Hecha$/ })).toBeNull();
    fireEvent.click(boton);
    await waitFor(() => expect(tasksApi.moveTask).toHaveBeenCalledWith(7, { status: 'en_revision' }));
  });

  it('quien no la puede cerrar ni mover no ve ningún botón de cierre', async () => {
    abrir({}, { mover: false, comentar: false });
    await screen.findAllByText(/Solo el responsable, el supervisor o un superadmin/);
    expect(screen.queryByRole('button', { name: /^Hecha$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mandar a revisar/ })).toBeNull();
  });

  it('una hecha: quien la creó (o un admin) ve «Devolver»; quien no, no', async () => {
    abrir({ status: 'hecha', completed_at: '2026-11-10T10:00:00Z' }, { devolver: true });
    expect(await screen.findByRole('button', { name: /Devolver/ })).toBeTruthy();
    cleanup();
    abrir({ status: 'hecha', completed_at: '2026-11-10T10:00:00Z' }, { devolver: false });
    await screen.findByText('Terminada');
    expect(screen.queryByRole('button', { name: /Devolver/ })).toBeNull();
  });
});

describe('el menú: «Historial de tareas» en lugar de «Por revisar»', () => {
  const entradas = NAV_SECTIONS.flatMap((s) => s.items);
  it('sale «Historial de tareas» con «Ver su tablero», y «Por revisar» ya no está', () => {
    const h = entradas.find((i) => i.to === '/tareas/historial');
    expect(h?.label).toBe('Historial de tareas');
    expect(h?.permiso).toBe('tasks.view_own');
    expect(entradas.find((i) => i.to === '/tareas/revisar')).toBeUndefined();
    expect(entradas.some((i) => /Por revisar/.test(i.label || ''))).toBe(false);
  });
});

describe('la página del historial', () => {
  it('lista lo hecho con quién lo hizo, quién lo cerró y cuándo', async () => {
    api.historial = [{
      id: 11, title: 'Endpoint de facturas', assigned_to: 21, assigned_to_name: 'Diana', created_by: 10, created_by_name: 'Julián',
      supervisor_id: 30, supervisor_name: 'Diego', completed_by: 30, completed_by_name: 'Diego',
      completed_at: '2026-11-09T15:30:00Z', created_at: '2026-11-01T10:00:00Z', due_date: null,
      team_id: 3, team_name: 'Desarrollo y SEO', de_programacion: true,
      project_name: null, external_project_name: null, area_name: null, area_color: null,
    }];
    render(<MemoryRouter><TasksHistoryPage /></MemoryRouter>);
    expect(await screen.findByText('Endpoint de facturas')).toBeTruthy();
    expect(screen.getByText('La hizo')).toBeTruthy();
    expect(screen.getByText('La cerró')).toBeTruthy();
    expect(screen.getByText('Programación')).toBeTruthy();
    expect(screen.getAllByText(/Diego/).length).toBeGreaterThan(0);
    // Pide el mes en curso con el alcance del tablero.
    const pedido = tasksApi.getHistorial.mock.calls[0][0];
    expect(pedido).toMatchObject({ ver: 'mias', page: 1 });
    expect(pedido.desde).toMatch(/^\d{4}-\d{2}-01$/);
    // Ni rastro de una bandeja de aprobar.
    expect(screen.queryByText(/Aprobar/)).toBeNull();
  });
});
