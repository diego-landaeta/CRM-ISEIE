// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/*
  La cuenta de administración del sitio, como excepción (gemela de la del CRM 360; Diego, 24/11/2026: una tutora que
  solo tiene esa cuenta en un campus y da clase con ella «es necesario que entre»).

   · Ficha de la tutora: al buscar esa cuenta, el aviso «Es la cuenta de administración del
     sitio; se enlaza igual porque ella da clase con ella» y «Enlazar como excepción», que
     solo se pulsa tras marcar la confirmación. Enlazada, la ficha lo dice.
   · Mi campus: en ese campus lo ve todo, pero dice «responde y corrige desde Moodle» y los
     botones llevan a Moodle (no a responder ni corregir aquí). Los demás campus, igual que siempre.
   · Corregir: la pantalla de la tarea no ofrece poner la nota.

   npx vitest run src/__smoke__/tutoraAdminDelSitio.test.jsx
*/

const { api, consultas, campusApi } = vi.hoisted(() => ({
  api: { miCampus: vi.fn(), verTarea: vi.fn() },
  consultas: { mias: vi.fn(), responder: vi.fn(), tokensDelTutor: vi.fn(), guardarToken: vi.fn() },
  campusApi: { ver: vi.fn(), buscarCuenta: vi.fn(), vincular: vi.fn() },
}));
vi.mock('@/modules/tutores/api/tutores.api', async (orig) => ({
  ...(await orig()),
  tutoresApi: { miCampus: (...a) => api.miCampus(...a), verTarea: (...a) => api.verTarea(...a) },
}));
vi.mock('@/modules/tutores/api/campusTutor.api', () => ({ campusTutorApi: campusApi }));
vi.mock('@/modules/consultas/api/consultas.api', async (orig) => ({
  ...(await orig()),
  consultasApi: consultas,
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 7, role: 'tutor_redactor', funciones: { plugin_moodle: true } } }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ projects: [] }) }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

// Aquí no hay fichero de preparación: jsdom no trae matchMedia (lo usa la pantalla de corregir).
if (!window.matchMedia) {
  window.matchMedia = (q) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
}

const { default: MiCampusPage } = await import('@/modules/tutores/pages/MiCampusPage');
const { default: CorregirTareaPage } = await import('@/modules/tutores/pages/CorregirTareaPage');
const { default: ConsultasDelTutor } = await import('@/modules/tutores/components/ConsultasDelTutor');
const { SOLO_DESDE_MOODLE, AVISO_EXCEPCION_ADMIN } = await import('@/modules/tutores/lib/adminDelSitio');

const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();
const alumno = (id, nombre) => ({ id, nombre, email: null, ultimoAcceso: hace(1), progreso: 10, mensajeUrl: '#' });
const campus = (projectId, nombre, url, extra = {}) => ({
  projectId, campus: nombre, url, error: null, dudasSinCurso: [], ...extra,
  cursos: [{
    id: 30 + projectId, nombre: `Curso de ${nombre}`, url: '#', error: null, seguimiento: true, avisoProgreso: null,
    alumnos: [alumno(900 + projectId, `Alumno ${nombre}`)], dudas: [],
    tareas: [{ id: 70 + projectId, nombre: `Tarea ${nombre}`, entrega: null, corregirUrl: `${url}/mod/assign/view.php?id=1&action=grading`, sinCorregir: [
      { alumnoId: 900 + projectId, alumno: `Alumno ${nombre}`, entregadaAt: hace(1), corregirUrl: `${url}/mod/assign/view.php?id=1&action=grader&userid=${900 + projectId}` },
    ] }],
  }],
});
const datos = () => ({
  leidoAt: new Date().toISOString(), pendientes: [], sinConectar: [], elegidos: null,
  todosLosCampus: [{ projectId: 6, campus: 'ISAEG' }, { projectId: 5, campus: 'ISEF' }],
  campus: [
    campus(6, 'ISAEG', 'https://isaeg.test', { soloDesdeMoodle: true }),
    campus(5, 'ISEF', 'https://isef.test'),
  ],
});
const consulta = (id, project_id, alumno_nombre, ultimo_mensaje) => ({
  id, project_id, campus: project_id === 6 ? 'ISAEG' : 'ISEF', empresa: null, alumno_nombre, alumno_email: null,
  curso_nombre: 'Curso', tutor_id: 7, tutor: 'Redactora', estado: 'abierta', entrada_at: hace(0.1), asignada_at: null,
  primera_lectura_at: null, primera_respuesta_at: null, cerrada_at: null, reabierta_at: null, espera_desde: hace(0.1),
  ultimo_mensaje, sin_enviar: 0,
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  api.miCampus.mockResolvedValue({ success: true, data: datos() });
  consultas.mias.mockResolvedValue({ success: true, data: {
    plazoHoras: 24, consultas: [consulta(41, 6, 'Ana', 'Duda en ISAEG'), consulta(42, 5, 'Beto', 'Duda en ISEF')],
  } });
  consultas.tokensDelTutor.mockResolvedValue({ success: true, data: [] });
});
afterEach(() => cleanup());

describe('Mi campus con la cuenta de administración del sitio', () => {
  it('ese campus dice «responde y corrige desde Moodle»; el otro, no', async () => {
    render(<MemoryRouter initialEntries={['/mis-cursos/campus']}><MiCampusPage /></MemoryRouter>);
    const aviso = await screen.findByTestId('solo-desde-moodle-6');
    expect(aviso.textContent).toContain(SOLO_DESDE_MOODLE);
    expect(screen.queryByTestId('solo-desde-moodle-5')).toBeNull();
  });

  it('por responder: la consulta de ese campus lleva a Moodle; la del otro se responde aquí', async () => {
    render(<MemoryRouter initialEntries={['/mis-cursos/campus']}><MiCampusPage /></MemoryRouter>);
    const lista = await screen.findByTestId('por-responder');
    const deIsaeg = (await within(lista).findByText(/Duda en ISAEG/)).closest('li');
    expect(within(deIsaeg).queryByRole('button', { name: 'Responder' })).toBeNull();
    expect(within(deIsaeg).getByRole('link', { name: /Responder en Moodle/ })).toHaveAttribute('href', 'https://isaeg.test/message/index.php');
    const deIsef = within(lista).getByText(/Duda en ISEF/).closest('li');
    expect(within(deIsef).getByRole('button', { name: 'Responder' })).toBeInTheDocument();
  });

  it('por corregir: la entrega de ese campus se corrige en Moodle; la del otro, aquí', async () => {
    render(<MemoryRouter initialEntries={['/mis-cursos/campus']}><MiCampusPage /></MemoryRouter>);
    const lista = await screen.findByTestId('por-corregir');
    const enMoodle = await within(lista).findByRole('link', { name: /Corregir en Moodle la entrega de Alumno ISAEG/ });
    expect(enMoodle).toHaveAttribute('href', 'https://isaeg.test/mod/assign/view.php?id=1&action=grader&userid=906');
    expect(within(lista).getByRole('link', { name: /^Corregir la entrega de Alumno ISEF/ }))
      .toHaveAttribute('href', '/mis-cursos/campus/tarea/5/35/75?alumno=905');
  });

  it('la pantalla de corregir no ofrece poner la nota y lleva a Moodle', async () => {
    api.verTarea.mockResolvedValue({ success: true, data: {
      tarea: { id: 76, nombre: 'Tarea ISAEG', notaMax: 10, entrega: null, enunciado: '', comentarios: true,
        moodleUrl: 'https://isaeg.test/mod/assign/view.php?id=1&action=grading', calificable: true, enGrupo: false, soloDesdeMoodle: true },
      entregas: [{ alumnoId: 906, alumno: 'Alumno ISAEG', email: null, estado: 'sin_corregir', entregadaAt: hace(1), texto: 'Mi entrega', archivos: [], nota: null, ultimoMensaje: null }],
    } });
    render(
      <MemoryRouter initialEntries={['/mis-cursos/campus/tarea/6/36/76?alumno=906']}>
        <Routes><Route path="/mis-cursos/campus/tarea/:projectId/:cursoId/:tareaId" element={<CorregirTareaPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Mi entrega')).toBeInTheDocument();
    expect(screen.getAllByText(SOLO_DESDE_MOODLE).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Guardar/ })).toBeNull();
    expect(screen.getAllByRole('link', { name: /Corregir en Moodle/ })[0]).toHaveAttribute('href', 'https://isaeg.test/mod/assign/view.php?id=1&action=grading');
  });
});

describe('Ficha de la tutora: enlazar la cuenta de administración del sitio como excepción', () => {
  const fila = (extra = {}) => ({
    project_id: 6, campus: 'ISAEG', via: 'campus', issuer_id: 1, empresa: 'CEDIA', campus_conectado: true,
    estado: 'pendiente', comprobado_at: hace(0), error: null, gestionable: true, ...extra,
  });
  const panel = (c) => ({ success: true, data: { campus: [c], empresas: [], disponible: true, motivo_no_disponible: null, no_disponible_desde: null, avisos: [] } });

  it('sin confirmar no se puede; confirmada, se enlaza con la excepción y la ficha lo dice', async () => {
    campusApi.ver.mockResolvedValue(panel(fila()));
    const error = Object.assign(new Error('Esa cuenta es la del administrador del sitio'), {
      status: 409,
      data: { success: false, code: 'ADMIN_DEL_SITIO', error: 'Esa cuenta es la del administrador del sitio',
        data: { cuenta: { id: 6, nombre: 'Cuenta admin', email: 'admin@isaeg.test', suspendido: false }, aviso: AVISO_EXCEPCION_ADMIN } },
    });
    campusApi.buscarCuenta.mockRejectedValue(error);
    campusApi.vincular.mockResolvedValue(panel(fila({ estado: 'activa', admin_sitio_excepcion: true })));

    render(<ConsultasDelTutor tutorId={67} puedeGestionar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a mano' }));
    fireEvent.change(screen.getByLabelText(/Su correo en el Moodle de ISAEG/), { target: { value: 'admin@isaeg.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    const caja = await screen.findByTestId('excepcion-admin');
    expect(caja.textContent).toContain(AVISO_EXCEPCION_ADMIN);
    const enlazar = within(caja).getByRole('button', { name: 'Enlazar como excepción' });
    expect(enlazar).toBeDisabled();
    fireEvent.click(within(caja).getByRole('checkbox'));
    expect(enlazar).toBeEnabled();
    fireEvent.click(enlazar);
    await waitFor(() => expect(campusApi.vincular).toHaveBeenCalledWith(67, 6, 6, true));
    expect((await screen.findByTestId('excepcion-admin-6')).textContent).toBe(SOLO_DESDE_MOODLE);
  });

  it('una cuenta normal se vincula como siempre, sin excepción', async () => {
    campusApi.ver.mockResolvedValue(panel(fila()));
    campusApi.buscarCuenta.mockResolvedValue({ success: true, data: { id: 22, nombre: 'Profe', email: 'profe@isaeg.test', suspendido: false } });
    campusApi.vincular.mockResolvedValue(panel(fila({ estado: 'activa' })));
    render(<ConsultasDelTutor tutorId={67} puedeGestionar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a mano' }));
    fireEvent.change(screen.getByLabelText(/Su correo en el Moodle de ISAEG/), { target: { value: 'profe@isaeg.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Es ella: vincular' }));
    await waitFor(() => expect(campusApi.vincular).toHaveBeenCalledWith(67, 6, 22, false));
    expect(screen.queryByTestId('excepcion-admin')).toBeNull();
  });
});
