// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';
despuesDeCada(() => limpiar());
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  Matrículas y «Asignar tutor» (descuadres entre la pantalla y el servidor
  encontrados al escribir el manual, 17/11/2026; gemela de CRM#842). Cada
  perfil lleva el mapa de serie del servidor (`resolverPermisos`).
  «Avisar tutor» (Comisiones de tutores) no va en ISEIE.
*/

const h = vi.hoisted(() => ({ user: null, permissions: null, get: null, tutores: {} }));
h.get = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: h.user, permissions: h.permissions }) }));
const CAMPUS = vi.hoisted(() => [{ id: 1, nombre: 'Psiko' }]);
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 1, nombre: 'Psiko' }, projects: CAMPUS, activeIssuer: null, activeIssuerId: null }),
}));
vi.mock('@/shared/hooks/useAmbito', () => ({ useProyectosDelAmbito: () => CAMPUS, useIdsDelAmbito: () => [1] }));
vi.mock('@/shared/api/client', () => ({ default: { get: (...a) => h.get(...a), post: vi.fn(), patch: vi.fn() }, API_BASE_URL: '/crm/api' }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/modules/tutores/api/tutores.api', () => ({
  tutoresApi: new Proxy({}, { get: (_t, k) => h.tutores[k] || (async () => ({ success: true, data: [] })) }),
}));
vi.mock('@/modules/tutores/components/Entregables', () => ({ default: () => null }));
vi.mock('@/modules/tutores/components/ConsultasDelTutor', () => ({ default: () => null }));
vi.mock('@/modules/tutores/components/LoQueFactura', () => ({ default: () => null }));

const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
const { default: MatriculasPage } = await import('@/modules/matriculas/pages/MatriculasPage');
const { default: TutoresPage } = await import('@/modules/tutores/pages/TutoresPage');

function como(role, excepciones = {}) {
  h.user = { id: 5, role, roles_extra: [] };
  h.permissions = resolverPermisos({ role, roles_extra: [], excepciones }).mapa;
}
const esperar = () => act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });

beforeEach(() => {
  vi.clearAllMocks();
  h.tutores = {};
  h.get.mockResolvedValue({ success: true, data: [], stats: { total: 0 } });
});

describe('Matrículas: validar y rechazar, con `matriculas.cambiar_estado`', () => {
  const MATRICULA = { id: 5, estado: 'solicitud_admision', lead_nombre: 'Alumna Prueba', project_id: 1, documentos: [] };
  const abrirFicha = async () => {
    h.get.mockImplementation(async (url) => (String(url).startsWith('/matriculas/5')
      ? { success: true, data: MATRICULA }
      : { success: true, data: [], stats: { total: 0 } }));
    render(<MemoryRouter initialEntries={['/matriculas?matricula=5']}><MatriculasPage /></MemoryRouter>);
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/matriculas/5'));
    await esperar();
  };

  it('soporte, que lo trae de serie, ve «Validar datos» y «Rechazar» (antes se miraba el rol)', async () => {
    como('soporte');
    await abrirFicha();
    expect(await screen.findByRole('button', { name: /Validar datos/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Rechazar/ })).toBeTruthy();
  });

  it('el admin al que se le quita, no (el servidor le daría 403)', async () => {
    como('admin', { 'matriculas.cambiar_estado': false });
    await abrirFicha();
    expect(screen.queryByRole('button', { name: /Validar datos/ })).toBeNull();
  });
});

describe('«Asignar tutor» desde Formaciones sin tutor: la formación ya va elegida', () => {
  afterEach(() => { window.history.pushState({}, '', '/'); });

  it('con ?formacion=ID, «Añadir formación» abre con esa formación', async () => {
    como('admin');
    window.history.pushState({}, '', '/tutores?formacion=11');
    h.tutores.listar = async () => ({ success: true, data: [
      { id: 3, nombre: 'Tutora Prueba', email: 'tutora@prueba.local', iban: 'ES00', active: true, es_de_este_proyecto: true, formaciones: 0 },
    ] });
    h.tutores.ajustes = async () => ({ success: true, data: { aplica_desde: '2026-08-01', pct_por_defecto: 10 } });
    h.get.mockImplementation(async (url) => ({ success: true, data: String(url).startsWith('/products') ? [{ id: 11, nombre: 'Curso Prueba', precio: 100 }] : [] }));
    const { container } = render(<TutoresPage />);
    await esperar();
    fireEvent.click(screen.getAllByText('Tutora Prueba')[0]);
    await esperar();
    fireEvent.click(screen.getByRole('button', { name: /Añadir formación/ }));
    await esperar();
    expect(container.querySelector('input[name="productId"]').value).toBe('11');
  });

  it('sin el parámetro, abre vacío como siempre', async () => {
    como('admin');
    h.tutores.listar = async () => ({ success: true, data: [
      { id: 3, nombre: 'Tutora Prueba', email: 'tutora@prueba.local', iban: 'ES00', active: true, es_de_este_proyecto: true, formaciones: 0 },
    ] });
    const { container } = render(<TutoresPage />);
    await esperar();
    fireEvent.click(screen.getAllByText('Tutora Prueba')[0]);
    await esperar();
    fireEvent.click(screen.getByRole('button', { name: /Añadir formación/ }));
    expect(container.querySelector('input[name="productId"]').value).toBe('');
  });
});
