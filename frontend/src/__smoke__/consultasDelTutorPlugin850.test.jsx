// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

/*
  #850: en la ficha del tutor, «Responder en su nombre» decía «ICTESS: falta su token»
  aunque ICTESS va por el plugin y la respuesta ya sale en su nombre sin su token.
  Con el campus por el plugin no se avisa de que falta ni se ofrece para poner token.
*/

const api = vi.hoisted(() => ({ ver: vi.fn(), tokensDelTutor: vi.fn(), guardarToken: vi.fn(), toast: vi.fn() }));
vi.mock('@/modules/tutores/api/campusTutor.api', () => ({ campusTutorApi: { ver: api.ver } }));
vi.mock('@/modules/consultas/api/consultas.api', () => ({
  consultasApi: { tokensDelTutor: api.tokensDelTutor, guardarToken: api.guardarToken },
}));
vi.mock('@/shared/hooks/useToast', () => ({ toast: api.toast }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ projects: [] }) }));

import ConsultasDelTutor from '@/modules/tutores/components/ConsultasDelTutor';

afterEach(cleanup);

const campus = (project_id, nombre) => ({
  project_id, campus: nombre, via: 'campus', issuer_id: 10, empresa: 'CEDIA', campus_conectado: true,
  estado: 'activa', comprobado_at: '2026-11-18T10:00:00Z', error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.ver.mockResolvedValue({ success: true, data: {
    campus: [campus(7, 'ICTESS'), campus(1, 'ISEIE Madrid')], empresas: [],
    disponible: true, motivo_no_disponible: null, no_disponible_desde: null, avisos: [],
  } });
});

describe('Ficha del tutor: campus por el plugin (#850)', () => {
  it('el campus por el plugin no dice «falta su token» ni se ofrece para poner token', async () => {
    api.tokensDelTutor.mockResolvedValue({ success: true, data: [
      { project_id: 7, campus: 'ICTESS', estado: 'activa', tiene_token: false, por_plugin: true },
      { project_id: 1, campus: 'ISEIE Madrid', estado: 'activa', tiene_token: false, por_plugin: false },
    ] });
    render(<ConsultasDelTutor tutorId={173} puedeGestionar />);
    expect(await screen.findByText('ICTESS: responde por el plugin')).toBeTruthy();
    expect(screen.queryByText('ICTESS: falta su token')).toBeNull();
    // El que no va por el plugin sigue pidiendo su token, como siempre.
    expect(screen.getByText('ISEIE Madrid: falta su token')).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox', { name: 'Campus del token' }));
    expect(screen.queryAllByRole('option').map((o) => o.textContent)).toEqual(['Elige el campus…', 'ISEIE Madrid']);
  });

  it('si todos sus campus van por el plugin, no se pide ningún token', async () => {
    api.tokensDelTutor.mockResolvedValue({ success: true, data: [
      { project_id: 7, campus: 'ICTESS', estado: 'activa', tiene_token: false, por_plugin: true },
    ] });
    render(<ConsultasDelTutor tutorId={173} puedeGestionar />);
    expect(await screen.findByText('ICTESS: responde por el plugin')).toBeTruthy();
    expect(screen.queryByText(/falta su token/)).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Campus del token' })).toBeNull();
    expect(screen.queryByLabelText('Token del tutor en ese campus')).toBeNull();
  });
});
