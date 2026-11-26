// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

/*
  #619, tanda C (gemela de CRM#941; Diego, 19/11: «las que son así, dáselas a
  Ángel CEDIA»): «Ver recorrido» en las tres pantallas que más abre una gestora
  después de Prospectos: Clientes, la ficha del prospecto y La cola del día.

  Se pinta cada pantalla de verdad, con datos en los que sale todo, y se recorre
  entera: cada paso encuentra su sitio y ninguno se salta. Lo que una gestora no
  tiene (el selector de gestora de la cola) se salta solo.
  Que cada anclaje sigue en el código y que los permisos existen lo comprueba
  `recorridosCobros.test.jsx` (estos se suman a `RECORRIDOS_COBROS`); que el
  cartel cabe a 375 px, paso a paso, `recorridoEnMovil.test.jsx`.
*/

const { permisos, api, yo, ambito, enPruebas } = vi.hoisted(() => ({
  enPruebas: { proceso: true },
  permisos: new Set(),
  api: { get: vi.fn() },
  yo: { current: { id: 41, role: 'admin' } },
  ambito: { current: null },
}));

vi.mock('@/shared/api/client', () => ({
  default: { get: (...a) => api.get(...a), post: vi.fn(async () => ({ success: true })), patch: vi.fn(async () => ({ success: true })) },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: yo.current }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ambito.current }));
vi.mock('@/shared/hooks/useAmbito', () => ({
  useIdsDelAmbito: () => ambito.current.projects.map((p) => p.id),
  useProyectosDelAmbito: () => ambito.current.projects,
}));
// `veGestoras` (25/11/2026): el admin ve la lista del equipo y la gestora sin equipo, no.
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.has(k), veGestoras: ['admin', 'superadmin'].includes(yo.current?.role) }) }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
// En ISEIE la tarjeta del proceso de la ficha sale con VITE_PROCESO_EN_PRUEBAS
// (en /staging sí; en producción, aún no): se prueban las dos.
vi.mock('@/shared/lib/enPruebas', async (original) => ({
  ...(await original()),
  get PROCESO_EN_PRUEBAS() { return enPruebas.proceso; },
}));
vi.mock('@/modules/whatsapp/api/whatsapp.api', () => ({
  whatsappApi: { plantillas: vi.fn(async () => ({ success: true, data: [] })) },
}));
// La ficha: los datos del prospecto, y fuera las tarjetas que no señala el recorrido.
const LEAD = {
  id: 5, nombre: 'Ana Pérez', email: 'ana@ejemplo.com', telefono: '+34600000000', estado: 'contactado',
  project_id: 1, proyecto_nombre: 'Campus Uno', pais_origen: 'ES', responsable_id: 41, created_at: '2026-11-01T10:00:00Z',
  producto_interes_id: 9, producto_nombre: 'Máster',
};
vi.mock('@/modules/leads/hooks/useLeads', async (original) => ({
  ...(await original()),
  useLeadDetail: () => ({
    lead: LEAD, timeline: [], interacciones: [], reminders: [], utms: null, loading: false, error: null,
    refetch: vi.fn(), updateStatus: vi.fn(), addInteraction: vi.fn(), addReminder: vi.fn(), completeReminder: vi.fn(),
    reassign: vi.fn(), updateLead: vi.fn(),
  }),
}));

vi.mock('@/modules/conversions/components/ConversionsTab', () => ({ default: () => null }));
vi.mock('@/modules/links-pago/components/LinksDePagoCard', () => ({ default: () => null }));
vi.mock('@/modules/leads/components/LeadEmailsCard', () => ({ default: () => null }));
vi.mock('@/modules/feedback/components/FeedbackDeLaFicha', () => ({ default: () => null }));
vi.mock('@/modules/convocatorias/components/ConvocatoriasDelProspecto', () => ({ default: () => null }));
vi.mock('@/modules/leads/components/lead-detail/LeadProductsCard', () => ({ default: () => null }));
vi.mock('@/modules/proceso/components/PlantillaDelPaso', () => ({ default: () => null }));

const { RECORRIDOS_COBROS, claveRecorrido, pasosPara } = await import('@/shared/lib/recorridosCobros');
const { RECORRIDOS_GESTORA } = await import('@/shared/lib/recorridosGestora');
const { default: ClientsPage } = await import('@/modules/clients/pages/ClientsPage');
const { default: LeadDetailPage } = await import('@/modules/leads/pages/LeadDetailPage');
const { default: ColaDelDiaPage } = await import('@/modules/proceso/pages/ColaDelDiaPage');

const SRC = path.resolve(__dirname, '..');
const CAMPUS = [
  { id: 1, nombre: 'Campus Uno', sociedad_emisora_id: 3 },
  { id: 2, nombre: 'Campus Dos', sociedad_emisora_id: 3 },
];
const UN_CAMPUS = { activeProject: CAMPUS[0], projects: [CAMPUS[0]], isAllProjects: false, activeIssuer: null, activeIssuerId: null };

const FILA = {
  lead_id: 5, lead_nombre: 'Ana Pérez', lead_email: 'ana@ejemplo.com', lead_telefono: '+34600000000',
  lead_estado: 'contactado', clave: 'paso_2', orden: 2, paso_nombre: 'Seguimiento 2', paso_nota: null,
  canales: ['whatsapp', 'email'], producto: 'Máster', proyecto: 'Campus Uno', gestora: 'Laura',
  contactos: 1, avisa_plazas: false,
};
const CLIENTE = {
  id: 7, nombre: 'Bea Ruiz', email: 'bea@ejemplo.com', telefono: '+34600000001', estado: 'convertido', project_id: 1,
  total_compras: 1200, total_pagado: 400, pendiente: 800, num_compras: 1, ultima_compra: '2026-11-10', responsable_nombre: 'Laura',
  productos: 'Máster', cuotas_pagadas: 1, cuotas_totales: 3, cuotas_pendientes: 2, total_pagos: 1, proximo_vencimiento: '2026-12-01',
};
const RESPUESTAS = {
  '/leads': { success: true, data: [CLIENTE], pagination: { total: 1, totalPages: 1 } },
  '/informes/mi-puesto': { success: true, data: { puesto: 1, leads: 4, ventas: 2, tasa: 50, tasa_equipo: 30, cobrado: 400, total: { cobrado: 400, cobros: 1, ventas: 2 }, tabla: [] } },
  '/proceso/lead/5': {
    success: true,
    data: [{ id: 11, clave: 'paso_1', orden: 1, nombre: 'Primer contacto', canales: ['llamada'], fecha_prevista: '2026-11-02', estado: 'pendiente', hecho: false, con_contacto: false }],
  },
  '/proceso/cola/resumen': { success: true, data: { atrasados: 2, hoy: 3, manana: 1, esta_semana: 4 } },
  '/proceso/cola': {
    success: true,
    data: [
      { ...FILA, fecha_prevista: '2026-11-15', dias_de_retraso: 4 },
      { ...FILA, lead_id: 6, lead_nombre: 'Bea Ruiz', clave: 'paso_3', orden: 3, paso_nombre: 'Seguimiento 3', fecha_prevista: '2026-11-19', dias_de_retraso: 0 },
    ],
    pagination: { total: 2, totalPages: 1 },
    formaciones: [{ ids: [9], nombre: 'Máster', personas: 2 }],
  },
  '/users': { success: true, data: [{ id: 7, nombre: 'Laura', active: true }] },
};
/** La respuesta por la ruta, sin la parte de los parámetros. */
const responder = async (url) => RESPUESTAS[String(url).split('?')[0]] ?? { success: true, data: [] };

const PANTALLAS = {
  clientes: { pintar: () => <ClientsPage />, cargada: 'Bea Ruiz', boton: 'Ver recorrido: Clientes' },
  'prospecto-ficha': {
    pintar: () => <Routes><Route path="/leads/:id" element={<LeadDetailPage />} /></Routes>,
    ruta: '/leads/5',
    cargada: 'Primer contacto',
    boton: 'Ver recorrido: La ficha del prospecto',
  },
  'cola-del-dia': { pintar: () => <ColaDelDiaPage />, cargada: 'Bea Ruiz', boton: 'Ver recorrido: La cola del día' },
};
const IDS = Object.keys(PANTALLAS);
const pintar = (id) => {
  return render(<MemoryRouter initialEntries={[PANTALLAS[id].ruta || '/']}>{PANTALLAS[id].pintar()}</MemoryRouter>);
};
const titulos = (id, fuera = []) => RECORRIDOS_GESTORA[id].pasos.map((p) => p.titulo).filter((t) => !fuera.includes(t));
const cargada = (id) => screen.findAllByText(PANTALLAS[id].cargada, {}, { timeout: 5000 });

/** Recorre el recorrido abierto pulsando «Siguiente» y devuelve los títulos vistos. */
function recorrer(n) {
  const vistos = [];
  for (let i = 0; i < n + 2; i++) {
    const titulo = document.getElementById('recorrido-titulo');
    vistos.push(titulo.textContent);
    const sig = within(titulo.closest('[role="dialog"]')).queryByRole('button', { name: /Siguiente/ });
    if (!sig) break;
    fireEvent.click(sig);
  }
  return vistos;
}

beforeEach(() => {
  localStorage.clear();
  permisos.clear();
  ['clients.view', 'clients.create', 'accounting.por_cobrar', 'leads.view', 'proceso.view'].forEach((k) => permisos.add(k));
  yo.current = { id: 41, role: 'admin' };
  ambito.current = UN_CAMPUS;
  enPruebas.proceso = true;
  api.get.mockReset();
  api.get.mockImplementation(responder);
});
afterEach(() => cleanup());

describe('el día a día de una gestora en el modelo (#619, tanda C)', () => {
  it('son tres, por uso, y están registrados con los demás (VerRecorrido y la prueba a 375 los ven)', () => {
    expect(Object.keys(RECORRIDOS_GESTORA)).toEqual(['clientes', 'prospecto-ficha', 'cola-del-dia']);
    for (const id of IDS) expect(RECORRIDOS_COBROS[id]).toBe(RECORRIDOS_GESTORA[id]);
  });

  it('cada uno con el permiso con el que el menú y el servidor dejan ver su pantalla', () => {
    expect(Object.fromEntries(Object.values(RECORRIDOS_GESTORA).map((r) => [r.id, r.permiso]))).toEqual({
      clientes: 'clients.view',
      'prospecto-ficha': 'leads.view',
      'cola-del-dia': 'proceso.view',
    });
  });

  it.each(IDS)('%s: de 5 a 8 pasos, y su pantalla lo ofrece con el margen de scroll', (id) => {
    const r = RECORRIDOS_GESTORA[id];
    expect(r.pasos.length).toBeGreaterThanOrEqual(5);
    expect(r.pasos.length).toBeLessThanOrEqual(8);
    const codigo = r.pantalla.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
    expect(codigo).toMatch(new RegExp(`<VerRecorrido id="${id}"`));
    expect(codigo).toContain('[&_[data-recorrido]]:scroll-mt-40');
  });

  it('Clientes es aquí la lista con su buscador: sin los pasos de cifras, cobros y «Registrar venta» de MultiCRM', () => {
    const vistos = pasosPara(RECORRIDOS_GESTORA.clientes, (k) => k === 'clients.view').map((p) => p.titulo);
    expect(vistos).toEqual(['Quién ya compró', 'Cómo vas este mes', 'Buscar y filtrar', 'La lista', 'Y listo']);
  });
});

describe.each(IDS)('%s: la pantalla de verdad, recorrida entera', (id) => {
  it('nunca sale solo (CRM#1012), ni la primera vez; con su botón se recorre sin saltarse nada', async () => {
    pintar(id);
    await cargada(id);
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('dialog', { name: titulos(id)[0] })).toBeNull();
    expect(localStorage.getItem(claveRecorrido(id, 41))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: PANTALLAS[id].boton }));
    await screen.findByRole('dialog', { name: titulos(id)[0] }, { timeout: 3000 });
    // Se marca como visto al abrirse (en un efecto: puede llegar justo después del cartel).
    await waitFor(() => expect(localStorage.getItem(claveRecorrido(id, 41))).toBe('1'));
    expect(recorrer(titulos(id).length)).toEqual(titulos(id));
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('dialog', { name: /./ })).toBeNull();
  });

  it('ya visto, tampoco sale; el botón lo repite', async () => {
    localStorage.setItem(claveRecorrido(id, 41), '1');
    pintar(id);
    await cargada(id);
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('dialog', { name: titulos(id)[0] })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: PANTALLAS[id].boton }));
    expect(screen.getByRole('dialog', { name: titulos(id)[0] })).toBeInTheDocument();
  });
});

describe('lo que no está, se salta solo', () => {
  it('Clientes de una gestora: pasa por todo', async () => {
    yo.current = { id: 41, role: 'gestor' };
    pintar('clientes');
    await cargada('clientes');
    fireEvent.click(await screen.findByRole('button', { name: PANTALLAS.clientes.boton }, { timeout: 3000 }));
    await screen.findByRole('dialog', { name: 'Quién ya compró' }, { timeout: 3000 });
    expect(recorrer(8)).toEqual(titulos('clientes'));
  });

  it('la ficha de alguien sin proceso comercial: se salta «El proceso comercial»', async () => {
    api.get.mockImplementation(async (url) => (String(url).startsWith('/proceso/lead/') ? { success: true, data: [] } : responder(url)));
    pintar('prospecto-ficha');
    await screen.findByText('Información del lead', {}, { timeout: 5000 });
    fireEvent.click(await screen.findByRole('button', { name: PANTALLAS['prospecto-ficha'].boton }, { timeout: 3000 }));
    await screen.findByRole('dialog', { name: 'La ficha de una persona' }, { timeout: 3000 });
    expect(recorrer(8)).toEqual(titulos('prospecto-ficha', ['El proceso comercial']));
  });

  it('sin el proceso comercial encendido (producción de ISEIE hoy): se salta «El proceso comercial»', async () => {
    enPruebas.proceso = false;
    pintar('prospecto-ficha');
    await screen.findByText('Información del lead', {}, { timeout: 5000 });
    fireEvent.click(await screen.findByRole('button', { name: PANTALLAS['prospecto-ficha'].boton }, { timeout: 3000 }));
    await screen.findByRole('dialog', { name: 'La ficha de una persona' }, { timeout: 3000 });
    expect(document.querySelector('[data-recorrido="ficha-proceso"]')).toBeNull();
    expect(recorrer(8)).toEqual(titulos('prospecto-ficha', ['El proceso comercial']));
  });

  it('la cola de una gestora: sin «De quién es la cola» (el selector de gestora es del equipo)', async () => {
    yo.current = { id: 41, role: 'gestor' };
    ambito.current = UN_CAMPUS;
    render(<MemoryRouter><ColaDelDiaPage /></MemoryRouter>);
    await cargada('cola-del-dia');
    fireEvent.click(await screen.findByRole('button', { name: PANTALLAS['cola-del-dia'].boton }, { timeout: 3000 }));
    await screen.findByRole('dialog', { name: 'A quién le toca hoy' }, { timeout: 3000 });
    expect(document.querySelector('[data-recorrido="cola-equipo"]')).toBeNull();
    expect(recorrer(8)).toEqual(titulos('cola-del-dia', ['De quién es la cola']));
  });

  it('sin «proceso.view», la cola no ofrece recorrido', async () => {
    permisos.delete('proceso.view');
    pintar('cola-del-dia');
    await cargada('cola-del-dia');
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: /./ })).toBeNull();
  });
});
