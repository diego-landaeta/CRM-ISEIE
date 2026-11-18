// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';
despuesDeCada(() => limpiar());
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  Los botones salen a quien tiene el permiso que pide el SERVIDOR, no por el
  rol ni por otra clave (descuadres encontrados al escribir el manual,
  17/11/2026). Cada perfil lleva el mapa de serie que le da el servidor
  (`resolverPermisos`), con las excepciones que diga cada prueba.
*/

const h = vi.hoisted(() => ({
  user: null, permissions: null,
  proyecto: { activeProject: { id: 1, nombre: 'Psiko' }, activeIssuerId: null, activeIssuer: null, isAllProjects: false, projects: [{ id: 1, nombre: 'Psiko' }] },
  get: null, post: null, toast: null,
  plantillas: null,
  consultas: null,
  dossiers: null,
}));
h.get = vi.fn(); h.post = vi.fn(); h.toast = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: h.user, permissions: h.permissions }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => h.proyecto }));
vi.mock('@/shared/api/client', () => ({ default: { get: (...a) => h.get(...a), post: (...a) => h.post(...a), patch: vi.fn(), delete: vi.fn() }, API_BASE_URL: '/crm/api' }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: (...a) => h.toast(...a) }));
vi.mock('@/modules/whatsapp/api/whatsapp.api', () => ({ whatsappApi: { plantillas: (...a) => h.plantillas(...a) } }));
vi.mock('@/modules/consultas/api/consultas.api', async (original) => {
  const real = await original();
  return { ...real, consultasApi: new Proxy({}, { get: (_t, k) => (...a) => h.consultas(k, ...a) }) };
});
vi.mock('@/modules/products/hooks/useDossiers', () => ({ useDossiers: () => h.dossiers }));
vi.mock('@/modules/leads/components/LeadDrawer', () => ({
  default: ({ leadId, open }) => (open ? <p>Ficha del prospecto {leadId}</p> : null),
}));

const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
const { default: WebhooksPage } = await import('@/modules/webhooks/pages/WebhooksPage');
const { default: PlantillasPage } = await import('@/modules/whatsapp/pages/PlantillasPage');
const { default: DondePonerElDinero } = await import('@/modules/reports/components/DondePonerElDinero');
const { default: ConsultasPage } = await import('@/modules/consultas/pages/ConsultasPage');
const { default: DossierPanel } = await import('@/modules/products/components/DossierPanel');
const { default: LeadsPipelinePage } = await import('@/modules/leads/pages/LeadsPipelinePage');

function como(role, excepciones = {}) {
  h.user = { id: 5, role, roles_extra: [] };
  h.permissions = resolverPermisos({ role, roles_extra: [], excepciones }).mapa;
}
const pintar = (el) => render(<MemoryRouter>{el}</MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // El tutorial de Plantillas, ya visto: tapa la pantalla.
  localStorage.setItem('wa-tour-plantillas-visto-v1', '1');
  h.get.mockResolvedValue({ success: true, data: [] });
  h.plantillas = vi.fn().mockResolvedValue({ success: true, data: [
    { id: 1, project_id: 1, label: 'Día 1 · Saludo', body: 'Hola {nombre}', ambito: 'compartida', owner_id: null, orden: 1 },
  ] });
  h.consultas = vi.fn(async () => ({ success: true, data: { consultas: [], plazoHoras: 24 } }));
  h.dossiers = { history: [], activeDossier: null, loading: false, uploading: false, uploadProgress: 0, error: null, upload: vi.fn(), download: vi.fn() };
});

describe('Webhooks: los botones, con `forms.*` (lo que pide /api/forms)', () => {
  it('el admin crea, enciende y borra', async () => {
    como('admin');
    h.get.mockResolvedValue({ success: true, data: [{ id: 3, nombre: 'Make', destination: 'lead', active: true, field_mapping: {}, embed_id: 'x' }] });
    pintar(<WebhooksPage />);
    expect(await screen.findByText('Make')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nuevo webhook' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Eliminar Make' })).toBeTruthy();
    expect(screen.getByTitle(/Apagar webhook/)).toBeTruthy();
  });

  it('el project manager solo mira: sin «Nuevo webhook», sin encender ni borrar (le daba 403)', async () => {
    como('project_manager');
    h.get.mockResolvedValue({ success: true, data: [{ id: 3, nombre: 'Make', destination: 'lead', active: true, field_mapping: {}, embed_id: 'x' }] });
    pintar(<WebhooksPage />);
    expect(await screen.findByText('Make')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nuevo webhook' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Eliminar Make' })).toBeNull();
    expect(screen.queryByTitle(/Apagar webhook/)).toBeNull();
  });
});

describe('Plantillas de WhatsApp: las compartidas, con `whatsapp.plantillas_compartidas` y sin mirar el rol', () => {
  const editable = async () => {
    pintar(<PlantillasPage />);
    await screen.findByText('Día 1 · Saludo');
    fireEvent.click(screen.getByRole('button', { name: /^Editar$/ }));
    return !(await screen.findByDisplayValue('Hola {nombre}')).disabled;
  };

  it('soporte, que lo trae de serie, puede editar la compartida (antes se pedía además ser admin)', async () => {
    como('soporte');
    expect(await editable()).toBe(true);
  });

  it('una gestora, sin el permiso, no', async () => {
    como('gestor');
    expect(await editable()).toBe(false);
  });
});

describe('Reportes › «¿Dónde ponemos el dinero?»: con `reports.dinero`', () => {
  it('el project manager, que lo tiene de serie, lo ve y lo pide', async () => {
    como('project_manager');
    h.get.mockResolvedValue({ success: true, data: {
      periodo: { from: '2026-11-01', to: '2026-11-17' }, anterior: { from: '2026-10-15', to: '2026-10-31' },
      gasto_completo: true, canales: [], total: {}, total_anterior: {},
    } });
    pintar(<DondePonerElDinero from="2026-11-01" to="2026-11-17" />);
    await waitFor(() => expect(h.get).toHaveBeenCalledWith(expect.stringMatching(/^\/informes\/canales\/dinero\?/)));
    expect(await screen.findByText(/Dónde ponemos el dinero/)).toBeTruthy();
  });

  it('el admin al que se le quita, no (el servidor le daría 403)', async () => {
    como('admin', { 'reports.dinero': false });
    const { container } = pintar(<DondePonerElDinero from="2026-11-01" to="2026-11-17" />);
    await new Promise((ok) => setTimeout(ok, 0));
    expect(h.get).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });
});

describe('Consultas › «Leer el campus ahora»: con `consultas.gestionar`', () => {
  it('el project manager ve el panel pero no el botón', async () => {
    como('project_manager');
    pintar(<ConsultasPage />);
    await waitFor(() => expect(h.consultas).toHaveBeenCalledWith('panel', expect.anything(), expect.anything()));
    expect(screen.queryByRole('button', { name: /Leer el campus ahora/ })).toBeNull();
  });

  it('el admin al que se le quita «Gestionar consultas» tampoco', async () => {
    como('admin', { 'consultas.gestionar': false });
    pintar(<ConsultasPage />);
    await waitFor(() => expect(h.consultas).toHaveBeenCalledWith('panel', expect.anything(), expect.anything()));
    expect(screen.queryByRole('button', { name: /Leer el campus ahora/ })).toBeNull();
  });

  it('el admin de serie, sí', async () => {
    como('admin');
    pintar(<ConsultasPage />);
    expect(await screen.findByRole('button', { name: /Leer el campus ahora/ })).toBeTruthy();
  });
});

describe('Dossier PDF: la zona de subida, con `dossiers.upload`', () => {
  it('el admin la ve', () => {
    como('admin');
    pintar(<DossierPanel productId={1} projectId={1} />);
    expect(screen.getByText(/Arrastra un archivo PDF/)).toBeTruthy();
  });

  it('una gestora no (el servidor se lo rechaza) y se le dice que no hay dossier', () => {
    como('gestor');
    pintar(<DossierPanel productId={1} projectId={1} />);
    expect(screen.queryByText(/Arrastra un archivo PDF/)).toBeNull();
    expect(screen.getByText('Este producto todavía no tiene dossier.')).toBeTruthy();
  });
});

describe('Pipeline: arrastrar a «Convertido» pide registrar la venta, como la ficha y el cambio rápido', () => {
  it('no cambia el estado: avisa y abre la ficha', async () => {
    como('gestor');
    h.get.mockResolvedValue({ success: true, data: [{ id: 9, nombre: 'Ana Prueba', email: 'ana@prueba.local', status: 'contactado' }] });
    const patch = (await import('@/shared/api/client')).default.patch;
    pintar(<LeadsPipelinePage />);
    const tarjeta = (await screen.findByText('Ana Prueba')).closest('[draggable]');
    const columna = screen.getByText('Convertido', { selector: 'span' }).closest('.flex-shrink-0');
    const dataTransfer = { effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(tarjeta, { dataTransfer });
    fireEvent.drop(columna, { dataTransfer });
    expect(await screen.findByText('Ficha del prospecto 9')).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Registra la compra desde la ficha' }));
  });
});
