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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/*
  Consultas de alumnos, fase 2 (#188): la bandeja del tutor, el panel de
  administración y una consulta (responder con adjuntos, reintentar, reasignar).
*/

const api = vi.hoisted(() => ({
  mias: vi.fn(), panel: vi.fn(), ver: vi.fn(), responder: vi.fn(), reintentar: vi.fn(), cerrar: vi.fn(),
  tutoresPosibles: vi.fn(), reasignar: vi.fn(), leerAhora: vi.fn(), abrirAdjunto: vi.fn(), toast: vi.fn(),
  campusSinTutor: vi.fn(),
  user: { role: 'tutor' },
}));
vi.mock('@/modules/consultas/api/consultas.api', async (original) => {
  const real = await original();
  return { ...real, consultasApi: api };
});
vi.mock('@/shared/hooks/useToast', () => ({ toast: api.toast }));
// El mapa de permisos del servidor (#423): los de serie de sus roles.
vi.mock('@/contexts/AuthContext', async () => {
  const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
  const mapa = (u) => (u ? resolverPermisos({ role: u.role, roles_extra: u.roles_extra || [], excepciones: {} }).mapa : null);
  return { useAuth: () => ({ user: api.user, permissions: mapa(api.user) }) };
});
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 1, nombre: 'Psiko' }, activeIssuerId: null }),
}));

import { semaforo } from '@/modules/consultas/api/consultas.api';
import ConsultasPage from '@/modules/consultas/pages/ConsultasPage';
import ConsultaPage from '@/modules/consultas/pages/ConsultaPage';

const horasAtras = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const fila = (extra = {}) => ({
  id: 5, project_id: 1, campus: 'Psiko', empresa: 'CEDIA', alumno_nombre: 'Alumna Uno', alumno_email: 'a@campus.es',
  curso_nombre: 'Curso de prueba', tutor_id: 7, tutor: 'Tutora', estado: 'abierta', entrada_at: horasAtras(20),
  espera_desde: horasAtras(20), ultimo_mensaje: 'No encuentro el tema 3', sin_enviar: 0,
  asignada_at: null, primera_lectura_at: null, primera_respuesta_at: null, cerrada_at: null, reabierta_at: null, ...extra,
});
const detalle = (extra = {}) => ({
  ...fila(), plazoHoras: 24, puedes: 'tutor', eventos: [{ tipo: 'entrada', at: horasAtras(20), quien: null, detalle: null }],
  mensajes: [{ id: 1, autor: 'alumno', autor_nombre: null, texto: 'No encuentro el tema 3', escrito_at: horasAtras(20),
    enviado_campus_at: null, error_envio: null, en_el_campus: true, adjuntos: [] }],
  ...extra,
});

const enLaFicha = () => render(
  <MemoryRouter initialEntries={['/consultas/5']}>
    <Routes><Route path="/consultas/:id" element={<ConsultaPage />} /></Routes>
  </MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  api.user = { role: 'tutor' };
  api.mias.mockResolvedValue({ success: true, data: { consultas: [fila()], plazoHoras: 24 } });
  api.panel.mockResolvedValue({ success: true, data: { consultas: [fila({ tutor: null, tutor_id: null })], plazoHoras: 24 } });
  api.ver.mockResolvedValue({ success: true, data: detalle() });
  api.campusSinTutor.mockResolvedValue({ success: true, data: [] });
  api.tutoresPosibles.mockResolvedValue({ success: true, data: [{ id: 7, nombre: 'Tutora' }, { id: 8, nombre: 'Otro tutor' }] });
});

describe('el semáforo del plazo (24 h)', () => {
  it('verde, ámbar desde las 3/4 partes, rojo pasado el plazo; las respondidas no esperan', () => {
    expect(semaforo({ estado: 'abierta', espera_desde: horasAtras(2), entrada_at: horasAtras(2) }, 24).color).toBe('verde');
    expect(semaforo({ estado: 'abierta', espera_desde: horasAtras(20), entrada_at: horasAtras(20) }, 24).color).toBe('ambar');
    expect(semaforo({ estado: 'abierta', espera_desde: horasAtras(30), entrada_at: horasAtras(30) }, 24).color).toBe('rojo');
    expect(semaforo({ estado: 'respondida', espera_desde: null, entrada_at: horasAtras(30) }, 24)).toBeNull();
  });
});

describe('Consultas (#188) · la lista', () => {
  it('sin permiso (gestora) dice que no tiene acceso, no «Nada pendiente», y no pide nada', async () => {
    api.user = { role: 'gestor' };
    render(<MemoryRouter><ConsultasPage /></MemoryRouter>);
    expect(await screen.findByText('No tienes acceso a las consultas de alumnos')).toBeTruthy();
    expect(screen.queryByText('Nada pendiente')).toBeNull();
    expect(api.mias).not.toHaveBeenCalled();
    expect(api.panel).not.toHaveBeenCalled();
  });

  it('el tutor ve su bandeja: sus pendientes, con el semáforo', async () => {
    render(<MemoryRouter><ConsultasPage /></MemoryRouter>);
    expect(await screen.findByText('Alumna Uno')).toBeTruthy();
    expect(api.mias).toHaveBeenCalledWith(expect.objectContaining({ estado: 'pendientes' }));
    expect(api.panel).not.toHaveBeenCalled();
    expect(screen.getByText(/Cerca del plazo/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Leer el campus ahora/ })).toBeNull();
  });

  it('administración ve el panel del campus de arriba, con «Solo sin tutor» y «Leer el campus ahora»', async () => {
    api.user = { role: 'admin' };
    render(<MemoryRouter><ConsultasPage /></MemoryRouter>);
    expect(await screen.findByText(/Sin tutor/)).toBeTruthy();
    expect(api.panel).toHaveBeenCalledWith({ projectId: 1, issuerId: null }, expect.objectContaining({ estado: 'pendientes' }));
    fireEvent.click(screen.getByLabelText('Solo sin tutor'));
    await waitFor(() => expect(api.panel).toHaveBeenLastCalledWith({ projectId: 1, issuerId: null }, expect.objectContaining({ sinTutor: true })));
    expect(screen.getByRole('button', { name: /Leer el campus ahora/ })).toBeTruthy();
  });
});

describe('Consultas (#188) · una consulta', () => {
  it('responder vacío dice qué falta; con texto y un adjunto, lo envía', async () => {
    api.responder.mockResolvedValue({ success: true, data: { enviado: true, error: null, consulta: detalle({ estado: 'respondida' }) } });
    enLaFicha();
    await screen.findByText('No encuentro el tema 3', { selector: 'p' });
    fireEvent.click(screen.getByRole('button', { name: /Responder/ }));
    expect(await screen.findByText('Falta la respuesta: escríbela aquí.')).toBeTruthy();
    expect(api.responder).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Tu respuesta/), { target: { value: 'Está en la sección 2.' } });
    const pdf = new File(['%PDF'], 'temario.pdf', { type: 'application/pdf' });
    fireEvent.change(document.getElementById('consulta-adjuntos'), { target: { files: [pdf] } });
    expect(screen.getByText('temario.pdf')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Responder/ }));
    await waitFor(() => expect(api.responder).toHaveBeenCalledWith(5, 'Está en la sección 2.', [pdf]));
    expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Respuesta enviada' }));
  });

  it('una respuesta que no llegó al campus dice por qué y se puede reintentar', async () => {
    api.ver.mockResolvedValue({ success: true, data: detalle({ mensajes: [
      { id: 2, autor: 'tutor', autor_nombre: 'Tutora', texto: 'Mira la sección 2', escrito_at: horasAtras(1),
        enviado_campus_at: null, error_envio: 'Falta el token del tutor en este campus', en_el_campus: false, adjuntos: [] },
    ] }) });
    api.reintentar.mockResolvedValue({ success: true, data: { enviado: true } });
    enLaFicha();
    expect(await screen.findByText(/No ha llegado al campus: Falta el token del tutor/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    await waitFor(() => expect(api.reintentar).toHaveBeenCalledWith(2));
  });

  it('administración reasigna (a otro, no al mismo) y no responde', async () => {
    api.user = { role: 'admin' };
    api.ver.mockResolvedValue({ success: true, data: detalle({ puedes: 'admin' }) });
    api.reasignar.mockResolvedValue({ success: true, data: detalle({ puedes: 'admin', tutor_id: 8 }) });
    enLaFicha();
    await screen.findByText('Alumna Uno');
    expect(screen.queryByLabelText(/^Tu respuesta/)).toBeNull();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Reasignar a otro tutor' }));
    expect(screen.queryByRole('option', { name: 'Tutora' })).toBeNull();
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Otro tutor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reasignar' }));
    await waitFor(() => expect(api.reasignar).toHaveBeenCalledWith(5, 8));
  });
});

// «Consultas con la empresa o Todos en la cabecera» (MultiCRM) no aplica: ISEIE no
// tiene el muro de «elige un campus» en AppLayout (ni pathAllowsAll ni rutaAceptaSociedad).

describe('Consultas (#188) · lo que salió en la revisión final (18/10)', () => {
  it('reintentar que vuelve a fallar no dice «enviada»: dice por qué', async () => {
    api.ver.mockResolvedValue({ success: true, data: detalle({ mensajes: [
      { id: 2, autor: 'tutor', autor_nombre: 'Tutora', texto: 'Mira la sección 2', escrito_at: horasAtras(1),
        enviado_campus_at: null, error_envio: 'Falta el token del tutor en este campus', en_el_campus: false, adjuntos: [] },
    ] }) });
    api.reintentar.mockResolvedValue({ success: true, data: { enviado: false, error: 'Falta el token del tutor en este campus' } });
    enLaFicha();
    fireEvent.click(await screen.findByRole('button', { name: /Reintentar/ }));
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Sigue sin llegar al campus', description: 'Falta el token del tutor en este campus', variant: 'destructive',
    })));
    expect(api.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Respuesta enviada al campus' }));
  });

  it('si falla la lista de tutores, la consulta se ve igual', async () => {
    api.user = { role: 'admin' };
    api.ver.mockResolvedValue({ success: true, data: detalle({ puedes: 'admin' }) });
    api.tutoresPosibles.mockRejectedValue(new Error('caído'));
    enLaFicha();
    expect(await screen.findByText('Alumna Uno')).toBeTruthy();
    expect(screen.getByText('No encuentro el tema 3', { selector: 'p' })).toBeTruthy();
  });

  it('el buscador espera a que se deje de escribir, y una respuesta vieja no pisa a la nueva', async () => {
    let soltarVieja;
    api.mias.mockImplementation((f) => (f.buscar === 'An'
      ? new Promise((r) => { soltarVieja = () => r({ success: true, data: { consultas: [fila({ id: 9, alumno_nombre: 'Vieja' })], plazoHoras: 24 } }); })
      : Promise.resolve({ success: true, data: { consultas: [fila({ id: 10, alumno_nombre: 'Ana Nueva' })], plazoHoras: 24 } })));
    render(<MemoryRouter><ConsultasPage /></MemoryRouter>);
    const caja = await screen.findByLabelText('Buscar alumno, correo o curso');
    fireEvent.change(caja, { target: { value: 'An' } });
    await waitFor(() => expect(api.mias).toHaveBeenCalledWith(expect.objectContaining({ buscar: 'An' })), { timeout: 1500 });
    fireEvent.change(caja, { target: { value: 'Ana' } });
    expect(await screen.findByText('Ana Nueva', {}, { timeout: 1500 })).toBeTruthy();
    soltarVieja();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Vieja')).toBeNull();
    // «A», «An», «Ana» seguidos no son tres peticiones: cada búsqueda espera un momento.
    expect(api.mias.mock.calls.filter(([f]) => f.buscar === 'A')).toHaveLength(0);
  });

  it('soporte como rol de más no ve el panel de administración (el servidor no se lo deja)', async () => {
    api.user = { role: 'tutor', roles_extra: ['soporte'] };
    render(<MemoryRouter><ConsultasPage /></MemoryRouter>);
    await waitFor(() => expect(api.mias).toHaveBeenCalled());
    expect(api.panel).not.toHaveBeenCalled();
    expect(screen.queryByRole('tab', { name: 'Todas' })?.closest('[aria-label="Qué consultas"]')).toBeFalsy();
  });
});
