// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

/*
  Consultas de alumnos, fase 1 (#187): en la ficha del tutor se ve en qué campus
  atiende (por campus o por empresa entera), su matrícula en cada campus y
  «No disponible»; y se puede dar una empresa, un campus o comprobar.
*/

const api = vi.hoisted(() => ({
  ver: vi.fn(), asignarCampus: vi.fn(), asignarEmpresa: vi.fn(), quitarEmpresa: vi.fn(),
  comprobar: vi.fn(), disponible: vi.fn(), toast: vi.fn(),
}));
vi.mock('@/modules/tutores/api/campusTutor.api', () => ({ campusTutorApi: api }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: api.toast }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({
    projects: [
      { id: 1, nombre: 'ISEIE Madrid', sociedad_emisora_id: 10, sociedad_nombre: 'CEDIA' },
      { id: 3, nombre: 'ISEIE Bogotá', sociedad_emisora_id: 10, sociedad_nombre: 'CEDIA' },
      { id: 2, nombre: 'ICTESS', sociedad_emisora_id: 20, sociedad_nombre: 'ICTESS SL' },
    ],
  }),
}));

import ConsultasDelTutor from '@/modules/tutores/components/ConsultasDelTutor';

afterEach(cleanup);

const panel = (extra = {}) => ({
  campus: [
    { project_id: 1, campus: 'ISEIE Madrid', via: 'campus', issuer_id: 10, empresa: 'CEDIA', campus_conectado: true, estado: 'activa', comprobado_at: '2026-10-18T10:00:00Z', error: null },
    { project_id: 3, campus: 'ISEIE Bogotá', via: 'empresa', issuer_id: 10, empresa: 'CEDIA', campus_conectado: true, estado: 'pendiente', comprobado_at: '2026-10-18T10:00:00Z', error: null },
    { project_id: 2, campus: 'ICTESS', via: 'campus', issuer_id: 20, empresa: 'ICTESS SL', campus_conectado: false, estado: null, comprobado_at: null, error: null },
  ],
  empresas: [{ issuer_id: 10, empresa: 'CEDIA', campus: 2, created_at: '2026-10-18' }],
  disponible: true, motivo_no_disponible: null, no_disponible_desde: null, avisos: [],
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.ver.mockResolvedValue({ success: true, data: panel() });
});

describe('Consultas del tutor (#187)', () => {
  it('cada campus con cómo le llega y su matrícula en el campus', async () => {
    render(<ConsultasDelTutor tutorId={7} puedeGestionar />);
    expect(await screen.findByText('Consultas de alumnos')).toBeTruthy();
    expect(screen.getByText('Matriculado')).toBeTruthy();
    expect(screen.getByText('Pendiente de matrícula')).toBeTruthy();
    expect(screen.getByText('Campus sin conectar')).toBeTruthy();
    expect(screen.getByText('Por la empresa CEDIA')).toBeTruthy();
    expect(screen.getAllByText('Campus asignado')).toHaveLength(2);
    expect(screen.getByText(/CEDIA · 2 campus/)).toBeTruthy();
  });

  it('dar una empresa entera llama al servidor y enseña lo que no cuadra en el campus', async () => {
    api.asignarEmpresa.mockResolvedValue({ success: true, data: panel({
      avisos: ['ICTESS: su correo no es usuario del campus. Queda pendiente de matrícula y no recibirá consultas de ese campus hasta que lo den de alta allí.'],
    }) });
    render(<ConsultasDelTutor tutorId={7} puedeGestionar />);
    await screen.findByText('Consultas de alumnos');
    // CEDIA ya la tiene: solo se ofrece ICTESS SL.
    fireEvent.click(screen.getByRole('combobox', { name: 'Añadir una empresa entera' }));
    expect(screen.queryByRole('option', { name: 'CEDIA' })).toBeNull();
    fireEvent.mouseDown(screen.getByRole('option', { name: 'ICTESS SL' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Añadir' })[1]);
    await waitFor(() => expect(api.asignarEmpresa).toHaveBeenCalledWith(7, 20));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/pendiente de matrícula/);
  });

  it('solo ofrece los campus que aún no tiene', async () => {
    render(<ConsultasDelTutor tutorId={7} puedeGestionar />);
    await screen.findByText('Consultas de alumnos');
    fireEvent.click(screen.getByRole('combobox', { name: 'Añadir un campus' }));
    expect(screen.queryAllByRole('option').map((o) => o.textContent)).toEqual(['Elige el campus…']);
  });

  it('«No disponible» con su motivo, y volver', async () => {
    api.disponible.mockResolvedValue({ success: true, data: panel({ disponible: false, motivo_no_disponible: 'Vacaciones' }) });
    render(<ConsultasDelTutor tutorId={7} puedeGestionar />);
    await screen.findByText('Consultas de alumnos');
    fireEvent.change(screen.getByLabelText('Motivo de no disponible'), { target: { value: 'Vacaciones' } });
    fireEvent.click(screen.getByRole('button', { name: 'Marcar no disponible' }));
    await waitFor(() => expect(api.disponible).toHaveBeenCalledWith(7, false, 'Vacaciones'));
    expect(await screen.findByText(/No disponible · Vacaciones/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Volver a disponible' })).toBeTruthy();
  });

  it('sin permiso de gestión, solo se ve: ni botones ni desplegables', async () => {
    render(<ConsultasDelTutor tutorId={7} puedeGestionar={false} />);
    await screen.findByText('Consultas de alumnos');
    expect(screen.queryByRole('button', { name: /Comprobar|Añadir|Marcar/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
