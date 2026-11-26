// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  «Mi campus» de administración (Diego, 25/11/2026: «que los admin puedan verlo también y
  los superadmin»), gemela de la del CRM. Con `tutores.campus_administracion`:

   · sin cuenta enlazada, «Mi campus» abre en «Todo el campus (administración)» y lo dice;
   · consultas por responder y entregas por corregir (la más antigua primero), con
     «Abrir en Moodle»; «Corregir» solo donde es profesora con su cuenta;
   · filtro por curso: las listas se quedan en él y se leen sus alumnos con su % hecho;
   · si el servidor dice «leyendo», se vuelve a preguntar;
   · la tutora sin el permiso: como siempre, sin pestañas.
   · el menú: «Mi campus» sale con el permiso nuevo.

   npx vitest run src/__smoke__/miCampusAdministracion.test.jsx
*/

const { api, permisos } = vi.hoisted(() => ({
  api: { miCampus: vi.fn(), miCampusAdministracion: vi.fn(), cursoAdministracion: vi.fn() },
  permisos: { lista: new Set() },
}));
vi.mock('@/modules/tutores/api/tutores.api', async (orig) => ({
  ...(await orig()),
  tutoresApi: {
    miCampus: (...a) => api.miCampus(...a),
    miCampusAdministracion: (...a) => api.miCampusAdministracion(...a),
    cursoAdministracion: (...a) => api.cursoAdministracion(...a),
  },
}));
vi.mock('@/modules/consultas/api/consultas.api', async (orig) => ({
  ...(await orig()),
  consultasApi: { mias: vi.fn(async () => ({ success: true, data: { consultas: [], plazoHoras: 24 } })) },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 91, role: 'admin' }, permissions: null }) }));
vi.mock('@/shared/hooks/usePermission', () => ({
  default: () => ({ can: (p) => permisos.lista.has(p), roles: ['admin'], tieneRol: () => false, isAdmin: true }),
}));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { default: MiCampusPage } = await import('@/modules/tutores/pages/MiCampusPage');
const { canSeeItem, NAV_SECTIONS } = await import('@/shared/components/layout/Sidebar');

const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();
const campus = (extra = {}) => ({
  projectId: 10, campus: 'ISEIE', url: 'https://campus.test', error: null, avisos: [], tareasEnGrupo: 0,
  cursos: [
    { id: 500, nombre: 'Curso A', visible: true, url: 'https://campus.test/course/view.php?id=500', porCorregir: 1, profesoras: [{ id: 5, nombre: 'Tutora Uno' }], error: null, soyProfesora: false },
    { id: 501, nombre: 'Curso B', visible: true, url: 'https://campus.test/course/view.php?id=501', porCorregir: 1, profesoras: [{ id: 6, nombre: 'Bárbara' }], error: null, soyProfesora: true },
  ],
  entregas: [
    { cursoId: 501, curso: 'Curso B', tareaId: 901, tarea: 'Caso práctico', alumnoId: 61, alumno: 'Beto', entregadaAt: hace(10), corregirUrl: 'https://campus.test/grader/61', tareaUrl: '#', profesoras: [{ id: 6, nombre: 'Bárbara' }], puedoCorregir: true },
    { cursoId: 500, curso: 'Curso A', tareaId: 900, tarea: 'Examen', alumnoId: 60, alumno: 'Ana', entregadaAt: hace(2), corregirUrl: 'https://campus.test/grader/60', tareaUrl: '#', profesoras: [{ id: 5, nombre: 'Tutora Uno' }], puedoCorregir: false },
  ],
  consultas: [{ consultaId: 1, alumnoId: 61, alumno: 'Beto', cursoId: 501, curso: 'Curso B', desde: hace(3), tutoraId: 31, tutora: 'Tutora Dos', moodleUrl: 'https://campus.test/message/index.php?convid=333' }],
  mensajes: [{ conversacionId: 70, alumnoId: 60, alumno: 'Ana', desde: hace(1), tutoraId: 30, tutora: 'Tutora Uno', responderUrl: 'https://campus.test/message/index.php?convid=70' }],
  ...extra,
});
const respuesta = (extra = {}) => ({
  success: true,
  data: {
    todosLosCampus: [{ projectId: 10, campus: 'ISEIE' }], elegido: 10, leyendo: false,
    leidoAt: new Date().toISOString(), campus: campus(), tengoCuentaEnlazada: false, ...extra,
  },
});

const pintar = () => render(<MemoryRouter initialEntries={['/mis-cursos/campus']}><MiCampusPage /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  permisos.lista = new Set(['tutores.campus_administracion']);
  api.miCampus.mockReset();
  api.miCampus.mockResolvedValue({ success: true, data: { leidoAt: new Date().toISOString(), campus: [], pendientes: [], sinConectar: [], todosLosCampus: [], elegidos: null } });
  api.miCampusAdministracion.mockReset();
  api.miCampusAdministracion.mockResolvedValue(respuesta());
  api.cursoAdministracion.mockReset();
  api.cursoAdministracion.mockResolvedValue({
    success: true,
    data: {
      projectId: 10, id: 501, nombre: 'Curso B', visible: true, url: '#', seguimiento: true, avisoProgreso: null, error: null,
      leidoAt: new Date().toISOString(), profesoras: [{ id: 6, nombre: 'Bárbara' }], soyProfesora: true,
      alumnos: [{ id: 61, nombre: 'Beto', email: null, ultimoAcceso: hace(1), progreso: 40, mensajeUrl: '#' }],
      tareas: [], consultas: [],
    },
  });
});
afterEach(() => cleanup());

describe('Mi campus · administración', () => {
  it('sin cuenta enlazada abre en «Todo el campus» y dice que es la vista de administración', async () => {
    pintar();
    await screen.findByTestId('mi-campus-administracion');
    expect(screen.getByText(/Vista de administración: todo el campus/)).toBeInTheDocument();
    expect(screen.getByText(/Administración: todo el campus en Moodle/)).toBeInTheDocument();
    // No lee «sus cursos»: no tiene.
    expect(api.miCampus).not.toHaveBeenCalled();
    expect(screen.queryByRole('tab', { name: /Mis cursos en Moodle/ })).not.toBeInTheDocument();
  });

  it('entregas por corregir, la más antigua primero, con «Abrir en Moodle»; «Corregir» solo donde da clase', async () => {
    pintar();
    const lista = await screen.findByTestId('entregas-admin');
    const filas = within(lista).getAllByRole('listitem');
    expect(filas[0]).toHaveTextContent('Beto · Caso práctico');
    expect(filas[1]).toHaveTextContent('Ana · Examen');
    expect(within(filas[0]).getByRole('link', { name: 'Corregir' })).toHaveAttribute('href', '/mis-cursos/campus/tarea/10/501/901');
    expect(within(filas[1]).queryByRole('link', { name: 'Corregir' })).not.toBeInTheDocument();
    expect(within(filas[1]).getByRole('link', { name: /Abrir en Moodle/ })).toHaveAttribute('href', 'https://campus.test/grader/60');
    expect(screen.getByTestId('resumen-admin')).toHaveTextContent('2 consultas por responder');
    expect(screen.getByTestId('resumen-admin')).toHaveTextContent('2 entregas por corregir');
  });

  it('filtrar por curso: las listas se quedan en él y se leen sus alumnos con su % hecho', async () => {
    pintar();
    const filtro = await screen.findByTestId('filtro-curso-admin');
    fireEvent.change(filtro, { target: { value: '501' } });
    await waitFor(() => expect(api.cursoAdministracion).toHaveBeenCalledWith(10, 501, false));
    const lista = screen.getByTestId('entregas-admin');
    expect(within(lista).getAllByRole('listitem')).toHaveLength(1);
    await screen.findByTestId('detalle-curso-admin');
    expect(screen.getByTestId('progreso-alumno-admin')).toHaveTextContent('40');
    expect(screen.getByTestId('resumen-admin')).toHaveTextContent('1 consulta por responder');
  });

  it('si el servidor sigue leyendo, lo dice y vuelve a preguntar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.miCampusAdministracion.mockResolvedValueOnce(respuesta({ leyendo: true, campus: null, leidoAt: null }));
      pintar();
      await screen.findByTestId('admin-leyendo');
      await vi.advanceTimersByTimeAsync(4500);
      await waitFor(() => expect(api.miCampusAdministracion).toHaveBeenCalledTimes(2));
      await screen.findByTestId('entregas-admin');
    } finally { vi.useRealTimers(); }
  });

  it('con su cuenta enlazada, también la pestaña de sus cursos', async () => {
    api.miCampusAdministracion.mockResolvedValue(respuesta({ tengoCuentaEnlazada: true }));
    pintar();
    expect(await screen.findByRole('tab', { name: /Mis cursos en Moodle/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Todo el campus \(administración\)/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('la tutora sin el permiso: como siempre, sin pestañas ni administración', async () => {
    permisos.lista = new Set(['tutores.mis_cursos']);
    pintar();
    await waitFor(() => expect(api.miCampus).toHaveBeenCalled());
    expect(api.miCampusAdministracion).not.toHaveBeenCalled();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mis cursos y comisiones/ })).toBeInTheDocument();
  });
});

describe('el menú', () => {
  const entrada = () => NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => [i, ...(i.children || [])])).find((it) => it.to === '/mis-cursos/campus');
  it('«Mi campus» sale a un admin con el permiso nuevo y no sin él', () => {
    const it1 = entrada();
    expect(canSeeItem(it1, ['admin'], false, {}, (p) => p === 'tutores.campus_administracion')).toBe(true);
    expect(canSeeItem(it1, ['admin'], false, {}, () => false)).toBe(false);
  });
  it('a la tutora, como siempre, con «Sus cursos»', () => {
    expect(canSeeItem(entrada(), ['tutor'], false, {}, (p) => p === 'tutores.mis_cursos')).toBe(true);
  });
});
