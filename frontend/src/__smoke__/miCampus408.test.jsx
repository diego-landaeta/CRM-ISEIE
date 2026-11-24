// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  «Mi campus» (CRM-ISEIE#408, gemela de CRM#681), las indicaciones de Carlos (05/11):
    · arriba, «X entregas por corregir, Y dudas sin contestar y Z cursos por desarrollar»;
    · arriba, todo junto (gemela de CRM#1084): las consultas por responder y las entregas
      por corregir, que se corrigen DESDE EL CRM (la pantalla de corregir, con el plugin);
    · por curso (abierto de entrada si tiene algo que hacer): sus tareas y los alumnos con su último acceso y su
      % hecho («—» si Moodle no lo da, no 0 %);
    · al lado, lo que tiene por desarrollar, con su fecha.
*/

const api = vi.hoisted(() => ({ miCampus: vi.fn(), toast: vi.fn(), mias: vi.fn() }));
vi.mock('@/modules/tutores/api/tutores.api', () => ({ tutoresApi: { miCampus: api.miCampus } }));
vi.mock('@/modules/consultas/api/consultas.api', () => ({ consultasApi: { mias: api.mias, responder: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: api.toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 7, role: 'tutor' } }) }));

import MiCampusPage from '@/modules/tutores/pages/MiCampusPage';

afterEach(cleanup);

// La fecha en hora LOCAL, como la cuenta la pantalla: con toISOString() salía el día UTC
// y de 20:00 a 24:00 en América (UTC-4) la prueba veía «11 días» en vez de 10.
const dentroDeDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const hace = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const MOODLE = 'https://campus.test';

const datos = () => ({
  leidoAt: new Date().toISOString(),
  campus: [{
    projectId: 1, campus: 'ISEIE Madrid', url: MOODLE, error: null,
    cursos: [{
      id: 50, nombre: 'Máster en Psicología', url: `${MOODLE}/course/view.php?id=50`, error: null, seguimiento: true, avisoProgreso: null,
      alumnos: [
        { id: 910, nombre: 'Ana Prueba', email: null, ultimoAcceso: hace(2), progreso: 63, mensajeUrl: `${MOODLE}/message/index.php?id=910` },
        { id: 911, nombre: 'Beto Prueba', email: null, ultimoAcceso: null, progreso: null, mensajeUrl: `${MOODLE}/message/index.php?id=911` },
      ],
      dudas: [{ consultaId: 31, alumnoId: 910, alumno: 'Ana Prueba', desde: hace(5) }],
      tareas: [
        {
          id: 97, nombre: 'Tarea final', entrega: null, corregirUrl: `${MOODLE}/mod/assign/view.php?id=17&action=grading`,
          sinCorregir: [{ alumnoId: 910, alumno: 'Ana Prueba', entregadaAt: hace(3), corregirUrl: `${MOODLE}/mod/assign/view.php?id=17&action=grader&userid=910` }],
        },
        {
          id: 98, nombre: 'Caso práctico', entrega: null, corregirUrl: `${MOODLE}/mod/assign/view.php?id=18&action=grading`,
          sinCorregir: [
            { alumnoId: 910, alumno: 'Ana Prueba', entregadaAt: hace(60), corregirUrl: `${MOODLE}/mod/assign/view.php?id=18&action=grader&userid=910` },
            { alumnoId: 911, alumno: 'Beto Prueba', entregadaAt: hace(50), corregirUrl: `${MOODLE}/mod/assign/view.php?id=18&action=grader&userid=911` },
          ],
        },
      ],
    }],
    dudasSinCurso: [],
  }],
  pendientes: [{
    id: 5, nombre: 'Diplomado en Neuropsicología', tipo: 'diplomado', estado: 'en_desarrollo', campus: 'ISEIE Madrid',
    fechaComprometida: dentroDeDias(10), avance: { foto: true, video: false, modulos: 50 },
  }],
  sinConectar: [],
});

const pintar = () => render(<MemoryRouter><MiCampusPage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  api.miCampus.mockResolvedValue({ success: true, data: datos() });
  api.mias.mockResolvedValue({ success: true, data: { plazoHoras: 24, consultas: [{
    id: 31, project_id: 1, campus: 'ISEIE Madrid', alumno_nombre: 'Ana Prueba', curso_nombre: 'Máster en Psicología',
    estado: 'abierta', entrada_at: hace(5), espera_desde: hace(5), ultimo_mensaje: '¿Cuándo se entrega la tarea final?', sin_enviar: 0,
  }] } });
});

describe('Mi campus (#408)', () => {
  it('el resumen de arriba: entregas por corregir, dudas sin contestar y cursos por desarrollar', async () => {
    pintar();
    const resumen = await screen.findByTestId('resumen-mi-campus');
    expect(resumen).toHaveTextContent('Hoy tienes 3 entregas por corregir, 1 duda sin contestar y 1 curso por desarrollar.');
  });

  it('por corregir: cada entrega, la más antigua primero, y se corrige desde el CRM', async () => {
    pintar();
    const lista = await screen.findByTestId('por-corregir');
    const enlaces = await within(lista).findAllByRole('link', { name: /Corregir la entrega/ });
    expect(enlaces.map((a) => a.getAttribute('href'))).toEqual([
      '/mis-cursos/campus/tarea/1/50/98?alumno=910',
      '/mis-cursos/campus/tarea/1/50/98?alumno=911',
      '/mis-cursos/campus/tarea/1/50/97?alumno=910',
    ]);
    expect(enlaces[0]).not.toHaveAttribute('target');
  });

  it('por responder: la consulta con su último mensaje, «Responder» ahí mismo y «Abrir»', async () => {
    pintar();
    const lista = await screen.findByTestId('por-responder');
    expect(await within(lista).findByText(/Cuándo se entrega la tarea final/)).toBeInTheDocument();
    expect(within(lista).getByRole('link', { name: 'Abrir' })).toHaveAttribute('href', '/consultas/31');
    expect(within(lista).getByRole('button', { name: 'Responder' })).toBeInTheDocument();
  });

  it('cada alumno con su último acceso y su % hecho; sin dato, «—» y no 0 %', async () => {
    pintar();
    await screen.findByTestId('resumen-mi-campus');
    // El curso con algo que hacer empieza abierto, como antes.
    expect(screen.getByRole('button', { name: /Máster en Psicología/ })).toHaveAttribute('aria-expanded', 'true');
    const filas = screen.getAllByTestId('alumno-campus');
    const de = (n) => filas.find((f) => f.textContent.includes(n));
    expect(within(de('Ana Prueba')).getByTestId('progreso-alumno')).toHaveTextContent('63%');
    expect(de('Ana Prueba')).toHaveTextContent('Hoy');
    expect(within(de('Beto Prueba')).getByTestId('progreso-alumno')).toHaveTextContent('—');
    expect(within(de('Beto Prueba')).getByTestId('progreso-alumno')).not.toHaveTextContent('0%');
    expect(de('Beto Prueba')).toHaveTextContent('Nunca ha entrado');
  });

  it('lo que tiene por desarrollar, con su plazo y su avance', async () => {
    pintar();
    const p = await screen.findByTestId('pendiente-campus');
    expect(p).toHaveTextContent('Diplomado en Neuropsicología');
    expect(p).toHaveTextContent('En desarrollo');
    expect(p).toHaveTextContent('Vence en 10 días');
    expect(within(p).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('sin campus conectado no dice «al día», pero sí los cursos por desarrollar', async () => {
    api.miCampus.mockResolvedValue({ success: true, data: { ...datos(), campus: [] } });
    pintar();
    const resumen = await screen.findByTestId('resumen-mi-campus');
    expect(resumen).toHaveTextContent('Tienes 1 curso por desarrollar.');
    expect(resumen).not.toHaveTextContent('al día');
  });

  it('el campus asignado sin su cuenta de Moodle se dice, con el motivo', async () => {
    api.miCampus.mockResolvedValue({
      success: true,
      data: { ...datos(), sinConectar: [{ projectId: 2, campus: 'ISEIE Bogotá', estado: 'pendiente', motivo: 'No encontramos tu cuenta de Moodle con tu correo del CRM.' }] },
    });
    pintar();
    expect(await screen.findByText(/Campus en los que tu cuenta de Moodle no está conectada/)).toBeInTheDocument();
    expect(screen.getByText(/No encontramos tu cuenta de Moodle/)).toBeInTheDocument();
  });
});
