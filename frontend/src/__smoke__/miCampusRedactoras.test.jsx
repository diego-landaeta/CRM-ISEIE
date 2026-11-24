// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/*
  «Mi campus» para las tutoras redactoras (gemela de CRM#1084; Diego, 24/11/2026): «pon lo nuevo del campus
  para responder, y que ahí también, no solo sean consultas, sino que lleguen las tareas
  y corregirlas desde ahí… y que las tutoras redactoras puedan ver entre uno y varios
  campus».

   · «Por responder»: sus consultas abiertas con el último mensaje; se responden ahí
     mismo y salen de la lista (y de la cifra de arriba).
   · «Por corregir»: cada entrega sin nota, la más antigua primero, y «Corregir» abre esa
     entrega (`?alumno=`) en la pantalla de corregir.
   · El selector: todos juntos o uno o varios; se pide al servidor solo lo elegido y se
     recuerda. Lo guardado que ya no es suyo vuelve a «Todos».

   npx vitest run src/__smoke__/miCampusRedactoras.test.jsx
*/

const { api, consultas } = vi.hoisted(() => ({
  api: { miCampus: vi.fn(), verTarea: vi.fn() },
  consultas: { mias: vi.fn(), responder: vi.fn() },
}));
vi.mock('@/modules/tutores/api/tutores.api', async (orig) => ({
  ...(await orig()),
  tutoresApi: { miCampus: (...a) => api.miCampus(...a), verTarea: (...a) => api.verTarea(...a) },
}));
vi.mock('@/modules/consultas/api/consultas.api', async (orig) => ({
  ...(await orig()),
  consultasApi: { mias: (...a) => consultas.mias(...a), responder: (...a) => consultas.responder(...a) },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 7, role: 'tutor_redactor', funciones: { plugin_moodle: true } } }) }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

// Aquí no hay fichero de preparación: jsdom no trae matchMedia (lo usa la pantalla de corregir).
if (!window.matchMedia) {
  window.matchMedia = (q) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
}

const { default: MiCampusPage } = await import('@/modules/tutores/pages/MiCampusPage');
const { default: CorregirTareaPage } = await import('@/modules/tutores/pages/CorregirTareaPage');
const { alternarCampus } = await import('@/modules/tutores/components/BandejaMiCampus');

const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();
const alumno = (id, nombre) => ({ id, nombre, email: null, ultimoAcceso: hace(1), progreso: 10, mensajeUrl: '#' });
const campus = (projectId, nombre, tareas) => ({
  projectId, campus: nombre, url: '#', error: null, dudasSinCurso: [],
  cursos: [{
    id: 30 + projectId, nombre: `Curso de ${nombre}`, url: '#', error: null, seguimiento: true, avisoProgreso: null,
    alumnos: [alumno(900, 'Ana'), alumno(901, 'Beto')], dudas: [], tareas,
  }],
});
const TODOS = [{ projectId: 3, campus: 'Fono' }, { projectId: 5, campus: 'ISEF' }];
const datos = (extra = {}) => ({
  leidoAt: new Date().toISOString(), pendientes: [], sinConectar: [], todosLosCampus: TODOS, elegidos: null,
  campus: [
    campus(3, 'Fono', [{ id: 77, nombre: 'Caso práctico', entrega: null, corregirUrl: '#', sinCorregir: [
      { alumnoId: 900, alumno: 'Ana', entregadaAt: hace(1) },
    ] }]),
    campus(5, 'ISEF', [{ id: 88, nombre: 'Examen final', entrega: null, corregirUrl: '#', sinCorregir: [
      { alumnoId: 901, alumno: 'Beto', entregadaAt: hace(4) },
    ] }]),
  ],
  ...extra,
});
const consulta = (id, project_id, alumno_nombre, ultimo_mensaje) => ({
  id, project_id, campus: project_id === 3 ? 'Fono' : 'ISEF', empresa: null, alumno_nombre, alumno_email: null,
  curso_nombre: 'Curso', tutor_id: 7, tutor: 'Redactora', estado: 'abierta', entrada_at: hace(0.1), asignada_at: null,
  primera_lectura_at: null, primera_respuesta_at: null, cerrada_at: null, reabierta_at: null, espera_desde: hace(0.1),
  ultimo_mensaje, sin_enviar: 0,
});

const pintar = () => render(<MemoryRouter initialEntries={['/mis-cursos/campus']}><MiCampusPage /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  api.miCampus.mockReset();
  api.miCampus.mockResolvedValue({ success: true, data: datos() });
  consultas.mias.mockReset();
  consultas.mias.mockResolvedValue({ success: true, data: {
    plazoHoras: 24, consultas: [consulta(41, 3, 'Ana', '¿Cuándo es el examen?'), consulta(42, 5, 'Beto', 'No puedo abrir el tema 2')],
  } });
  consultas.responder.mockReset();
  consultas.responder.mockResolvedValue({ success: true, data: { enviado: true, error: null } });
});
afterEach(() => cleanup());

describe('Mi campus · por responder', () => {
  it('sus consultas abiertas, con el último mensaje y la cifra de arriba', async () => {
    pintar();
    const lista = await screen.findByTestId('por-responder');
    await within(lista).findByText(/¿Cuándo es el examen\?/);
    expect(within(lista).getAllByTestId('consulta-por-responder')).toHaveLength(2);
    expect(within(lista).getAllByRole('link', { name: 'Abrir' }).map((a) => a.getAttribute('href'))).toEqual(['/consultas/41', '/consultas/42']);
    expect(consultas.mias).toHaveBeenCalledWith({ estado: 'pendientes' });
    await waitFor(() => expect(screen.getByTestId('resumen-mi-campus').textContent).toContain('2 dudas sin contestar'));
  });

  it('se responde ahí mismo y sale de la lista', async () => {
    pintar();
    const lista = await screen.findByTestId('por-responder');
    const fila = (await within(lista).findByText(/¿Cuándo es el examen\?/)).closest('li');
    fireEvent.click(within(fila).getByRole('button', { name: 'Responder' }));
    fireEvent.change(within(fila).getByLabelText(/Tu respuesta a Ana/), { target: { value: 'El viernes a las 10.' } });
    fireEvent.click(within(fila).getByRole('button', { name: /Enviar/ }));
    await waitFor(() => expect(consultas.responder).toHaveBeenCalledWith(41, 'El viernes a las 10.', []));
    await waitFor(() => expect(within(lista).getAllByTestId('consulta-por-responder')).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('resumen-mi-campus').textContent).toContain('1 duda sin contestar'));
  });

  it('sin texto no se envía nada', async () => {
    pintar();
    const lista = await screen.findByTestId('por-responder');
    const fila = (await within(lista).findByText(/No puedo abrir el tema 2/)).closest('li');
    fireEvent.click(within(fila).getByRole('button', { name: 'Responder' }));
    expect(within(fila).getByRole('button', { name: /Enviar/ })).toBeDisabled();
    expect(consultas.responder).not.toHaveBeenCalled();
  });
});

describe('Mi campus · por corregir', () => {
  it('cada entrega, la más antigua primero, con «Corregir» a esa entrega', async () => {
    pintar();
    const lista = await screen.findByTestId('por-corregir');
    const enlaces = await within(lista).findAllByRole('link', { name: /Corregir la entrega/ });
    expect(enlaces.map((a) => a.getAttribute('href'))).toEqual([
      '/mis-cursos/campus/tarea/5/35/88?alumno=901', // Beto, hace 4 días
      '/mis-cursos/campus/tarea/3/33/77?alumno=900', // Ana, ayer
    ]);
  });

  it('los cursos con algo que hacer empiezan abiertos, como antes (Diego, 24/11)', async () => {
    pintar();
    expect(await screen.findByRole('button', { name: /Curso de Fono/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Curso de ISEF/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('la pantalla de corregir abre la entrega pedida con ?alumno=', async () => {
    api.verTarea.mockResolvedValue({ success: true, data: {
      tarea: { id: 77, nombre: 'Caso práctico', notaMax: 10, entrega: null, enunciado: '', comentarios: true, moodleUrl: '#', calificable: true, enGrupo: false },
      entregas: [
        { alumnoId: 900, alumno: 'Ana', email: 'ana@test', estado: 'sin_corregir', entregadaAt: hace(1), texto: 'Entrega de Ana', archivos: [], nota: null, ultimoMensaje: null },
        { alumnoId: 901, alumno: 'Beto', email: 'beto@test', estado: 'sin_corregir', entregadaAt: hace(4), texto: 'Entrega de Beto', archivos: [], nota: null, ultimoMensaje: null },
      ],
    } });
    render(
      <MemoryRouter initialEntries={['/mis-cursos/campus/tarea/3/33/77?alumno=901']}>
        <Routes><Route path="/mis-cursos/campus/tarea/:projectId/:cursoId/:tareaId" element={<CorregirTareaPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Entrega de Beto')).toBeInTheDocument();
    expect(screen.queryByText('Entrega de Ana')).toBeNull();
  });
});

describe('Mi campus · uno o varios campus', () => {
  it('alternarCampus: desde «Todos», solo ese; quitar el último o tenerlos todos es «Todos»', () => {
    expect(alternarCampus([], 5, 3)).toEqual([5]);
    expect(alternarCampus([5], 3, 3)).toEqual([5, 3]);
    expect(alternarCampus([5, 3], 3, 3)).toEqual([5]);
    expect(alternarCampus([5], 5, 3)).toEqual([]);
    expect(alternarCampus([5, 3], 4, 3)).toEqual([]);
    expect(alternarCampus([], 5, 1)).toEqual([]);
  });

  it('elegir un campus lo pide al servidor y se recuerda', async () => {
    // El servidor contesta con lo que se le pide (`elegidos`), como de verdad.
    api.miCampus.mockImplementation(async (_refrescar, pedidos = []) => ({ success: true, data: datos({ elegidos: pedidos.length ? pedidos : null }) }));
    pintar();
    const grupo = await screen.findByRole('group', { name: 'Campus que ves' });
    expect(within(grupo).getByRole('button', { name: /Todos/ })).toHaveAttribute('aria-pressed', 'true');
    expect(api.miCampus).toHaveBeenLastCalledWith(false, []);
    fireEvent.click(within(grupo).getByRole('button', { name: 'ISEF' }));
    await waitFor(() => expect(api.miCampus).toHaveBeenLastCalledWith(false, [5]));
    expect(within(grupo).getByRole('button', { name: 'ISEF' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem('crm.miCampus.campus.v1'))).toEqual([5]);
    // Con los dos elegidos es lo mismo que «Todos».
    fireEvent.click(within(grupo).getByRole('button', { name: 'Fono' }));
    await waitFor(() => expect(api.miCampus).toHaveBeenLastCalledWith(false, []));
    expect(within(grupo).getByRole('button', { name: /Todos/ })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('crm.miCampus.campus.v1')).toBeNull();
  });

  it('al volver, entra con lo elegido; y las consultas se ven solo de esos campus', async () => {
    localStorage.setItem('crm.miCampus.campus.v1', JSON.stringify([5]));
    api.miCampus.mockResolvedValue({ success: true, data: datos({ elegidos: [5], campus: [datos().campus[1]] }) });
    pintar();
    const lista = await screen.findByTestId('por-responder');
    await within(lista).findByText(/No puedo abrir el tema 2/);
    expect(api.miCampus).toHaveBeenCalledWith(false, [5]);
    expect(within(lista).queryByText(/¿Cuándo es el examen\?/)).toBeNull();
  });

  it('lo guardado que ya no es suyo vuelve a «Todos»', async () => {
    localStorage.setItem('crm.miCampus.campus.v1', JSON.stringify([99]));
    pintar();
    await screen.findByRole('group', { name: 'Campus que ves' });
    await waitFor(() => expect(localStorage.getItem('crm.miCampus.campus.v1')).toBeNull());
    await waitFor(() => expect(api.miCampus).toHaveBeenLastCalledWith(false, []));
  });

  it('con un solo campus no hay selector', async () => {
    api.miCampus.mockResolvedValue({ success: true, data: datos({ todosLosCampus: [TODOS[0]], campus: [datos().campus[0]] }) });
    pintar();
    await screen.findByTestId('por-corregir');
    expect(screen.queryByRole('group', { name: 'Campus que ves' })).toBeNull();
  });
});
