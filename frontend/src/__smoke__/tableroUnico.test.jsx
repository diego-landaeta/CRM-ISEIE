// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  Gemela de la de MultiCRM. Un solo tablero (Diego, 27/10/2026): «Esto tiene que tener fecha de cuándo se
  creó y cuándo se terminó, y clasificarla en vistas por día, semana y mes, PERO
  QUE SEA UN SOLO TABLERO TODO Y YA CON FILTROS, NO MÚLTIPLES TABLEROS.»

  Cuatro columnas con todas las tareas, sin un bloque de columnas por persona;
  los filtros en una fila, combinables, con los activos a la vista y «Quitar
  filtros»; y en la tarjeta, «Creada …» y, si está hecha, «Terminada …».
*/

const { api } = vi.hoisted(() => ({
  api: {
    getTasks: vi.fn(),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, nombre: 'Diego', role: 'superadmin' } }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ projects: [] }) }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true }) }));
vi.mock('@/shared/components/ui/RecorridoGuiado', () => ({ default: () => null, recorridoPendiente: () => false }));
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
  getTaskById: vi.fn(async () => null),
}));

const { default: TasksPage } = await import('@/modules/tasks/pages/TasksPage');
const { rangoDePeriodo, hoyEnOficina, moverReferencia } = await import('@/modules/tasks/lib/periodo');

const tarea = (id, title, assigned_to, assigned_to_name, extra = {}) => ({
  id, title, description: null, status: 'por_hacer', position: id * 1000, priority: 'media', due_date: null,
  project_id: null, external_project_id: null, area_id: null, assigned_to, assigned_to_name,
  created_by: 1, completed_at: null, archived_at: null, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z',
  tags: [], ...extra,
});
const TAREAS = [
  tarea(1, 'Maquetar la home', 2, 'Ruth Sánchez'),
  tarea(2, 'Campaña de Meta', 3, 'Emmanuel Lozada', { status: 'en_curso' }),
  tarea(3, 'Revisar SEO', 1, 'Diego', { status: 'hecha', completed_at: '2026-10-22T10:00:00Z' }),
  tarea(4, 'Subir temario', 2, 'Ruth Sánchez', { status: 'en_revision' }),
];

beforeEach(() => {
  api.getTasks.mockReset();
  api.getTasks.mockResolvedValue(TAREAS);
});
afterEach(() => cleanup());

const abrir = () => render(<MemoryRouter initialEntries={['/tareas']}><TasksPage /></MemoryRouter>);
const ultimaPeticion = () => api.getTasks.mock.calls[api.getTasks.mock.calls.length - 1][0];

async function elegir(nombre, opcion) {
  fireEvent.click(screen.getByRole('combobox', { name: nombre }));
  fireEvent.mouseDown(await screen.findByRole('option', { name: opcion }));
}

describe('un solo tablero', () => {
  it('cuatro columnas, una vez cada una, con las tareas de todos: sin bloques por persona', async () => {
    abrir();
    await screen.findByText('Maquetar la home');
    const tablero = screen.getAllByTestId('tablero-unico');
    expect(tablero).toHaveLength(1);
    for (const col of ['Por hacer', 'En curso', 'En revisión', 'Hecha']) {
      expect(within(tablero[0]).getAllByRole('region', { name: col })).toHaveLength(1);
    }
    // Las tareas de tres personas, en el mismo tablero.
    for (const t of TAREAS) expect(screen.getByText(t.title)).toBeTruthy();
    // Ningún encabezado por persona.
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
    expect(screen.queryByRole('tab', { name: 'Por persona' })).toBeNull();
    // La tarjeta lleva las iniciales de quien la lleva.
    expect(screen.getAllByTitle('Ruth Sánchez').length).toBe(2);
  });

  it('la tarjeta dice cuándo se creó, y cuándo se terminó solo si está hecha', async () => {
    abrir();
    await screen.findByText('Maquetar la home');
    expect(screen.getAllByText(/^Creada 20 oct$/)).toHaveLength(4);
    expect(screen.getAllByText(/Terminada 22 oct/)).toHaveLength(1);
  });

  it('se entra en «Mis tareas», sin periodo', async () => {
    abrir();
    await screen.findByText('Maquetar la home');
    expect(api.getTasks.mock.calls[0][0]).toMatchObject({ ver: 'mias' });
    expect(api.getTasks.mock.calls[0][0].periodo_desde).toBeUndefined();
    expect(screen.getByTestId('resumen-periodo').textContent).toBe('Todas las fechas · 4 tareas: 1 terminada');
  });
});

describe('los filtros', () => {
  it('«Esta semana» pide la semana de lunes a domingo; con flechas, la anterior', async () => {
    abrir();
    await screen.findByText('Maquetar la home');
    fireEvent.click(screen.getByRole('tab', { name: 'Esta semana' }));
    const semana = rangoDePeriodo('semana', hoyEnOficina());
    await waitFor(() => expect(ultimaPeticion()).toMatchObject({ periodo_desde: semana.desde, periodo_hasta: semana.hasta }));
    expect(screen.getByTestId('resumen-periodo').textContent).toMatch(/^Semana del /);

    fireEvent.click(screen.getByRole('button', { name: 'semana anterior' }));
    const anterior = rangoDePeriodo('semana', moverReferencia('semana', hoyEnOficina(), -1));
    await waitFor(() => expect(ultimaPeticion()).toMatchObject({ periodo_desde: anterior.desde, periodo_hasta: anterior.hasta }));
  });

  it('«Hoy» y «Este mes»', async () => {
    abrir();
    await screen.findByText('Maquetar la home');
    fireEvent.click(screen.getByRole('tab', { name: 'Hoy' }));
    const hoy = hoyEnOficina();
    await waitFor(() => expect(ultimaPeticion()).toMatchObject({ periodo_desde: hoy, periodo_hasta: hoy }));
    fireEvent.click(screen.getByRole('tab', { name: 'Este mes' }));
    const mes = rangoDePeriodo('mes', hoy);
    await waitFor(() => expect(ultimaPeticion()).toMatchObject({ periodo_desde: mes.desde, periodo_hasta: mes.hasta }));
  });

  it('se combinan, se ven los activos y «Quitar filtros» lo deja como al entrar', async () => {
    abrir();
    await screen.findByText('Maquetar la home');
    await elegir('Ver', 'Todo');
    await elegir('Persona', 'Ruth Sánchez');
    await elegir('Prioridad', 'Alta');
    fireEvent.click(screen.getByRole('tab', { name: 'Esta semana' }));
    await waitFor(() => expect(ultimaPeticion()).toMatchObject({ ver: 'todo', assigned_to: 2, priority: 'alta' }));
    expect(ultimaPeticion().periodo_desde).toBeTruthy();
    expect(screen.getByText('Persona: Ruth Sánchez')).toBeTruthy();
    expect(screen.getByText('Prioridad: alta')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Quitar filtros/ }));
    await waitFor(() => expect(ultimaPeticion().assigned_to).toBeUndefined());
    expect(ultimaPeticion().priority).toBeUndefined();
    expect(ultimaPeticion().periodo_desde).toBeUndefined();
    // «Ver» no es un filtro que se quite: sigue en «Todo».
    expect(ultimaPeticion().ver).toBe('todo');
    expect(screen.queryByRole('button', { name: /Quitar filtros/ })).toBeNull();
  });
});
