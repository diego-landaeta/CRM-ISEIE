// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

/*
  #619, tanda G; gemela de CRM#941 (Diego, 19/11: «las que son así, dáselas a
  Ángel CEDIA»): «Ver recorrido» en lo que faltaba de Comercial: Convocatorias, Revisión de
  duplicados, Buscar duplicados y Solicitud de admisión.

  Se pinta cada pantalla de verdad, con datos en los que sale todo, y se recorre
  entera: cada paso encuentra su sitio y ninguno se salta. Lo que no está (nadie
  por revisar, un campus fijo arriba, un botón sin permiso) se salta solo. Que
  cada anclaje sigue en el código y que los permisos existen lo comprueba
  `recorridosCobros.test.jsx` (estos se suman a `RECORRIDOS_COBROS`); que el
  cartel cabe a 375 px, paso a paso, `recorridoEnMovil.test.jsx`.
*/

const { permisos, api, yo, ambito, conv } = vi.hoisted(() => ({
  permisos: new Set(),
  api: { get: vi.fn() },
  yo: { current: { id: 41, role: 'admin' } },
  ambito: { current: null },
  conv: { pendientes: [], campanas: [], embudo: null },
}));

vi.mock('@/shared/api/client', () => ({
  default: { get: (...a) => api.get(...a), post: vi.fn(async () => ({ success: true })), patch: vi.fn(async () => ({ success: true })) },
}));
// Convocatorias y Revisión de duplicados leen la cabecera de `useAuth`; las otras dos, de `useProjectContext`.
// (Aquí Convocatorias va siempre con el campus de arriba: no hay vista de empresa que probar.)
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: yo.current, ...ambito.current }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ambito.current }));
vi.mock('@/shared/hooks/useAmbito', () => ({
  useIdsDelAmbito: () => ambito.current.projects.map((p) => p.id),
  useProyectosDelAmbito: () => ambito.current.projects,
}));
vi.mock('@/shared/hooks/usePermission', () => ({
  default: () => ({ can: (k) => permisos.has(k), tieneRol: (...r) => r.includes(yo.current.role) }),
}));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/modules/convocatorias/api/convocatorias.api', () => ({
  traerConvocatorias: vi.fn(async () => conv.campanas),
  traerEmbudo: vi.fn(async () => conv.embudo),
  traerPendientes: vi.fn(async () => conv.pendientes),
  crearConvocatoria: vi.fn(),
  editarConvocatoria: vi.fn(),
}));

const { RECORRIDOS_COBROS, claveRecorrido, pasosPara } = await import('@/shared/lib/recorridosCobros');
const { RECORRIDOS_GESTORA_E } = await import('@/shared/lib/recorridosGestoraE');
const { recorridosDeLaRuta } = await import('@/shared/lib/recorridosPorRuta');
const { default: ConvocatoriasPage } = await import('@/modules/convocatorias/pages/ConvocatoriasPage');
const { default: DupReviewQueuePage } = await import('@/modules/leads/pages/DupReviewQueuePage');
const { default: DuplicatesPage } = await import('@/modules/leads/pages/DuplicatesPage');
const { default: MatriculasPage } = await import('@/modules/matriculas/pages/MatriculasPage');

const SRC = path.resolve(__dirname, '..');
const CAMPUS = [
  { id: 1, nombre: 'Campus Uno', sociedad_emisora_id: 3 },
  { id: 2, nombre: 'Campus Dos', sociedad_emisora_id: 3 },
];
const UN_CAMPUS = { activeProject: CAMPUS[0], projects: [CAMPUS[0]], isAllProjects: false, activeIssuer: null, activeIssuerId: null };
const EMPRESA = {
  activeProject: { id: -1, nombre: 'Todos' }, projects: CAMPUS, isAllProjects: true,
  activeIssuer: { id: 3, nombre: 'Empresa de prueba', campus: CAMPUS }, activeIssuerId: 3,
};
// Una empresa con un solo campus: el desplegable de campus sale, y ya viene elegido.
const EMPRESA_DE_UNO = { ...EMPRESA, projects: [CAMPUS[0]], activeIssuer: { id: 3, nombre: 'Empresa de prueba', campus: [CAMPUS[0]] } };

const PENDIENTE = {
  id: 3, lead_id: 5, lead_nombre: 'Ana Pérez', convocatoria: 'Beca CETLAT', proyecto_nombre: 'Campus Uno',
  fecha_resultado: '2026-11-20', dias_de_retraso: 4, gestora: 'Laura',
};
const CAMPANA = { id: 8, nombre: 'Beca CETLAT', activa: true, tope_nueva: 40, tope_habilitada: 70, ofrecimientos: 6, project_id: 1, proyecto_nombre: 'Campus Uno' };
const EMBUDO = {
  ofrecidas: 6, llenaron: 4, no_llenaron: 1, sin_saber: 1, con_descuento: 3, descuento_medio: 30, descuento_maximo: 40,
  compraron: 2, deben_respuesta: 1, pct_llenaron: 67, pct_compraron: 33, pct_compraron_de_los_que_llenaron: 50,
};
const EN_COLA = {
  id: 12, lead_id: 50, original_lead_id: 7, project_id: 1, match_by_email: true, match_by_phone: true, source: 'webhook',
  status: 'pending', created_at: '2026-11-23T10:00:00Z', lead_nombre: 'Ana Nueva', lead_email: 'ana@ejemplo.com',
  lead_telefono: '+34600000000', lead_responsable_nombre: 'Laura', lead_status: 'nuevo', lead_producto: 'Máster',
  reincidente: true, original_nombre: 'Ana Pérez', original_email: 'ana@ejemplo.com', original_status: 'contactado',
  original_responsable_nombre: 'Laura',
};
const GRUPO = {
  key: 'g1', motivos: ['correo', 'telefono'], total: 2, ya_marcado: false, con_conversion: 1,
  leads: [
    { id: 7, nombre: 'Bea Ruiz', email: 'bea@ejemplo.com', telefono: '+34600000001', whatsapp_usuario: null, status: 'convertido', created_at: '2026-10-01T10:00:00Z', lead_duplicado_de: null, responsable_nombre: 'Laura', producto_nombre: 'Máster', n_interacciones: 4, n_conversiones: 1 },
    { id: 9, nombre: 'Bea Ruiz', email: 'bea@ejemplo.com', telefono: '+34600000001', whatsapp_usuario: null, status: 'nuevo', created_at: '2026-11-01T10:00:00Z', lead_duplicado_de: null, responsable_nombre: null, producto_nombre: null, n_interacciones: 0, n_conversiones: 0 },
  ],
};
const SOLICITUD = {
  id: 31, estado: 'solicitud_admision', lead_id: 5, lead_nombre: 'Carla Gómez', lead_email: 'carla@ejemplo.com',
  curso: 'Máster', campus_nombre: 'Campus Uno', empresa_nombre: 'Empresa de prueba', gestora_nombre: 'Laura',
  recibida_at: '2026-11-22T09:00:00Z', documentos: { dni_frente: true, titulo: true }, conversion_id: 88,
};

const RESPUESTAS = {
  '/leads/review-queue': { success: true, data: [EN_COLA], counts: { pending: 1, approved: 2, merged: 0, rejected: 1 } },
  '/leads/duplicados': { success: true, data: [GRUPO] },
  '/matriculas': {
    success: true, data: [SOLICITUD], pagination: { total: 1 }, cursos: ['Máster'], campus: [{ id: 1, nombre: 'Campus Uno' }],
    stats: { total: 1, solicitudes: 1, pendientes: 0, validadas: 0, rechazadas: 0 },
  },
};
/** La respuesta por la ruta, sin la parte de los parámetros. */
const responder = async (url) => RESPUESTAS[String(url).split('?')[0]] ?? { success: true, data: [] };

const PANTALLAS = {
  convocatorias: { pintar: () => <ConvocatoriasPage />, cargada: 'Ana Pérez' },
  'revision-duplicados': { pintar: () => <DupReviewQueuePage />, cargada: 'Ana Nueva' },
  'buscar-duplicados': { pintar: () => <DuplicatesPage />, cargada: 'Fusionar 1 en #7', ambito: EMPRESA_DE_UNO },
  'solicitud-admision': { pintar: () => <MatriculasPage />, cargada: 'Carla Gómez' },
};
const IDS = Object.keys(PANTALLAS);
const boton = (id) => `Ver recorrido: ${RECORRIDOS_GESTORA_E[id].titulo}`;
const pintar = (id) => {
  if (PANTALLAS[id].ambito) ambito.current = PANTALLAS[id].ambito;
  return render(<MemoryRouter>{PANTALLAS[id].pintar()}</MemoryRouter>);
};
const titulos = (id, fuera = []) => RECORRIDOS_GESTORA_E[id].pasos.map((p) => p.titulo).filter((t) => !fuera.includes(t));
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

async function abrirYRecorrer(id, n = 8) {
  fireEvent.click(await screen.findByRole('button', { name: boton(id) }, { timeout: 3000 }));
  await screen.findByRole('dialog', { name: titulos(id)[0] }, { timeout: 3000 });
  return recorrer(n);
}

beforeEach(() => {
  localStorage.clear();
  permisos.clear();
  ['convocatorias.view', 'convocatorias.create', 'leads.duplicados', 'leads.edit', 'matriculas.view', 'matriculas.cambiar_estado']
    .forEach((k) => permisos.add(k));
  yo.current = { id: 41, role: 'admin' };
  ambito.current = UN_CAMPUS;
  conv.pendientes = [PENDIENTE];
  conv.campanas = [CAMPANA];
  conv.embudo = EMBUDO;
  api.get.mockReset();
  api.get.mockImplementation(responder);
});
afterEach(() => cleanup());

describe('lo que faltaba de Comercial, en el modelo (#619, tanda G; gemela de CRM#941)', () => {
  it('son cuatro, en el orden del menú, y están registrados con los demás (VerRecorrido y la prueba a 375 los ven)', () => {
    expect(Object.keys(RECORRIDOS_GESTORA_E)).toEqual(['convocatorias', 'revision-duplicados', 'buscar-duplicados', 'solicitud-admision']);
    for (const id of IDS) expect(RECORRIDOS_COBROS[id]).toBe(RECORRIDOS_GESTORA_E[id]);
  });

  it('cada uno con el permiso con el que el menú y el servidor dejan ver su pantalla', () => {
    expect(Object.fromEntries(Object.values(RECORRIDOS_GESTORA_E).map((r) => [r.id, r.permiso]))).toEqual({
      convocatorias: 'convocatorias.view',
      'revision-duplicados': 'leads.duplicados',
      'buscar-duplicados': 'leads.duplicados',
      'solicitud-admision': 'matriculas.view',
    });
  });

  it.each(IDS)('%s: de 5 a 8 pasos, y su pantalla lo ofrece con el margen de scroll', (id) => {
    const r = RECORRIDOS_GESTORA_E[id];
    expect(r.pasos.length).toBeGreaterThanOrEqual(5);
    expect(r.pasos.length).toBeLessThanOrEqual(8);
    const codigo = r.pantalla.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
    expect(codigo).toMatch(new RegExp(`<VerRecorrido id="${id}"`));
    expect(codigo).toContain('[&_[data-recorrido]]:scroll-mt-40');
  });

  it('el botón «Recorrido» de la cabecera ofrece el de cada pantalla, y no el de la ficha ni el de Clientes', () => {
    expect(recorridosDeLaRuta('/leads/convocatorias')).toEqual(['convocatorias']);
    expect(recorridosDeLaRuta('/leads/revision-duplicados')).toEqual(['revision-duplicados']);
    expect(recorridosDeLaRuta('/leads/duplicados')).toEqual(['buscar-duplicados']);
    expect(recorridosDeLaRuta('/matriculas')).toEqual(['solicitud-admision']);
    // Certificaciones y Diplomas son de Certifex: no se les ofrece el del listado.
    expect(recorridosDeLaRuta('/matriculas/diplomas')).toEqual([]);
  });

  it('sin crear convocatorias no se explica «Nueva»; sin editar prospectos, no «Fusionar»', () => {
    const conv = pasosPara(RECORRIDOS_GESTORA_E.convocatorias, (k) => k === 'convocatorias.view').map((p) => p.titulo);
    expect(conv).not.toContain('Nueva convocatoria');
    expect(conv).toHaveLength(RECORRIDOS_GESTORA_E.convocatorias.pasos.length - 1);
    const dup = pasosPara(RECORRIDOS_GESTORA_E['buscar-duplicados'], (k) => k === 'leads.duplicados').map((p) => p.titulo);
    expect(dup).not.toContain('Fusionar');
  });
});

describe.each(IDS)('%s: la pantalla de verdad, recorrida entera', (id) => {
  it('nunca sale solo (CRM#1012), ni la primera vez; con su botón se recorre sin saltarse nada', async () => {
    pintar(id);
    await cargada(id);
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('dialog', { name: titulos(id)[0] })).toBeNull();
    expect(localStorage.getItem(claveRecorrido(id, 41))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: boton(id) }));
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
    fireEvent.click(screen.getByRole('button', { name: boton(id) }));
    expect(screen.getByRole('dialog', { name: titulos(id)[0] })).toBeInTheDocument();
  });
});

describe('lo que no está, se salta solo', () => {
  it('Convocatorias de una gestora: sin «Nueva convocatoria»', async () => {
    yo.current = { id: 41, role: 'gestor' };
    permisos.delete('convocatorias.create');
    pintar('convocatorias');
    await cargada('convocatorias');
    expect(await abrirYRecorrer('convocatorias')).toEqual(titulos('convocatorias', ['Nueva convocatoria']));
  });

  it('Revisión de duplicados sin nada pendiente: se salta la lista y «Decidir»', async () => {
    api.get.mockImplementation(async (url) => (String(url).startsWith('/leads/review-queue')
      ? { success: true, data: [], counts: { pending: 0, approved: 2, merged: 0, rejected: 1 } } : responder(url)));
    pintar('revision-duplicados');
    await screen.findByText('Sin pendientes', {}, { timeout: 5000 });
    expect(await abrirYRecorrer('revision-duplicados')).toEqual(titulos('revision-duplicados', ['El nuevo frente al original', 'Decidir']));
  });

  it('Buscar duplicados con un campus fijo arriba: sin «El campus»', async () => {
    ambito.current = UN_CAMPUS;
    render(<MemoryRouter><DuplicatesPage /></MemoryRouter>);
    await cargada('buscar-duplicados');
    expect(document.querySelector('[data-recorrido="duplicados-campus"]')).toBeNull();
    expect(await abrirYRecorrer('buscar-duplicados')).toEqual(titulos('buscar-duplicados', ['El campus']));
  });

  it('Buscar duplicados con una empresa y sin campus elegido: solo el campus', async () => {
    ambito.current = EMPRESA;
    render(<MemoryRouter><DuplicatesPage /></MemoryRouter>);
    await screen.findByText('Elige el campus para repasar sus duplicados.', {}, { timeout: 5000 });
    expect(await abrirYRecorrer('buscar-duplicados')).toEqual(titulos('buscar-duplicados').filter((t) => ['Fichas repetidas en la base', 'El campus', 'Y listo'].includes(t)));
  });

  it('Solicitud de admisión sin solicitudes: la lista dice cómo empezar y se salta «Abrir una solicitud»', async () => {
    api.get.mockImplementation(async (url) => (String(url).startsWith('/matriculas')
      ? { success: true, data: [], pagination: { total: 0 }, cursos: [], campus: [], stats: {} } : responder(url)));
    pintar('solicitud-admision');
    await screen.findByText('Aún no ha llegado ninguna solicitud', {}, { timeout: 5000 });
    expect(await abrirYRecorrer('solicitud-admision')).toEqual(titulos('solicitud-admision', ['Abrir una solicitud']));
  });

  it('sin «matriculas.view», Solicitud de admisión no ofrece recorrido', async () => {
    permisos.delete('matriculas.view');
    pintar('solicitud-admision');
    await cargada('solicitud-admision');
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: /./ })).toBeNull();
  });
});
