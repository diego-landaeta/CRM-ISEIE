// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

/*
  #619, tanda J; gemela de CRM#941: las pantallas del menú que se quedaron sin
  «Ver recorrido» porque no estaban en la lista de la issue: Historial de
  tareas, Configurar tablero, Reportes, PayPal y banco y Novedades. Correos,
  que iba aquí, está en la tanda E (recorridosGestora619c), como en MultiCRM.

  Se pinta cada pantalla de verdad, con datos en los que sale todo, y se recorre
  entera: cada paso encuentra su sitio y ninguno se salta (salvo lo que no está
  en ese momento: la otra pestaña de PayPal y banco, el envío de novedades a
  quien no lo dirige). Lo que no está (no hay tareas hechas, la pestaña del
  banco, la función apagada, quien solo consulta) se salta solo. En Reportes,
  los paneles que piden sus propios datos se sustituyen por un sustituto con su
  nombre: aquí se prueba la pantalla y sus anclajes, no cada panel (tienen sus
  pruebas). Que cada anclaje sigue en el código y que los permisos existen lo
  comprueba `recorridosCobros.test.jsx` (estos se suman a `RECORRIDOS_COBROS`);
  que el cartel cabe a 375 px, paso a paso, `recorridoEnMovil.test.jsx`.
*/

const { permisos, api, yo, ambito } = vi.hoisted(() => ({
  permisos: new Set(),
  api: { get: vi.fn() },
  yo: { current: { id: 41, role: 'admin' } },
  ambito: { current: null },
}));

vi.mock('@/shared/api/client', () => ({
  default: {
    get: (...a) => api.get(...a),
    post: vi.fn(async () => ({ success: true })),
    put: vi.fn(async () => ({ success: true })),
    patch: vi.fn(async () => ({ success: true })),
    delete: vi.fn(async () => ({ success: true })),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: yo.current, permissions: { '*': true }, ...ambito.current }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ambito.current }));
vi.mock('@/shared/hooks/usePermission', () => ({
  default: () => ({ can: (k) => permisos.has(k), tieneRol: (...r) => r.includes(yo.current.role) }),
}));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

// Los paneles de Reportes que piden sus propios datos: un sustituto con su nombre.
const panel = (nombre) => ({ default: () => <div>{nombre}</div> });
vi.mock('@/modules/reports/components/ActividadPorComercial', () => ({ ...panel('Panel: actividad por comercial'), TarjetaActividad: () => null }));
vi.mock('@/modules/reports/components/TasaDeCierre', () => panel('Panel: tasa de cierre'));
vi.mock('@/shared/components/ReportsDownloadSection', () => panel('Panel: reportes descargables'));
vi.mock('@/shared/components/AsesorasPanel', () => panel('Panel: asesoras'));
vi.mock('@/modules/reports/components/DondePonerElDinero', () => panel('Panel: dónde poner el dinero'));
vi.mock('@/modules/reports/components/PaisesDeEntrada', () => panel('Panel: países de entrada'));
vi.mock('@/modules/reports/components/InformeMensual', () => panel('Panel: informe mensual'));
vi.mock('@/shared/components/RankingsPanel', () => panel('Panel: rankings'));
vi.mock('@/shared/components/PanelSeguimiento', () => panel('Panel: seguimiento'));
vi.mock('@/modules/feedback/components/FeedbackEnReportes', () => ({ ...panel('Panel: feedback'), feedbackEnCsv: () => [] }));
// La gráfica del resumen (recharts) lo pide y jsdom no lo trae.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const { RECORRIDOS_COBROS, claveRecorrido, pasosPara } = await import('@/shared/lib/recorridosCobros');
const { RECORRIDOS_GESTORA_H } = await import('@/shared/lib/recorridosGestoraH');
const { recorridosDeLaRuta } = await import('@/shared/lib/recorridosPorRuta');
const { default: TasksHistoryPage } = await import('@/modules/tasks/pages/TasksHistoryPage');
const { default: TaskBoardConfigPage } = await import('@/modules/tasks/pages/TaskBoardConfigPage');
const { default: ReportsPage } = await import('@/shared/pages/ReportsPage');
const { default: CobrosExternosPage } = await import('@/modules/accounting/pages/CobrosExternosPage');
const { default: NovedadesPage } = await import('@/modules/novedades/pages/NovedadesPage');

const SRC = path.resolve(__dirname, '..');
const CAMPUS = [
  { id: 1, nombre: 'Campus Uno', sociedad_emisora_id: 3 },
  { id: 2, nombre: 'Campus Dos', sociedad_emisora_id: 3 },
];
const UN_CAMPUS = { activeProject: CAMPUS[0], projects: [CAMPUS[0]], isAllProjects: false, activeIssuer: null, activeIssuerId: null };

const HISTORIAL = {
  id: 31, title: 'Preparar el temario de Mindfulness', assigned_to: 41, assigned_to_name: 'Laura Admin', created_by: 41,
  created_by_name: 'Laura Admin', supervisor_id: null, supervisor_name: null, completed_by: 41, completed_by_name: 'Laura Admin',
  completed_at: '2026-11-20T10:30:00Z', created_at: '2026-11-10T09:00:00Z', due_date: null, team_id: null, team_name: 'Contenidos',
  project_name: 'Campus Uno', external_project_name: null, area_name: 'Redacción',
};
const COLUMNAS = [
  { id: 1, key: 'por_hacer', name: 'Por hacer', color: 'gray', sort_order: 10, is_system: true, is_active: true },
  { id: 2, key: 'en_curso', name: 'En curso', color: 'blue', sort_order: 20, is_system: true, is_active: true },
  { id: 3, key: 'bloqueada', name: 'Bloqueada', color: 'red', sort_order: 30, is_system: false, is_active: true },
  { id: 4, key: 'hecha', name: 'Hecha', color: 'green', sort_order: 40, is_system: true, is_active: true },
];
const PANEL = {
  kpis: { prospectos: { value: 40, trend: 5 }, ventas: { value: 6, trend: 0 }, ingresos: { value: 12500, trend: 10 }, tasa: { value: 15, trend: null } },
  serie: [], rango: { grano: 'day' },
};
const PAYPAL = {
  id: 7, project_id: 1, paypal_id: 'PAY-1', tipo: 'cobro', status: 'completed', amount: '450.00', currency: 'EUR',
  fee_amount: null, customer_email: 'ana@ejemplo.com', customer_name: 'Ana Pérez', invoice_id: null, custom_id: null,
  paypal_created_at: '2026-11-22T12:00:00Z', conversion_id: null, conversion_payment_id: null, link_method: null,
  llegado_por: null, lead_nombre: 'Ana Pérez', producto_contratado: null,
};
const MOVIMIENTO = {
  id: 9, project_id: 1, cuenta: 'ES12', fecha_operacion: '2026-11-21', importe: '300.00', concepto: 'TRANSFERENCIA JUAN GOMEZ',
  referencia: null, estado: 'a_revisar', conversion_id: null, link_method: null, lead_nombre: null, producto_contratado: null,
  candidatos: [{ conversion_id: 55, lead_id: 8, nombre: 'Juan Gómez', producto: 'Máster', pendiente: 300, motivos: ['nombre', 'importe'] }],
};
const EXTRACTO = {
  id: 2, formato: 'n43', nombre_fichero: 'extracto-noviembre.n43', cuenta: 'ES12', fecha_desde: '2026-11-01', fecha_hasta: '2026-11-21',
  movimientos: 20, abonos: 12, abonos_nuevos: 12, enlazados: 10, a_revisar: 1, created_at: '2026-11-22T08:00:00Z', subido_por_nombre: 'Laura Admin',
};
const NOVEDADES = {
  crm: { nombre: 'CRM ISEIE', color: '#000' },
  actual: '3.1.0',
  versiones: [
    {
      version: '3.1.0', fecha: '2026-11-24', titulo: 'Recorridos en todas partes', intro: 'Una versión con recorridos.',
      grupos: [{ titulo: 'Para todos', items: [{ titulo: 'Lo nuevo de prueba', texto: 'Una novedad.', roles: [], ruta: '/tareas', boton: 'Ir al tablero' }] }],
      arreglos: ['Un arreglo.'],
    },
    { version: '3.0.0', fecha: '2026-11-18', titulo: 'La anterior', intro: 'La de antes.', grupos: [], arreglos: [] },
  ],
};

const RESPUESTAS = {
  '/tasks/historial': {
    success: true, data: [HISTORIAL], pagination: { total: 1, page: 1, limit: 50, totalPages: 1 },
    por_persona: [{ id: 41, nombre: 'Laura Admin', total: 1 }],
  },
  '/tasks/assignees': { success: true, data: [{ id: 41, nombre: 'Laura Admin', email: 'laura@ejemplo.com', role: 'admin' }] },
  '/tasks/columns': { success: true, data: COLUMNAS },
  '/informes/panel': { success: true, data: PANEL },
  '/cobros-externos/estado': { success: true, data: { paypal: true, santander: true } },
  '/cobros-externos/paypal': { success: true, data: [PAYPAL] },
  '/cobros-externos/banco/movimientos': { success: true, data: [MOVIMIENTO], porEstado: { a_revisar: 1 } },
  '/cobros-externos/banco/extractos': { success: true, data: [EXTRACTO] },
  '/novedades': { success: true, data: NOVEDADES },
};
/** La respuesta por la ruta, sin la parte de los parámetros. */
const responder = async (url) => RESPUESTAS[String(url).split('?')[0]] ?? { success: true, data: [] };

const PANTALLAS = {
  'historial-tareas': { pintar: () => <TasksHistoryPage />, cargada: 'Preparar el temario de Mindfulness' },
  'configurar-tablero': { pintar: () => <TaskBoardConfigPage />, cargada: 'Bloqueada' },
  reportes: { pintar: () => <ReportsPage />, cargada: 'Tasa conv.' },
  // Abre en PayPal: lo del banco es de la otra pestaña.
  'cobros-externos': { pintar: () => <CobrosExternosPage />, cargada: 'Ana Pérez', fuera: ['Subir un extracto', 'Los abonos'] },
  // Quien no dirige el CRM (superadmin o soporte) no manda las novedades.
  novedades: { pintar: () => <NovedadesPage />, cargada: 'Lo nuevo de prueba', fuera: ['Mandarla'] },
};
const IDS = Object.keys(PANTALLAS);
const boton = (id) => `Ver recorrido: ${RECORRIDOS_GESTORA_H[id].titulo}`;
const pintar = (id) => render(<MemoryRouter>{PANTALLAS[id].pintar()}</MemoryRouter>);
const titulos = (id, fuera = []) => RECORRIDOS_GESTORA_H[id].pasos.map((p) => p.titulo).filter((t) => !fuera.includes(t));
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
  [
    'tasks.view_own', 'tasks.view_all', 'tasks.assign', 'tasks.manage', 'reports.mis_informes',
    'cobros_externos.view', 'cobros_externos.edit', 'novedades.view',
  ].forEach((k) => permisos.add(k));
  yo.current = { id: 41, role: 'admin', nombre: 'Laura Admin' };
  ambito.current = UN_CAMPUS;
  api.get.mockReset();
  api.get.mockImplementation(responder);
});
afterEach(() => cleanup());

describe('las del menú sin recorrido, en el modelo (#619, tanda J)', () => {
  it('son cinco, las mismas que en MultiCRM, y están registradas con las demás (VerRecorrido y la prueba a 375 los ven)', () => {
    expect(Object.keys(RECORRIDOS_GESTORA_H)).toEqual(['historial-tareas', 'configurar-tablero', 'reportes', 'cobros-externos', 'novedades']);
    for (const id of IDS) expect(RECORRIDOS_COBROS[id]).toBe(RECORRIDOS_GESTORA_H[id]);
  });

  it('cada uno con el permiso con el que el menú y el servidor dejan ver su pantalla', () => {
    expect(Object.fromEntries(Object.values(RECORRIDOS_GESTORA_H).map((r) => [r.id, r.permiso]))).toEqual({
      'historial-tareas': ['tasks.view_own', 'tasks.view_all'],
      'configurar-tablero': 'tasks.manage',
      reportes: 'reports.mis_informes',
      'cobros-externos': 'cobros_externos.view',
      novedades: 'novedades.view',
    });
  });

  it.each(IDS)('%s: de 5 a 8 pasos, y su pantalla lo ofrece con el margen de scroll', (id) => {
    const r = RECORRIDOS_GESTORA_H[id];
    expect(r.pasos.length).toBeGreaterThanOrEqual(5);
    expect(r.pasos.length).toBeLessThanOrEqual(8);
    const codigo = r.pantalla.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
    expect(codigo).toMatch(new RegExp(`<VerRecorrido id="${id}"`));
    expect(codigo).toContain('[&_[data-recorrido]]:scroll-mt-40');
  });

  it('el botón «Recorrido» de la cabecera ofrece el de cada pantalla, y el tablero sigue con el suyo', () => {
    expect(recorridosDeLaRuta('/tareas/historial')).toEqual(['historial-tareas']);
    expect(recorridosDeLaRuta('/tareas/configurar')).toEqual(['configurar-tablero']);
    expect(recorridosDeLaRuta('/informes')).toEqual(['reportes']);
    expect(recorridosDeLaRuta('/accounting/cobros-externos')).toEqual(['cobros-externos']);
    expect(recorridosDeLaRuta('/novedades')).toEqual(['novedades']);
    // El tablero apunta el suyo al montarse (no va por ruta); el resto de Reportes no es esto.
    expect(recorridosDeLaRuta('/tareas')).toEqual([]);
    expect(recorridosDeLaRuta('/informes/feedback')).toEqual([]);
  });

  it('quien solo mira PayPal y banco no ve cómo sincronizar ni subir', () => {
    const soloVer = pasosPara(RECORRIDOS_GESTORA_H['cobros-externos'], (k) => k === 'cobros_externos.view').map((p) => p.titulo);
    expect(soloVer).not.toContain('Traerlos ahora');
    expect(soloVer).not.toContain('Subir un extracto');
  });
});

describe.each(IDS)('%s: la pantalla de verdad, recorrida entera', (id) => {
  it('nunca sale solo (#681), ni la primera vez; con su botón se recorre sin saltarse nada', async () => {
    pintar(id);
    await cargada(id);
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('dialog', { name: titulos(id)[0] })).toBeNull();
    expect(localStorage.getItem(claveRecorrido(id, 41))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: boton(id) }));
    await screen.findByRole('dialog', { name: titulos(id)[0] }, { timeout: 3000 });
    // Se marca como visto al abrirse (en un efecto: puede llegar justo después del cartel).
    await waitFor(() => expect(localStorage.getItem(claveRecorrido(id, 41))).toBe('1'));
    const esperados = titulos(id, PANTALLAS[id].fuera);
    expect(recorrer(esperados.length)).toEqual(esperados);
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
  it('Historial sin tareas hechas: sin las fichas ni la lista', async () => {
    api.get.mockImplementation(async (url) => (String(url).startsWith('/tasks/historial')
      ? { success: true, data: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 0 }, por_persona: [] } : responder(url)));
    pintar('historial-tareas');
    await screen.findByText('No hay tareas hechas con estos filtros', {}, { timeout: 5000 });
    expect(await abrirYRecorrer('historial-tareas')).toEqual(titulos('historial-tareas', ['Por integrante', 'Las tareas hechas']));
  });

  it('Configurar tablero sin «tasks.manage»: ni botón ni recorrido', async () => {
    permisos.delete('tasks.manage');
    pintar('configurar-tablero');
    await screen.findByText(/necesita el permiso/, {}, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
  });

  it('PayPal y banco en la pestaña del banco: lo de PayPal se salta', async () => {
    pintar('cobros-externos');
    await cargada('cobros-externos');
    fireEvent.click(screen.getByRole('button', { name: /Banco \(extractos\)/ }));
    await screen.findByText(/TRANSFERENCIA JUAN GOMEZ/, {}, { timeout: 5000 });
    expect(await abrirYRecorrer('cobros-externos'))
      .toEqual(titulos('cobros-externos', ['Qué cobros ver', 'Traerlos ahora', 'Cada cobro']));
  });

  it('PayPal y banco de quien solo consulta: sin sincronizar', async () => {
    permisos.delete('cobros_externos.edit');
    pintar('cobros-externos');
    await cargada('cobros-externos');
    expect(await abrirYRecorrer('cobros-externos'))
      .toEqual(titulos('cobros-externos', ['Traerlos ahora', 'Subir un extracto', 'Los abonos']));
  });

  it('PayPal y banco con las dos funciones apagadas: solo las pestañas', async () => {
    api.get.mockImplementation(async (url) => (String(url).startsWith('/cobros-externos/estado')
      ? { success: true, data: { paypal: false, santander: false } } : responder(url)));
    pintar('cobros-externos');
    await screen.findByText(/está apagado en este servidor/, {}, { timeout: 5000 });
    expect(await abrirYRecorrer('cobros-externos')).toEqual(['Cobros de PayPal y del banco', 'PayPal o banco', 'Y listo']);
  });

  it('Novedades para quien dirige el CRM: también cómo mandarla', async () => {
    yo.current = { id: 41, role: 'superadmin', nombre: 'Laura Admin', email: 'laura@ejemplo.com' };
    pintar('novedades');
    await cargada('novedades');
    expect(await abrirYRecorrer('novedades')).toEqual(titulos('novedades'));
  });

  it('sin «reports.mis_informes», Reportes no se pinta ni ofrece recorrido', async () => {
    permisos.delete('reports.mis_informes');
    pintar('reportes');
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
  });
});
