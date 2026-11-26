// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

/*
  #619, tanda H; gemela de CRM#941 (Diego, 19/11: «las que son así, dáselas a
  Ángel CEDIA»): «Ver recorrido» en Captación y publicidad: Email, Formularios,
  Widget web y Meta Ads. Google Analytics, el quinto del 360, aquí no existe.

  Se pinta cada pantalla de verdad, con datos en los que sale todo, y se recorre
  entera: cada paso encuentra su sitio y ninguno se salta. Lo que no está (no hay
  secuencias, «Todos» arriba en el widget, un campus fijo, quien solo
  consulta Meta Ads) se salta solo. Que cada anclaje sigue en el código y que los
  permisos existen lo comprueba `recorridosCobros.test.jsx` (estos se suman a
  `RECORRIDOS_COBROS`); que el cartel cabe a 375 px, paso a paso,
  `recorridoEnMovil.test.jsx`.
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
    patch: vi.fn(async () => ({ success: true })),
    delete: vi.fn(async () => ({ success: true })),
  },
}));
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

const { RECORRIDOS_COBROS, claveRecorrido, pasosPara } = await import('@/shared/lib/recorridosCobros');
const { RECORRIDOS_GESTORA_F } = await import('@/shared/lib/recorridosGestoraF');
const { recorridosDeLaRuta } = await import('@/shared/lib/recorridosPorRuta');
const { default: EmailSequencesPage } = await import('@/modules/email-sequences/pages/EmailSequencesPage');
const { default: FormsPage } = await import('@/modules/forms/pages/FormsPage');
const { default: WhatsappWidgetPage } = await import('@/modules/widget/pages/WhatsappWidgetPage');
const { default: MetaAdsPage } = await import('@/modules/meta-ads/pages/MetaAdsPage');

const SRC = path.resolve(__dirname, '..');
const CAMPUS = [
  { id: 1, nombre: 'Campus Uno', sociedad_emisora_id: 3 },
  { id: 2, nombre: 'Campus Dos', sociedad_emisora_id: 3 },
];
const UN_CAMPUS = { activeProject: CAMPUS[0], projects: [CAMPUS[0]], isAllProjects: false, activeIssuer: null, activeIssuerId: null };
// Aquí no hay empresas en la cabecera: en vez de un campus, solo «Todos».
const TODOS = { activeProject: { id: -1, nombre: 'Todos' }, projects: CAMPUS, isAllProjects: true, activeIssuer: null, activeIssuerId: null };
// «Todos» con un solo campus a la vista: el desplegable de campus sale, y ya viene elegido.
const TODOS_DE_UNO = { ...TODOS, projects: [CAMPUS[0]] };

const SECUENCIA = {
  id: 4, nombre: 'Bienvenida al máster', trigger_event: 'lead_created', active: true, active_runs: 3, completed_runs: 9,
  steps: [{ delay_hours: 0, subject: 'Hola', body: '<p>Hola</p>' }, { delay_hours: 24, subject: '¿Hablamos?', body: '<p>…</p>' }],
};
const FORMULARIO = {
  id: 6, nombre: 'Landing del máster', kind: 'form', template_kind: 'contacto_basico', config: {}, active: true,
  embed_id: 'abc123', submissions_count: 12,
};
const WIDGET = {
  config: {
    project_id: 1, project_nombre: 'Campus Uno', project_slug: 'uno', enabled: true, welcome_text: '¿Hablamos?',
    message_template: 'Hola {{nombre}}', excluded_user_ids: [], show_bubble: true, bubble_delay_ms: 3000,
    traducciones: {}, updated_at: '2026-11-20T10:00:00Z',
  },
  candidates: [{
    id: 41, nombre: 'Laura', email: 'laura@ejemplo.com', role: 'gestor', active: true, whatsapp_phone: '34600000000',
    whatsapp_display_name: 'Laura', whatsapp_widget_active: true, in_project: true,
  }],
};
const PULSACIONES = {
  from: '2026-11-18', to: '2026-11-24', paginas: [],
  porGestora: [{ id: 41, nombre: 'Laura', pulsaciones: 10, altas: 4, con_pulsacion: 3 }],
};
const CUENTA_META = {
  id: 9, project_id: 1, ad_account_id: 'act_123', ad_account_nombre: 'Cuenta del campus', currency: 'EUR',
  last_synced_at: '2026-11-24T05:00:00Z', last_sync_status: 'ok', last_sync_error: null, backfill_done: true,
};
const PANEL_META = {
  daily: [{ date: '2026-11-20', spend: 50, impressions: 1000, clicks: 30, leads: 4 }],
  totals: { spend: 50, impressions: 1000, clicks: 30, leads: 4, cpl: 12.5, ctr: 3 },
};
const CAMPANA_META = {
  campaign_id: 'c1', nombre: 'Máster · noviembre', status: 'ACTIVE', effective_status: 'ACTIVE', total_spend: 50,
  total_impressions: 1000, total_clicks: 30, total_leads: 4, leads_crm: 3, ventas_crm: 1, cpl: 12.5, cpl_crm: 16.7, ctr: 3,
};
const RESPUESTAS = {
  '/secuencias-email': { success: true, data: [SECUENCIA] },
  '/forms': { success: true, data: [FORMULARIO] },
  '/widget/config': { success: true, data: WIDGET },
  '/widget/pulsaciones': { success: true, data: PULSACIONES },
  '/meta-ads/accounts': { success: true, data: [CUENTA_META] },
  '/meta-ads/dashboard': { success: true, data: PANEL_META },
  '/meta-ads/campaigns': { success: true, data: [CAMPANA_META] },
};
/** La respuesta por la ruta, sin la parte de los parámetros. */
const responder = async (url) => RESPUESTAS[String(url).split('?')[0]] ?? { success: true, data: [] };

const PANTALLAS = {
  'secuencias-email': { pintar: () => <EmailSequencesPage />, cargada: 'Bienvenida al máster' },
  formularios: { pintar: () => <FormsPage />, cargada: 'Landing del máster' },
  'widget-web': { pintar: () => <WhatsappWidgetPage />, cargada: 'Gestoras de Campus Uno' },
  // Meta Ads es de UN campus: con «Todos» y un solo campus a la vista sale el
  // desplegable (y ya viene elegido), así se ve todo.
  'meta-ads': { pintar: () => <MetaAdsPage />, cargada: 'Máster · noviembre', ambito: TODOS_DE_UNO },
};
const IDS = Object.keys(PANTALLAS);
const boton = (id) => `Ver recorrido: ${RECORRIDOS_GESTORA_F[id].titulo}`;
const pintar = (id) => {
  if (PANTALLAS[id].ambito) ambito.current = PANTALLAS[id].ambito;
  return render(<MemoryRouter>{PANTALLAS[id].pintar()}</MemoryRouter>);
};
const titulos = (id, fuera = []) => RECORRIDOS_GESTORA_F[id].pasos.map((p) => p.titulo).filter((t) => !fuera.includes(t));
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
    'email_sequences.view', 'email_sequences.create', 'forms.view', 'forms.create', 'widget.view', 'widget.edit',
    'meta_ads.view',
  ].forEach((k) => permisos.add(k));
  yo.current = { id: 41, role: 'admin' };
  ambito.current = UN_CAMPUS;
  api.get.mockReset();
  api.get.mockImplementation(responder);
});
afterEach(() => cleanup());

describe('Captación y publicidad, en el modelo (#619, tanda H)', () => {
  it('son cuatro, en el orden del menú, y están registrados con los demás (VerRecorrido y la prueba a 375 los ven)', () => {
    expect(Object.keys(RECORRIDOS_GESTORA_F)).toEqual(['secuencias-email', 'formularios', 'widget-web', 'meta-ads']);
    for (const id of IDS) expect(RECORRIDOS_COBROS[id]).toBe(RECORRIDOS_GESTORA_F[id]);
  });

  it('cada uno con el permiso con el que el menú y el servidor dejan ver su pantalla', () => {
    expect(Object.fromEntries(Object.values(RECORRIDOS_GESTORA_F).map((r) => [r.id, r.permiso]))).toEqual({
      'secuencias-email': 'email_sequences.view',
      formularios: 'forms.view',
      'widget-web': 'widget.view',
      'meta-ads': 'meta_ads.view',
    });
  });

  it.each(IDS)('%s: de 5 a 8 pasos, y su pantalla lo ofrece con el margen de scroll', (id) => {
    const r = RECORRIDOS_GESTORA_F[id];
    expect(r.pasos.length).toBeGreaterThanOrEqual(5);
    expect(r.pasos.length).toBeLessThanOrEqual(8);
    const codigo = r.pantalla.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
    expect(codigo).toMatch(new RegExp(`<VerRecorrido id="${id}"`));
    expect(codigo).toContain('[&_[data-recorrido]]:scroll-mt-40');
  });

  it('el botón «Recorrido» de la cabecera ofrece el de cada pantalla', () => {
    expect(recorridosDeLaRuta('/secuencias-email')).toEqual(['secuencias-email']);
    expect(recorridosDeLaRuta('/forms')).toEqual(['formularios']);
    expect(recorridosDeLaRuta('/captacion/whatsapp')).toEqual(['widget-web']);
    expect(recorridosDeLaRuta('/meta-ads')).toEqual(['meta-ads']);
    // Google Analytics no existe aquí: ni pantalla ni recorrido.
    expect(RECORRIDOS_COBROS['google-analytics']).toBeUndefined();
  });

  it('sin crear no se explica «Nueva»; sin configurar el widget, ni sus textos ni sus gestoras', () => {
    const email = pasosPara(RECORRIDOS_GESTORA_F['secuencias-email'], (k) => k === 'email_sequences.view').map((p) => p.titulo);
    expect(email).not.toContain('Nueva secuencia');
    const forms = pasosPara(RECORRIDOS_GESTORA_F.formularios, (k) => k === 'forms.view').map((p) => p.titulo);
    expect(forms).not.toContain('Nuevo formulario');
    const widget = pasosPara(RECORRIDOS_GESTORA_F['widget-web'], (k) => k === 'widget.view').map((p) => p.titulo);
    expect(widget).not.toContain('Los textos del botón');
    expect(widget).not.toContain('Quién sale en el botón');
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
  it('Email sin secuencias: se saltan la lista y sus botones', async () => {
    api.get.mockImplementation(async (url) => (String(url).startsWith('/secuencias-email') ? { success: true, data: [] } : responder(url)));
    pintar('secuencias-email');
    await screen.findByText('Sin secuencias', {}, { timeout: 5000 });
    expect(await abrirYRecorrer('secuencias-email')).toEqual(titulos('secuencias-email', ['Las secuencias', 'Pausar, editar o borrar']));
  });

  it('Email sin poder crear: sin «Nueva secuencia»', async () => {
    permisos.delete('email_sequences.create');
    pintar('secuencias-email');
    await cargada('secuencias-email');
    expect(await abrirYRecorrer('secuencias-email')).toEqual(titulos('secuencias-email', ['Nueva secuencia']));
  });

  it('Formularios sin ninguno: se saltan la lista y sus botones', async () => {
    api.get.mockImplementation(async (url) => (String(url).startsWith('/forms') ? { success: true, data: [] } : responder(url)));
    pintar('formularios');
    await screen.findByText('Sin forms', {}, { timeout: 5000 });
    expect(await abrirYRecorrer('formularios')).toEqual(titulos('formularios', ['Los formularios', 'Encender, pegar en la web, editar']));
  });

  it('Widget con «Todos» arriba: solo las pulsaciones, sumadas (lo demás se configura campus a campus)', async () => {
    ambito.current = TODOS;
    render(<MemoryRouter><WhatsappWidgetPage /></MemoryRouter>);
    await screen.findByText('Laura', {}, { timeout: 5000 });
    expect(document.querySelector('[data-recorrido="widget-codigo"]')).toBeNull();
    expect(await abrirYRecorrer('widget-web')).toEqual(titulos('widget-web').filter((t) => ['El botón de WhatsApp de la web', 'Cuántos lo pulsan', 'Y listo'].includes(t)));
  });

  it('Meta Ads con un campus fijo arriba: sin «El campus»', async () => {
    render(<MemoryRouter><MetaAdsPage /></MemoryRouter>);
    await cargada('meta-ads');
    expect(document.querySelector('[data-recorrido="meta-campus"]')).toBeNull();
    expect(await abrirYRecorrer('meta-ads')).toEqual(titulos('meta-ads', ['El campus']));
  });

  it('Meta Ads de quien solo consulta: sin «Sincronizar y conectar»', async () => {
    yo.current = { id: 41, role: 'colaborador' };
    pintar('meta-ads');
    await cargada('meta-ads');
    expect(document.querySelector('[data-recorrido="meta-acciones"]')).toBeNull();
    expect(await abrirYRecorrer('meta-ads')).toEqual(titulos('meta-ads', ['Sincronizar y conectar']));
  });

  it('sin «meta_ads.view», Meta Ads no ofrece recorrido', async () => {
    permisos.delete('meta_ads.view');
    pintar('meta-ads');
    await cargada('meta-ads');
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: /./ })).toBeNull();
  });
});
