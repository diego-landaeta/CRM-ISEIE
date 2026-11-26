// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  La administradora del sitio que da clase, cuando el campus la PERMITE (CRM-ISEIE#773, gemela
  de CRM#1118; plugin local_crm 1.11.7, «Administradoras que dan clase»).

   · Mi campus: el servidor ya no la marca `soloDesdeMoodle`, así que ese campus no dice
     «responde y corrige desde Moodle» y las dudas se responden aquí.
   · Ficha de la tutora: con la excepción y `admin_sitio_permitida`, dice que el campus la deja
     responder y corregir desde el CRM; sin él, «responde y corrige desde Moodle», como antes.

   npx vitest run src/__smoke__/adminTutoraPermitida.test.jsx
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

const { default: MiCampusPage } = await import('@/modules/tutores/pages/MiCampusPage');
const { default: ConsultasDelTutor } = await import('@/modules/tutores/components/ConsultasDelTutor');
const { SOLO_DESDE_MOODLE, ADMIN_PERMITIDA } = await import('@/modules/tutores/lib/adminDelSitio');

const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();
const campus = (projectId, nombre, url, extra = {}) => ({
  projectId, campus: nombre, url, error: null, dudasSinCurso: [], ...extra,
  cursos: [{
    id: 30 + projectId, nombre: `Curso de ${nombre}`, url: '#', error: null, seguimiento: true, avisoProgreso: null,
    alumnos: [{ id: 900 + projectId, nombre: `Alumno ${nombre}`, email: null, ultimoAcceso: hace(1), progreso: 10, mensajeUrl: '#' }],
    dudas: [],
    tareas: [{ id: 70 + projectId, nombre: `Tarea ${nombre}`, entrega: null, corregirUrl: `${url}/mod/assign/view.php?id=1&action=grading`, sinCorregir: [
      { alumnoId: 900 + projectId, alumno: `Alumno ${nombre}`, entregadaAt: hace(1), corregirUrl: `${url}/mod/assign/view.php?id=1&action=grader&userid=${900 + projectId}` },
    ] }],
  }],
});
const consulta = (id, project_id, alumno_nombre, ultimo_mensaje) => ({
  id, project_id, campus: 'ISAEG', empresa: null, alumno_nombre, alumno_email: null,
  curso_nombre: 'Curso', tutor_id: 7, tutor: 'Redactora', estado: 'abierta', entrada_at: hace(0.1), asignada_at: null,
  primera_lectura_at: null, primera_respuesta_at: null, cerrada_at: null, reabierta_at: null, espera_desde: hace(0.1),
  ultimo_mensaje, sin_enviar: 0,
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // La cuenta de administración del sitio enlazada en ISAEG, y el campus la permite: el
  // servidor manda `soloDesdeMoodle: false` (antes, true).
  api.miCampus.mockResolvedValue({ success: true, data: {
    leidoAt: new Date().toISOString(), pendientes: [], sinConectar: [], elegidos: null,
    todosLosCampus: [{ projectId: 6, campus: 'ISAEG' }],
    campus: [campus(6, 'ISAEG', 'https://isaeg.test', { soloDesdeMoodle: false })],
  } });
  consultas.mias.mockResolvedValue({ success: true, data: { plazoHoras: 24, consultas: [consulta(41, 6, 'Ana', 'Duda en ISAEG')] } });
  consultas.tokensDelTutor.mockResolvedValue({ success: true, data: [] });
});
afterEach(() => cleanup());

describe('Mi campus con la administradora que el campus permite', () => {
  it('no dice «responde y corrige desde Moodle», y la duda y la entrega se atienden aquí', async () => {
    render(<MemoryRouter initialEntries={['/mis-cursos/campus']}><MiCampusPage /></MemoryRouter>);
    const lista = await screen.findByTestId('por-responder');
    const duda = (await within(lista).findByText(/Duda en ISAEG/)).closest('li');
    expect(within(duda).getByRole('button', { name: 'Responder' })).toBeInTheDocument();
    expect(within(duda).queryByRole('link', { name: /Responder en Moodle/ })).toBeNull();
    expect(screen.queryByTestId('solo-desde-moodle-6')).toBeNull();
    expect(screen.queryByText(SOLO_DESDE_MOODLE)).toBeNull();
    const porCorregir = screen.getByTestId('por-corregir');
    expect(within(porCorregir).getByRole('link', { name: /^Corregir la entrega de Alumno ISAEG/ }))
      .toHaveAttribute('href', '/mis-cursos/campus/tarea/6/36/76?alumno=906');
  });
});

describe('Ficha de la tutora con la excepción de la cuenta de administración del sitio', () => {
  const panel = (extra) => ({ success: true, data: {
    campus: [{
      project_id: 6, campus: 'ISAEG', via: 'campus', issuer_id: 1, empresa: 'CEDIA', campus_conectado: true,
      estado: 'activa', comprobado_at: hace(0), error: null, gestionable: true, admin_sitio_excepcion: true, ...extra,
    }],
    empresas: [], disponible: true, motivo_no_disponible: null, no_disponible_desde: null, avisos: [],
  } });

  it('el campus la permite: lo dice, sin «responde y corrige desde Moodle»', async () => {
    campusApi.ver.mockResolvedValue(panel({ admin_sitio_permitida: true }));
    render(<ConsultasDelTutor tutorId={67} puedeGestionar />);
    const aviso = await screen.findByTestId('excepcion-admin-6');
    expect(aviso.textContent).toBe(ADMIN_PERMITIDA);
    expect(screen.queryByText(SOLO_DESDE_MOODLE)).toBeNull();
  });

  it('el campus no la permite (o tiene un plugin anterior): «responde y corrige desde Moodle», como antes', async () => {
    campusApi.ver.mockResolvedValue(panel({ admin_sitio_permitida: false }));
    render(<ConsultasDelTutor tutorId={67} puedeGestionar />);
    expect((await screen.findByTestId('excepcion-admin-6')).textContent).toBe(SOLO_DESDE_MOODLE);
  });
});
