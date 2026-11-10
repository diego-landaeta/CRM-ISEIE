// @vitest-environment jsdom
// Traída de MultiCRM (2.6.0). ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';

despuesDeCada(limpiar);
if (typeof window !== 'undefined') {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/*
  Consultas de alumnos, fase 4 (#190): el historial de la consulta dice, con
  palabras, el recordatorio al tutor y el aviso de fuera de plazo (y que la
  empezó el tutor, de la #189).
*/

const api = vi.hoisted(() => ({ ver: vi.fn(), tutoresPosibles: vi.fn(), toast: vi.fn(), user: { role: 'admin' } }));
vi.mock('@/modules/consultas/api/consultas.api', async (original) => {
  const real = await original();
  return { ...real, consultasApi: api };
});
vi.mock('@/shared/hooks/useToast', () => ({ toast: api.toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: api.user }) }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 1, nombre: 'Psiko' }, activeIssuerId: null }),
}));

import ConsultaPage from '@/modules/consultas/pages/ConsultaPage';

const hace = (h) => new Date(Date.now() - h * 3600_000).toISOString();

describe('#190 · el historial de la consulta', () => {
  it('nombra el recordatorio de plazo, el fuera de plazo y la que empezó el tutor', async () => {
    api.tutoresPosibles.mockResolvedValue({ success: true, data: [] });
    api.ver.mockResolvedValue({ success: true, data: {
      id: 5, project_id: 1, campus: 'Psiko', empresa: 'CEDIA', alumno_nombre: 'Alumna Uno', alumno_email: null,
      curso_nombre: null, tutor_id: 7, tutor: 'Tutora', estado: 'abierta', entrada_at: hace(30), espera_desde: hace(30),
      ultimo_mensaje: null, sin_enviar: 0, asignada_at: null, primera_lectura_at: null, primera_respuesta_at: null,
      cerrada_at: null, reabierta_at: null, plazoHoras: 24, puedes: 'admin', mensajes: [],
      eventos: [
        { tipo: 'iniciada_por_tutor', at: hace(40), quien: 'Tutora', detalle: null },
        { tipo: 'recordatorio_plazo', at: hace(12), quien: null, detalle: { horas: 18 } },
        { tipo: 'fuera_de_plazo', at: hace(6), quien: null, detalle: { horas: 24 } },
      ],
    } });
    render(
      <MemoryRouter initialEntries={['/consultas/5']}>
        <Routes><Route path="/consultas/:id" element={<ConsultaPage />} /></Routes>
      </MemoryRouter>);
    expect(await screen.findByText(/Recordatorio al tutor: se acerca el plazo/)).toBeTruthy();
    expect(screen.getByText(/Fuera de plazo: avisada administración/)).toBeTruthy();
    expect(screen.getByText(/La empezó el tutor/)).toBeTruthy();
    expect(screen.queryByText(/recordatorio_plazo|fuera_de_plazo|iniciada_por_tutor/)).toBeNull();
  });
});
