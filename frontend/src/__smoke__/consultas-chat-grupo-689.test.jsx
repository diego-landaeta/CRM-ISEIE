// @vitest-environment jsdom
// Traída de MultiCRM. ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';

despuesDeCada(limpiar);
if (typeof window !== 'undefined') {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
}
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/*
  Una consulta que viene de un chat de grupo (plugin del CRM 1.9.0, PR #689 parte 1):
  arriba se dice de qué chat es y quién está dentro; y si es la conversación de un grupo
  del curso, encima de la respuesta se avisa de que la leen TODOS sus alumnos (revisión
  de la #689: obligatorio). Una consulta privada no enseña nada de esto.
*/

const api = vi.hoisted(() => ({
  ver: vi.fn(), responder: vi.fn(), reintentar: vi.fn(), cerrar: vi.fn(), tutoresPosibles: vi.fn(),
  reasignar: vi.fn(), abrirAdjunto: vi.fn(), toast: vi.fn(),
  // La bandeja, la ficha del alumno y las respuestas guardadas (#679): vacías aquí.
  mias: vi.fn(async () => ({ success: true, data: { consultas: [], plazoHoras: 24 } })),
  panel: vi.fn(async () => ({ success: true, data: { consultas: [], plazoHoras: 24 } })),
  contexto: vi.fn(async () => ({ success: true, data: null })),
  respuestas: vi.fn(async () => ({ success: true, data: [] })),
  importarRespuestas: vi.fn(async () => ({ success: true, data: { importadas: 0, respuestas: [] } })),
  user: { userId: 7, role: 'tutor' },
}));
vi.mock('@/modules/consultas/api/consultas.api', async (original) => {
  const real = await original();
  return { ...real, consultasApi: api };
});
vi.mock('@/shared/hooks/useToast', () => ({ toast: api.toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: api.user }) }));

import ConsultaPage from '@/modules/consultas/pages/ConsultaPage';

const detalle = (extra = {}) => ({
  id: 5, project_id: 1, campus: 'Psiko', empresa: 'CEDIA', alumno_nombre: 'Alumna Uno', alumno_email: 'a@campus.es',
  curso_nombre: 'Curso de prueba', tutor_id: 7, tutor: 'Tutora', estado: 'abierta', entrada_at: new Date().toISOString(),
  espera_desde: new Date().toISOString(), ultimo_mensaje: 'Hola', sin_enviar: 0, asignada_at: null, primera_lectura_at: null,
  primera_respuesta_at: null, cerrada_at: null, reabierta_at: null, plazoHoras: 24, puedes: 'tutor', eventos: [],
  mensajes: [{ id: 1, autor: 'alumno', autor_nombre: null, texto: 'Hola', escrito_at: new Date().toISOString(),
    enviado_campus_at: null, error_envio: null, en_el_campus: true, adjuntos: [] }],
  ...extra,
});

const participantes = [
  { id: 900, nombre: 'Alumna Uno', tutora: false, alumno: true },
  { id: 701, nombre: 'Laura', tutora: true, alumno: false },
  { id: 702, nombre: 'Carmen', tutora: true, alumno: false },
];

const enLaFicha = () => render(
  <MemoryRouter initialEntries={['/consultas/5']}>
    <Routes><Route path="/consultas/:id" element={<ConsultaPage />} /></Routes>
  </MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); });

describe('Consultas · chat de grupo (#679, PR #689)', () => {
  it('el chat del alumno con las tutoras: dice quién está dentro, sin el aviso de privacidad', async () => {
    api.ver.mockResolvedValue({ success: true, data: detalle({ conversacion_grupo_id: 44, grupo_tipo: 'plugin', participantes }) });
    enLaFicha();
    const nota = await screen.findByTestId('chat-de-grupo');
    expect(nota.textContent).toMatch(/Chat de grupo/);
    expect(nota.textContent).toMatch(/Laura, Carmen y Alumna Uno/);
    expect(screen.queryByTestId('aviso-grupo-del-curso')).toBeNull();
  });

  it('la conversación de un grupo del curso: avisa encima de la respuesta de que la leen todos', async () => {
    api.ver.mockResolvedValue({ success: true, data: detalle({ conversacion_grupo_id: 45, grupo_tipo: 'curso', participantes: participantes.slice(0, 2) }) });
    enLaFicha();
    expect((await screen.findByTestId('chat-de-grupo')).textContent).toMatch(/Grupo del curso · tutoras dentro: Laura/);
    expect(screen.getByTestId('aviso-grupo-del-curso').textContent).toMatch(/Lo leen todos los alumnos del grupo/);
  });

  it('una consulta privada no dice nada de grupos', async () => {
    api.ver.mockResolvedValue({ success: true, data: detalle() });
    enLaFicha();
    await screen.findByText('Hola', { selector: 'p' });
    expect(screen.queryByTestId('chat-de-grupo')).toBeNull();
    expect(screen.queryByTestId('aviso-grupo-del-curso')).toBeNull();
  });
});
