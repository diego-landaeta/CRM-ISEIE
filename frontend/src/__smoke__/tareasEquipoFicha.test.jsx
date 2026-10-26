// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  Tareas con equipos (Diego, 26/10/2026): la tarjeta enseña «Equipo · Cargo» (o
  «Sin equipo»), y en la ficha, quien no es el responsable, el supervisor ni un
  superadmin no ve la caja de comentarios: «Solo el responsable, el supervisor o
  un superadmin pueden moverla o comentarla». Lo decide el servidor (`permisos`).
*/

const api = vi.hoisted(() => ({ tarea: null }));
vi.mock('@/modules/tasks/api/tasks.api', () => ({
  getTaskById: vi.fn(async () => api.tarea),
  getAssignees: vi.fn(async () => []),
}));

const { TaskCard } = await import('@/modules/tasks/components/TaskCard');
const { TaskModal } = await import('@/modules/tasks/components/TaskModal');

const base = {
  id: 7, title: 'Maquetar la home', description: null, status: 'en_curso', position: 1000, priority: 'media',
  due_date: null, project_id: null, external_project_id: null, area_id: null, assigned_to: 20, assigned_to_name: 'Diana',
  supervisor_id: 30, supervisor_name: 'Ángel', created_by: 10, completed_at: null, archived_at: null,
  created_at: '2026-10-26T10:00:00Z', updated_at: '2026-10-26T10:00:00Z', tags: [],
  team_id: 3, team_name: 'Desarrollo y SEO', team_color: 'blue', assigned_cargo: 'Miembro',
};
const detalle = (permisos) => ({ ...base, checklist: [], comments: [], links: [], events: [], permisos });
const noop = () => {};

afterEach(() => cleanup());

describe('la tarjeta', () => {
  it('enseña el equipo y el cargo de quien la lleva', () => {
    render(<TaskCard task={base} draggable={false} showAssignee={false} conEquipos onOpen={noop} onDragStart={noop} onDragEnd={noop} onDragOverCard={noop} />);
    expect(screen.getByText('Desarrollo y SEO · Miembro')).toBeTruthy();
  });

  it('sin equipo dice «Sin equipo»; sin equipos en el CRM, nada', () => {
    const sin = { ...base, team_id: null, team_name: null, assigned_cargo: null };
    render(<TaskCard task={sin} draggable={false} showAssignee={false} conEquipos onOpen={noop} onDragStart={noop} onDragEnd={noop} onDragOverCard={noop} />);
    expect(screen.getByText('Sin equipo')).toBeTruthy();
    cleanup();
    render(<TaskCard task={sin} draggable={false} showAssignee={false} onOpen={noop} onDragStart={noop} onDragEnd={noop} onDragOverCard={noop} />);
    expect(screen.queryByText('Sin equipo')).toBeNull();
  });
});

function abrir(permisos) {
  api.tarea = detalle(permisos);
  render(
    <MemoryRouter>
      <TaskModal open taskId={7} onClose={noop} onChanged={noop} currentUserId={99} canAssign={false} canArchiveAny={false}
        assignees={[]} projects={[]} columns={[{ key: 'en_curso', name: 'En curso', is_active: true }]} />
    </MemoryRouter>
  );
}

describe('la ficha', () => {
  it('quien no puede comentar no ve la caja, y se le dice por qué', async () => {
    abrir({ mover: false, comentar: false, revisar: false, cerrar: false, editar: false, delegar: false });
    await waitFor(() => expect(screen.getAllByText(/Solo el responsable, el supervisor o un superadmin pueden moverla o comentarla/).length).toBeGreaterThan(0));
    expect(screen.queryByPlaceholderText('Escribe un comentario…')).toBeNull();
  });

  it('quien la lleva sí comenta', async () => {
    abrir({ mover: true, comentar: true, revisar: false, cerrar: false, editar: false, delegar: false });
    await waitFor(() => expect(screen.getByPlaceholderText('Escribe un comentario…')).toBeTruthy());
  });
});
