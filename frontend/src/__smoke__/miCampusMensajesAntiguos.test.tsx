// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * «Mi campus» con TODO lo pendiente (Diego, 24/11/2026: «tienen que tener TODAS las
 * pendientes, no solamente desde que se subió el campus»): los mensajes de Moodle que
 * esperan su respuesta, aunque sean de antes de conectar el campus, salen en su curso con
 * «Responder en Moodle» y cuentan arriba. Y el aviso de la cuenta vinculada se ve.
 * Gemela de la del 360 (frontend/src/test/miCampusMensajesAntiguos.test.tsx).
 */

let datos: any;
vi.mock('@/shared/api/client', () => ({
  default: { get: async () => ({ success: true, data: datos }) },
}));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 7, role: 'tutor' } }) }));
const { default: MiCampusPage } = await import('@/modules/tutores/pages/MiCampusPage');

const mensaje = (id: number, alumno: string) => ({
  conversacionId: id, alumnoId: 900 + id, alumno, desde: '2025-06-25T12:00:00.000Z',
  responderUrl: `https://campus.test/message/index.php?convid=${id}`,
});
const conCampus = (campus: any) => ({
  leidoAt: new Date().toISOString(), pendientes: [], sinConectar: [],
  campus: [{ projectId: 2, campus: 'Psiko', url: '#', error: null, dudasSinCurso: [], ...campus }],
});
const curso = (extra: any = {}) => ({
  id: 30, nombre: 'Curso A', url: '#', error: null, seguimiento: false, avisoProgreso: null,
  alumnos: [], dudas: [], tareas: [], ...extra,
});

const pagina = () => render(<MemoryRouter><MiCampusPage /></MemoryRouter>);
beforeEach(() => { datos = null; });
afterEach(cleanup);

describe('Mi campus · mensajes de Moodle sin responder', () => {
  it('cuentan arriba y salen en su curso, abierto, con «Responder en Moodle»', async () => {
    datos = conCampus({ cursos: [curso({ sinResponder: [mensaje(1, 'Ana')] })] });
    pagina();
    const r = await screen.findByTestId('resumen-mi-campus');
    expect(r.textContent).toBe('Hoy tienes 1 duda sin contestar.');
    expect(screen.getByText('1 mensaje sin responder')).toBeTruthy();
    const enlace = screen.getByRole('link', { name: /Responder en Moodle/ });
    expect(enlace.getAttribute('href')).toBe('https://campus.test/message/index.php?convid=1');
    expect(screen.getByText(/sin responder desde el 25 jun 2025/)).toBeTruthy();
  });

  it('los de quien no está en sus cursos, aparte; y el aviso del campus se ve', async () => {
    datos = conCampus({
      cursos: [curso()],
      sinResponderSinCurso: [mensaje(4, 'Coordinación')],
      aviso: 'El correo apunta a otra cuenta del campus distinta de la vinculada.',
    });
    pagina();
    expect(await screen.findByText(/Mensajes sin responder de quien no está en tus cursos/)).toBeTruthy();
    expect(screen.getByText('Coordinación')).toBeTruthy();
    expect(screen.getByText(/otra cuenta del campus/)).toBeTruthy();
  });

  it('sin los campos nuevos (un servidor de antes), igual que siempre', async () => {
    datos = conCampus({ cursos: [curso()] });
    pagina();
    const r = await screen.findByTestId('resumen-mi-campus');
    expect(r.textContent).toContain('Estás al día');
  });
});
