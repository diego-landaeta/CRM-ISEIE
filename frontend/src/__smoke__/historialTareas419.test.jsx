// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  CRM-ISEIE#419 (Diego y Carlos, 10/11/2026): quien hace la tarea la pasa a «Hecha»
  él mismo, sin pasar por «En revisión». «Por revisar» pasa a «Historial de tareas».

  Diego, 11/11/2026: lo decide el SUPERVISOR, no el equipo. Con supervisor, quien
  la lleva solo la manda a revisar y la cierra su supervisor (nadie más, tampoco
  otro superadmin); sin supervisor, la cierra quien la lleva. La casilla «Equipo
  de programación» sale de «Gestionar equipos».
*/

const EQUIPO = {
  id: 3, issuer_id: 1, empresa: 'Empresa', name: 'Desarrollo y SEO', tipo: 'colaboradores', color: 'blue',
  is_active: true, sort_order: 0, miembros: 2,
  cargos: [{ id: 1, name: 'Encargado', level: 2, sort_order: 1, is_active: true }, { id: 2, name: 'Miembro', level: 1, sort_order: 2, is_active: true }],
};
const api = vi.hoisted(() => ({ tarea: null, historial: [], equipos: [], porPersona: [] }));
vi.mock('@/modules/tasks/api/tasks.api', () => ({
  getTaskById: vi.fn(async () => api.tarea),
  getAssignees: vi.fn(async () => []),
  getTeams: vi.fn(async () => api.equipos),
  getTeamEmpresas: vi.fn(async () => [{ id: 1, razon_social: 'Empresa' }]),
  getTeam: vi.fn(async () => ({ miembros: [] })),
  getTeamCandidates: vi.fn(async () => []),
  updateTeam: vi.fn(async () => ({})),
  moveTask: vi.fn(async () => ({})),
  approveTask: vi.fn(async () => ({})),
  returnTask: vi.fn(async () => ({})),
  getHistorial: vi.fn(async () => ({
    filas: api.historial, paginacion: { total: api.historial.length, page: 1, limit: 50, totalPages: 1 }, porPersona: api.porPersona,
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
const { EquiposConfig } = await import('@/modules/tasks/components/EquiposConfig');
const { ordenarFichas, alternarPersona } = await import('@/modules/tasks/lib/porIntegrante');

const base = {
  id: 7, title: 'Maquetar la home', description: null, status: 'en_curso', position: 1000, priority: 'media',
  due_date: null, project_id: null, external_project_id: null, area_id: null, assigned_to: 20, assigned_to_name: 'Diana',
  supervisor_id: 30, supervisor_name: 'Ángel', created_by: 10, completed_at: null, archived_at: null,
  created_at: '2026-10-26T10:00:00Z', updated_at: '2026-10-26T10:00:00Z', tags: [],
  team_id: 3, team_name: 'Desarrollo y SEO', team_color: 'blue', assigned_cargo: 'Miembro',
};
const COLUMNAS = [
  { key: 'por_hacer', name: 'Por hacer', is_active: true }, { key: 'en_curso', name: 'En curso', is_active: true },
  { key: 'en_revision', name: 'En revisión', is_active: true }, { key: 'hecha', name: 'Hecha', is_active: true },
];
const PERMISOS = { mover: true, comentar: true, revisar: false, cerrar: false, devolver: false, editar: false, delegar: false };
const noop = () => {};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function abrir(extra = {}, permisos = {}, { sinPermisos = false, columnas = [{ key: 'en_curso', name: 'En curso', is_active: true }] } = {}) {
  api.tarea = { ...base, ...extra, checklist: [], comments: [], links: [], events: [], ...(sinPermisos ? {} : { permisos: { ...PERMISOS, ...permisos } }) };
  render(
    <MemoryRouter>
      <TaskModal open taskId={7} onClose={noop} onChanged={noop} currentUserId={20} canAssign={false} canArchiveAny={false}
        assignees={[]} projects={[]} columns={columnas} />
    </MemoryRouter>
  );
}

describe('la ficha: el botón de «Hecha» para quien la lleva', () => {
  it('sin supervisor: quien la lleva (y puede cerrarla) ve «Hecha», y la pasa a «Hecha» sin pasar por revisión', async () => {
    abrir({ supervisor_id: null, supervisor_name: null }, { cerrar: true, revisar: true });
    const boton = await screen.findByRole('button', { name: /^Hecha$/ });
    fireEvent.click(boton);
    await waitFor(() => expect(tasksApi.moveTask).toHaveBeenCalledWith(7, { status: 'hecha' }));
    expect(screen.queryByRole('button', { name: /Mandar a revisar/ })).toBeNull();
  });

  it('con supervisor: quien la lleva no ve «Hecha», sino «Mandar a revisar» (sea del equipo que sea)', async () => {
    abrir({}, { cerrar: false });
    const boton = await screen.findByRole('button', { name: /Mandar a revisar/ });
    expect(screen.queryByRole('button', { name: /^Hecha$/ })).toBeNull();
    fireEvent.click(boton);
    await waitFor(() => expect(tasksApi.moveTask).toHaveBeenCalledWith(7, { status: 'en_revision' }));
  });

  it('sin el dato del servidor, la ficha decide igual: con supervisor, quien la lleva no la cierra', async () => {
    abrir({}, {}, { sinPermisos: true });
    expect(await screen.findByRole('button', { name: /Mandar a revisar/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Hecha$/ })).toBeNull();
    cleanup();
    abrir({ supervisor_id: null, supervisor_name: null }, {}, { sinPermisos: true });
    expect(await screen.findByRole('button', { name: /^Hecha$/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Mandar a revisar/ })).toBeNull();
  });

  it('«En revisión»: su supervisor ve «Aprobar»; otro superadmin (sin «cerrar») no ve cómo cerrarla', async () => {
    abrir({ status: 'en_revision', assigned_to: 21, assigned_to_name: 'Dev', supervisor_id: 20 }, { cerrar: true, revisar: true });
    const aprobar = await screen.findByRole('button', { name: /Aprobar/ });
    fireEvent.click(aprobar);
    await waitFor(() => expect(tasksApi.approveTask).toHaveBeenCalledWith(7));
    cleanup();
    abrir({ status: 'en_revision', assigned_to: 21, assigned_to_name: 'Dev', supervisor_id: 30 }, { cerrar: false, revisar: false, mover: true, devolver: true });
    await screen.findByRole('button', { name: /Devolver/ });
    expect(screen.queryByRole('button', { name: /Aprobar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Hecha$/ })).toBeNull();
  });

  it('quien no la puede cerrar ni mover no ve ningún botón de cierre', async () => {
    abrir({}, { mover: false, comentar: false });
    await screen.findAllByText(/Solo el responsable, el supervisor o un superadmin/);
    expect(screen.queryByRole('button', { name: /^Hecha$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mandar a revisar/ })).toBeNull();
  });

  it('la ventana de «Devolver» queda por encima de la ficha y devuelve con el comentario', async () => {
    abrir({ status: 'hecha', completed_at: '2026-11-10T10:00:00Z' }, { devolver: true });
    fireEvent.click(await screen.findByRole('button', { name: /Devolver/ }));
    const titulo = await screen.findByText('Devolver tarea a «En curso»');
    // `z-60` no existe en Tailwind 3: la ventana quedaba detrás de la ficha (z-50).
    const capa = titulo.closest('.fixed');
    expect(capa?.className).toMatch(/z-\[60\]/);
    expect(capa?.className).not.toMatch(/(^|\s)z-60(\s|$)/);
    fireEvent.change(screen.getByPlaceholderText(/Explica qué debe revisarse/), { target: { value: 'Falta el pie' } });
    fireEvent.click(screen.getByRole('button', { name: 'Devolver tarea' }));
    await waitFor(() => expect(tasksApi.returnTask).toHaveBeenCalledWith(7, 'Falta el pie'));
  });

  it('el selector «Estado» de una hecha que no puede reabrir no sale vacío: enseña «Hecha» y qué le queda', async () => {
    abrir({ status: 'hecha', completed_at: '2026-11-10T10:00:00Z', assigned_to: 21, created_by: 20 }, { devolver: true, cerrar: false }, { columnas: COLUMNAS });
    const aviso = await screen.findByTestId('estado-bloqueado');
    expect(aviso.textContent).toMatch(/la reabre su supervisor/);
    expect(aviso.textContent).toMatch(/devolverla a «En curso»/);
    const select = aviso.parentElement.querySelector('select');
    expect([...select.options].map((o) => o.value)).toEqual(['hecha']);
    expect(select.value).toBe('hecha');
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
      team_id: 3, team_name: 'Desarrollo y SEO',
      project_name: null, external_project_name: null, area_name: null, area_color: null,
    }];
    render(<MemoryRouter><TasksHistoryPage /></MemoryRouter>);
    expect(await screen.findByText('Endpoint de facturas')).toBeTruthy();
    expect(screen.getByText('La hizo')).toBeTruthy();
    expect(screen.getByText('La cerró')).toBeTruthy();
    // La marca «Programación» ya no sale (11/11/2026).
    expect(screen.queryByText('Programación')).toBeNull();
    expect(screen.getAllByText(/Diego/).length).toBeGreaterThan(0);
    // Pide el mes en curso con el alcance del tablero.
    const pedido = tasksApi.getHistorial.mock.calls[0][0];
    expect(pedido).toMatchObject({ ver: 'mias', page: 1 });
    expect(pedido.desde).toMatch(/^\d{4}-\d{2}-01$/);
    // Ni rastro de una bandeja de aprobar.
    expect(screen.queryByText(/Aprobar/)).toBeNull();
  });
});

describe('«Por integrante» (Diego, 11/11/2026)', () => {
  it('«Yo» primero (aunque no tenga ninguna) y el resto de más a menos', () => {
    const fichas = [{ id: 31, nombre: 'Bea', total: 2 }, { id: 30, nombre: 'Ángel', total: 5 }, { id: 32, nombre: 'Ana', total: 2 }];
    expect(ordenarFichas(fichas, 20, 'Diana').map((f) => [f.id, f.total])).toEqual([[20, 0], [30, 5], [32, 2], [31, 2]]);
    expect(ordenarFichas([...fichas, { id: 20, nombre: 'Diana', total: 1 }], 20).map((f) => f.id)).toEqual([20, 30, 32, 31]);
    expect(alternarPersona('', 30)).toBe(30);
    expect(alternarPersona(30, 30)).toBe('');
    expect(alternarPersona(30, 31)).toBe(31);
  });

  it('una ficha por persona con su total, «Yo» primero; pulsar filtra, volver a pulsar lo quita, y cuadra con «Persona»', async () => {
    api.historial = [];
    // El servidor las manda de más a menos; «Yo» va primero igual.
    api.porPersona = [{ id: 30, nombre: 'Ángel', total: 5 }, { id: 20, nombre: 'Diana', total: 3 }, { id: 31, nombre: 'Bea', total: 1 }];
    render(<MemoryRouter><TasksHistoryPage /></MemoryRouter>);
    const zona = await screen.findByTestId('fichas-por-integrante');
    const fichas = [...zona.querySelectorAll('button')];
    expect(fichas.map((b) => b.textContent)).toEqual(['Yo3 tareas', 'Ángel5 tareas', 'Bea1 tarea']);
    expect(fichas.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);

    fireEvent.click(fichas[1]);
    await waitFor(() => expect(tasksApi.getHistorial).toHaveBeenLastCalledWith(expect.objectContaining({ assigned_to: 30 })));
    const elegida = () => screen.getByTestId('fichas-por-integrante').querySelectorAll('button[aria-pressed="true"]');
    await waitFor(() => expect(elegida()).toHaveLength(1));
    const angel = elegida()[0];
    expect(angel.textContent).toMatch(/Ángel/);
    expect(angel.getAttribute('title')).toBe('Quitar el filtro de persona');
    // El desplegable «Persona» dice lo mismo.
    expect(screen.getByRole('combobox', { name: 'Persona' }).textContent).toMatch(/Ángel/);

    fireEvent.click(angel);
    await waitFor(() => expect(tasksApi.getHistorial.mock.lastCall[0].assigned_to).toBeUndefined());
    expect(screen.getByRole('combobox', { name: 'Persona' }).textContent).toMatch(/Cualquier persona/);
    await waitFor(() => expect(elegida()).toHaveLength(0));
  });

  it('sin ninguna ficha del servidor no pinta la fila', async () => {
    api.porPersona = [];
    render(<MemoryRouter><TasksHistoryPage /></MemoryRouter>);
    await screen.findByText(/No hay tareas hechas/);
    expect(screen.queryByTestId('fichas-por-integrante')).toBeNull();
    api.porPersona = [];
  });
});

describe('Gestionar equipos', () => {
  it('ya no tiene la casilla «Equipo de programación» (11/11/2026)', async () => {
    api.equipos = [EQUIPO];
    render(<MemoryRouter><EquiposConfig /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Desarrollo y SEO'));
    await screen.findByText(/Cargos \(de más a menos nivel\)/);
    expect(screen.queryByText(/Equipo de programación/)).toBeNull();
    expect(screen.queryByText('Programación')).toBeNull();
    expect(tasksApi.updateTeam).not.toHaveBeenCalled();
  });
});
