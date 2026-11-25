// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, renderHook } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/*
  Diego, 25/11/2026 (máxima prioridad): «a Raquel no le funcionan los filtros de
  las gestoras al reasignar o filtrar».

  Raquel (ISEIE, user 5) es «Líder de equipo» desde el 24/11 (ISEIE#761). El
  servidor ya le daba su equipo en `GET /users?alcance=comercial` (permiso
  `equipos.su_equipo`), pero las pantallas solo pedían la lista si el rol
  PRINCIPAL era admin o superadmin:
    · la ficha del prospecto le enseñaba «Reasignar» (`leads.assign`) con el
      desplegable VACÍO (LeadDetailPage.tsx:120-128);
    · Prospectos, Ventas, Clientes, la Cola y Wasapi no le enseñaban el filtro
      de gestora (LeadsPage.tsx:399, LeadsFiltersBar.tsx:117/319…).

  Ahora se decide por permiso y alcance (`veListaDeGestoras`): la misma tabla,
  rol por rol, que la prueba del servidor `listasDeGestorasPorRol.test.js` (backend/tests).
*/

const sesion = vi.hoisted(() => ({ user: null, permissions: null, alcanceComercial: null, projects: [] }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const ficha = vi.hoisted(() => ({ reassign: vi.fn() }));

vi.mock('@/shared/api/client', () => ({ default: api, API_BASE_URL: '/api', getAccessToken: () => 't' }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => sesion }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 4, nombre: 'ISEIE' }, projects: [{ id: 4, nombre: 'ISEIE' }], activeIssuerId: null }),
}));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'light' }));

// La ficha del prospecto, con lo que no importa aquí apagado.
// El mismo objeto en cada pintada, como el hook de verdad (uno nuevo cada vez
// relanzaría los efectos que dependen de él).
const detalle = vi.hoisted(() => ({
  lead: { id: 900, nombre: 'Prospecto Uno', email: 'p@x.test', status: 'nuevo', project_id: 4, responsable_id: 12, responsable_nombre: 'Malena' },
  timeline: [], interacciones: [], reminders: [], utms: null, loading: false, error: null, refetch: () => {},
  updateStatus: () => {}, addInteraction: () => {}, addReminder: () => {}, completeReminder: () => {},
  reassign: (...a) => ficha.reassign(...a), updateLead: () => {},
}));
vi.mock('@/modules/leads/hooks/useLeads', () => ({ useLeadDetail: () => detalle }));
const nada = vi.hoisted(() => () => ({ default: () => null }));
vi.mock('@/modules/conversions/components/ConversionsTab', nada);
vi.mock('@/modules/leads/components/lead-detail/LeadInfoCard', nada);
vi.mock('@/modules/leads/components/lead-detail/LeadProductsCard', nada);
vi.mock('@/modules/proceso/components/AgendaDelProspecto', nada);
vi.mock('@/modules/convocatorias/components/ConvocatoriasDelProspecto', nada);
vi.mock('@/modules/feedback/components/FeedbackDeLaFicha', nada);
vi.mock('@/modules/leads/components/lead-detail/LeadUtmsCard', nada);
vi.mock('@/modules/leads/components/lead-detail/LeadInteractionsCard', () => ({ default: () => null, InteractionDialog: () => null }));
vi.mock('@/modules/leads/components/lead-detail/LeadRemindersCard', () => ({ default: () => null, ReminderDialog: () => null }));
vi.mock('@/modules/leads/components/lead-detail/LeadTimelineCard', nada);
vi.mock('@/modules/leads/components/lead-detail/LeadLossDialog', nada);
vi.mock('@/modules/leads/components/MergeLeadDialog', nada);
vi.mock('@/modules/leads/components/LeadEmailDialog', nada);
vi.mock('@/modules/leads/components/LeadEmailsCard', nada);
vi.mock('@/modules/leads/components/EnrollSequenceModal', nada);
vi.mock('@/modules/links-pago/components/LinksDePagoCard', nada);

const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
const { veListaDeGestoras, soloLoSuyo } = await import('@/shared/lib/roles');
const { crearCan, default: usePermission } = await import('@/shared/hooks/usePermission');
const { default: LeadDetailPage } = await import('@/modules/leads/pages/LeadDetailPage');
const { default: WasapiExportDialog } = await import('@/modules/leads/components/WasapiExportDialog');
const { default: ClientsFiltersBar } = await import('@/modules/clients/components/ClientsFiltersBar');

const mapaDe = (role) => resolverPermisos({ role, roles_extra: [] }).mapa;

// Su equipo en producción (equipo_comercial, lider_id = 5).
const RAQUEL = { id: 5, nombre: 'Raquel ISEIE Comercial', role: 'lider_equipo' };
const EQUIPO = [
  RAQUEL,
  { id: 2, nombre: 'Fabiola ISEIE Comercial', role: 'gestor' },
  { id: 12, nombre: 'Malena Comercial', role: 'gestor' },
  { id: 16, nombre: 'María Gabriela', role: 'gestor' },
];

function entrarComo(role, { alcance = null, id = 77 } = {}) {
  sesion.user = { id, role, roles_extra: [] };
  sesion.permissions = role === 'superadmin' ? { '*': true } : mapaDe(role);
  sesion.alcanceComercial = alcance;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (url) => {
    if (String(url).startsWith('/users')) return { success: true, data: EQUIPO };
    return { success: true, data: [] };
  });
});
afterEach(cleanup);

// La tabla de verdad: qué roles ven las listas de gestoras. La misma que el servidor.
const VE_LA_LISTA = {
  superadmin: true, admin: true, soporte: true, lider_equipo: true,
  gestor: false, project_manager: false, tutor: false, tutor_redactor: false, colaborador: false,
};

describe('veListaDeGestoras: rol por rol, con el mapa que da el servidor', () => {
  for (const [role, ve] of Object.entries(VE_LA_LISTA)) {
    it(`${role}: ${ve ? 've' : 'no ve'} la lista de gestoras`, () => {
      const user = { id: 1, role, roles_extra: [] };
      const can = crearCan(user, role === 'superadmin' ? { '*': true } : mapaDe(role));
      const llevaEquipo = role === 'lider_equipo';
      expect(veListaDeGestoras(user, can, llevaEquipo)).toBe(ve);
      // Y si la ve, el servidor se la da: `users.view` o `equipos.su_equipo`.
      if (ve) expect(can('users.view') || can('equipos.su_equipo')).toBe(true);
    });
  }

  it('una admin con equipo (como Raquel antes del 24/11) también, y un project manager con equipo', () => {
    const pm = { id: 1, role: 'project_manager', roles_extra: [] };
    expect(veListaDeGestoras(pm, crearCan(pm, mapaDe('project_manager')), false)).toBe(false);
    expect(veListaDeGestoras(pm, crearCan(pm, mapaDe('project_manager')), true)).toBe(true);
    expect(soloLoSuyo({ role: 'lider_equipo' })).toBe(true);
    expect(soloLoSuyo({ role: 'gestor', roles_extra: ['admin'] })).toBe(false);
  });

  it('usePermission().veGestoras: la líder sí aunque su equipo esté vacío; la gestora no', () => {
    entrarComo('lider_equipo', { alcance: [5] });
    expect(renderHook(() => usePermission()).result.current.veGestoras).toBe(true);
    entrarComo('gestor');
    expect(renderHook(() => usePermission()).result.current.veGestoras).toBe(false);
  });
});

describe('Lo de Raquel: la ficha del prospecto, «Reasignar»', () => {
  const pintar = () => render(
    <MemoryRouter initialEntries={['/leads/900']}>
      <Routes><Route path="/leads/:id" element={<LeadDetailPage />} /></Routes>
    </MemoryRouter>,
  );

  it('la líder de equipo pide su equipo y reasigna a una de ellas', async () => {
    entrarComo('lider_equipo', { alcance: EQUIPO.map((u) => u.id), id: 5 });
    pintar();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/users?limit=100&alcance=comercial'));
    fireEvent.click(screen.getAllByRole('button', { name: /Reasignar/ })[0]);
    fireEvent.click(await screen.findByRole('combobox', { name: 'Nuevo responsable' }));
    // Ella y las de su equipo: antes, solo «Seleccionar responsable».
    for (const u of EQUIPO) expect(screen.getByRole('option', { name: new RegExp(u.nombre) })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('option', { name: /Malena Comercial/ }));
    const botones = screen.getAllByRole('button', { name: /Reasignar/ });
    fireEvent.click(botones[botones.length - 1]);
    await waitFor(() => expect(ficha.reassign).toHaveBeenCalledWith(12));
  });

  it('una gestora no pide la lista (no tiene «Reasignar» ni el permiso de leerla)', async () => {
    entrarComo('gestor', { id: 12 });
    pintar();
    await screen.findAllByText('Prospecto Uno');
    expect(api.get.mock.calls.some(([u]) => String(u).startsWith('/users'))).toBe(false);
    expect(screen.queryByRole('button', { name: /Reasignar/ })).toBeNull();
  });

  it('un admin, como siempre', async () => {
    entrarComo('admin', { id: 3 });
    pintar();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/users?limit=100&alcance=comercial'));
  });
});

describe('Lo de Raquel: los filtros de gestora', () => {
  it('Wasapi: la líder elige entre su equipo; la gestora, solo lo suyo', async () => {
    entrarComo('lider_equipo', { alcance: EQUIPO.map((u) => u.id), id: 5 });
    render(<WasapiExportDialog open projectId={4} onClose={() => {}} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/users', { params: { limit: 100, alcance: 'comercial' } }));
    expect(screen.queryByText(/Como gestor, solo descargarás/)).toBeNull();
    cleanup();
    vi.clearAllMocks();

    entrarComo('gestor', { id: 12 });
    render(<WasapiExportDialog open projectId={4} onClose={() => {}} />);
    expect(screen.getByText(/Como gestor, solo descargarás/)).toBeInTheDocument();
    expect(api.get.mock.calls.some(([u]) => String(u).startsWith('/users'))).toBe(false);
  });

  it('Clientes: la líder ve «Gestora» con su equipo y sin «Sin gestora»', () => {
    entrarComo('lider_equipo', { alcance: EQUIPO.map((u) => u.id), id: 5 });
    const props = {
      search: '', setSearch: () => {}, filterResp: '', setFilterResp: () => {},
      filterProducto: '', setFilterProducto: () => {}, filterInstallments: '', setFilterInstallments: () => {},
      sortBy: 'recientes', setSortBy: () => {}, gestores: EQUIPO, productos: [], totalBackend: 0,
    };
    render(<ClientsFiltersBar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Filtros/ }));
    expect(screen.getByText('Gestora')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Malena Comercial' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Sin gestora/ })).toBeNull();
  });
});
