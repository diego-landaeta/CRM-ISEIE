// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

/*
  #187 · «Al asignar un proyecto, comprobar en el campus que el email del tutor
  es usuario. Si no lo es, la asignación queda pendiente de matrícula y sale un
  aviso en pantalla.» Al dar de alta un tutor, el servidor ya lo comprueba y
  devuelve los avisos: la pantalla tiene que enseñarlos.
*/

const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: avisos.toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'superadmin' } }) }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 1 }, projects: [{ id: 1, nombre: 'ISEIE' }], activeIssuer: null, activeIssuerId: null }),
}));
const CAMPUS = vi.hoisted(() => [{ id: 1, nombre: 'ISEIE' }]);
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn(() => Promise.resolve({ success: true, data: [] })) } }));
vi.mock('@/modules/tutores/components/Entregables', () => ({ default: () => null }));
vi.mock('@/modules/tutores/components/ConsultasDelTutor', () => ({ default: () => null }));
// En ISEIE el aviso del cambio de correo vive en shared/lib/credenciales.
vi.mock('@/modules/tutores/api/tutores.api', () => ({
  tutoresApi: {
    listar: vi.fn().mockResolvedValue({ success: true, data: [] }),
    colaboraciones: vi.fn().mockResolvedValue({ success: true, data: [] }),
    ajustes: vi.fn().mockResolvedValue({ success: true, data: { aplica_desde: '2026-08-01', pct_por_defecto: 10 } }),
    alta: vi.fn().mockResolvedValue({ success: true, data: {
      id: 9, entraYa: true,
      avisosDelCampus: ['ISEIE: su correo no es usuario del campus. Queda pendiente de matrícula y no recibirá consultas de ese campus hasta que lo den de alta allí.'],
    } }),
    crearColaboracion: vi.fn(),
  },
}));

import TutoresPage from '@/modules/tutores/pages/TutoresPage';

afterEach(cleanup);

const esperar = () => act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });

describe('Nuevo tutor (#187)', () => {
  beforeEach(() => { avisos.toast.mockClear(); });

  it('si su correo no es usuario del campus, el alta lo dice', async () => {
    const { container } = render(<TutoresPage />);
    await esperar();
    fireEvent.click(screen.getByRole('button', { name: /Nuevo tutor/ }));
    const form = container.querySelector('input[name="nombre"]').closest('form');
    fireEvent.change(form.querySelector('input[name="nombre"]'), { target: { value: 'Ana Tutora' } });
    fireEvent.change(form.querySelector('input[name="email"]'), { target: { value: 'ana@prueba.local' } });
    await act(async () => { fireEvent.submit(form); });
    await esperar();
    expect(avisos.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Revisa la matrícula en el campus',
      description: expect.stringMatching(/pendiente de matrícula/),
    }));
  });
});
