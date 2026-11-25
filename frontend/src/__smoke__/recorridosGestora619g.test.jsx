// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

/*
  #619, tanda I, la última; gemela de CRM#941 (Diego, 19/11: «las que son así,
  dáselas a Ángel CEDIA»): «Ver recorrido» en el bloque Académico: Productos,
  Cursos pendientes, WooCommerce, Árbol de categorías, Mis cursos del tutor y
  Sin tutor. «Productos por categoría», del 360, aquí no existe.

  Se pinta cada pantalla de verdad, con datos en los que sale todo, y se recorre
  entera: cada paso encuentra su sitio y ninguno se salta. Lo que no está (no hay
  productos, la tienda sin conectar, una tutora, quien solo consulta, un mes sin
  cobros) se salta solo. Que cada anclaje sigue en el código y que los permisos
  existen lo comprueba `recorridosCobros.test.jsx` (estos se suman a
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
    put: vi.fn(async () => ({ success: true })),
    patch: vi.fn(async () => ({ success: true })),
    delete: vi.fn(async () => ({ success: true })),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: yo.current, ...ambito.current }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ambito.current }));
vi.mock('@/shared/hooks/usePermission', () => ({
  default: () => ({ can: (k) => permisos.has(k), tieneRol: (...r) => r.includes(yo.current.role) }),
}));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
// Las gráficas de «Mis cursos» (recharts) lo piden y jsdom no lo trae.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const { RECORRIDOS_COBROS, claveRecorrido, pasosPara } = await import('@/shared/lib/recorridosCobros');
const { RECORRIDOS_GESTORA_G } = await import('@/shared/lib/recorridosGestoraG');
const { recorridosDeLaRuta } = await import('@/shared/lib/recorridosPorRuta');
const { ConfirmProvider } = await import('@/shared/components/ui/useConfirm');
const { default: ProductsPage } = await import('@/modules/products/pages/ProductsPage');
const { default: CoursesPendingPage } = await import('@/modules/products/pages/CoursesPendingPage');
const { default: WooCommercePage } = await import('@/modules/woocommerce/pages/WooCommercePage');
const { default: CategoriesTreePage } = await import('@/modules/product-categories/pages/CategoriesTreePage');
const { default: MisCursosPage } = await import('@/modules/tutores/pages/MisCursosPage');
const { default: FormacionesSinTutorPage } = await import('@/modules/tutores/pages/FormacionesSinTutorPage');

const SRC = path.resolve(__dirname, '..');
const CAMPUS = [{ id: 1, nombre: 'Campus Uno' }];
const UN_CAMPUS = { activeProject: CAMPUS[0], projects: CAMPUS, isAllProjects: false };
const MES = (() => { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`; })();

const CATEGORIA = {
  id: 7, parent_id: null, nombre: 'Psicología', orden: 1, source: 'wc', external_url: null, external_id: null,
  active: true, productos_count: 1, children: [],
};
const PRODUCTO = {
  id: 5, project_id: 1, nombre: 'Máster en Psicología Clínica', sku: 'MPC-1', precio: 1500, moneda: 'EUR',
  active: true, modalidad: 'online', image_url: null,
};
const PENDIENTE = {
  id: 11, project_id: 1, campus: 'Campus Uno', product_id: 5, nombre: 'Curso de Mindfulness', url_prevista: null,
  tipo: 'curso', tutor_id: 8, tutora: 'Sara', estado: 'en_desarrollo', fecha_solicitud: '2026-11-01',
  fecha_comprometida: '2026-11-20', fecha_publicacion: null, veces_movida_fecha: 0, avance_foto: true,
  avance_video: false, avance_modulos: 40, url_publicada: null, notas: null, retrasado: true,
  dias_para_la_fecha: -5, alumnas_esperando: 3, alumnas_total: 3,
};
const RESUMEN = {
  campus: [{ project_id: 1, campus: 'Campus Uno', abiertos: 1, retrasados: 1, sin_tutora: 0, alumnas_esperando: 3 }],
  total: { abiertos: 1, retrasados: 1, sin_tutora: 0, alumnas_esperando: 3 },
  carga_por_tutora: [{ tutor_id: 8, tutora: 'Sara', abiertos: 1, cursos: 1, diplomados: 0, masters: 0, retrasados: 1 }],
  indicadores: [{ project_id: 1, campus: 'Campus Uno', dias_medios_venta_a_habilitada: '4', publicados_sin_habilitar: 0 }],
};
const CREDENCIALES = {
  store_url: 'https://tienda.ejemplo.com', consumer_key: 'ck_prueba', auto_sync_enabled: false,
  sync_interval_minutes: 30, default_currency: 'EUR', wp_user: null, source_strategy: 'wc_only', cpt_endpoints: [],
  scraper_enabled: false, scrape_strategy: 'plain_text',
};
const IMPORTACION = {
  id: 3, started_at: '2026-11-24T05:00:00Z', status: 'success', total_fetched: 120, total_created: 4,
  total_updated: 116, total_skipped: 0, error_message: null,
};
const COLABORACION = {
  id: 2, tutor_id: 41, product_id: 5, pct: '20', vigente_desde: '2026-01-01', vigente_hasta: null, activa: true,
  notas: null, tutor: 'Sara', formacion: 'Máster en Psicología Clínica', precio: '1500', project_id: 1,
  proyecto: 'Campus Uno', rige_hoy: true,
};
const COMISION = {
  id: 30, periodo: MES, estado: 'pendiente', base_calculo: '500', pct: '20', importe: '100', fecha_liquidacion: null,
  tutor_id: 41, tutor: 'Sara', product_id: 5, formacion: 'Máster en Psicología Clínica', project_id: 1,
  proyecto: 'Campus Uno', fecha_cobro: `${MES}-10`, cobro: '500', alumno: 'Lucía Pérez', liquidada_por_nombre: null,
};
const RESUMEN_COMISION = {
  periodo: MES, tutor_id: 41, tutor: 'Sara', tutor_email: null, tutor_iban: null, lineas: 1, base: '500',
  pendiente: '100', pagada: '0',
};
const SIN_TUTOR = {
  id: 9, nombre: 'Diplomado en Neuropsicología', precio: '900', proyecto: 'Campus Uno', project_id: 1, ventas: 2,
  alumnos: 2, pagos: 3, cobrado: '1200', primer_cobro: '2026-10-01', ultimo_cobro: '2026-11-20', buscando: true,
  busqueda_nota: null, busqueda_desde: '2026-11-01',
};

const RESPUESTAS = {
  '/products': { success: true, data: [PRODUCTO] },
  '/product-categories/tree': { success: true, data: [CATEGORIA] },
  '/woocommerce/runs/current': { success: true, data: null },
  '/cursos-pendientes': { success: true, data: [PENDIENTE] },
  '/cursos-pendientes/resumen': { success: true, data: RESUMEN },
  '/woocommerce/credentials': { success: true, data: CREDENCIALES },
  '/woocommerce/runs': { success: true, data: [IMPORTACION] },
  '/tutores/colaboraciones': { success: true, data: [COLABORACION] },
  '/tutores/comisiones': { success: true, data: [COMISION] },
  '/tutores/comisiones/resumen': { success: true, data: [RESUMEN_COMISION] },
  '/tutores/formaciones-sin-tutor': { success: true, data: [SIN_TUTOR] },
};
/** La respuesta por la ruta, sin la parte de los parámetros. */
const responder = async (url) => RESPUESTAS[String(url).split('?')[0]] ?? { success: true, data: [] };

const PANTALLAS = {
  productos: { pintar: () => <ProductsPage />, cargada: 'Máster en Psicología Clínica' },
  'cursos-pendientes': { pintar: () => <CoursesPendingPage />, cargada: 'Curso de Mindfulness' },
  woocommerce: { pintar: () => <WooCommercePage />, cargada: 'Fetched' },
  'arbol-categorias': { pintar: () => <CategoriesTreePage />, cargada: 'Psicología' },
  // La pantalla del tutor: la mira él.
  'mis-cursos': { pintar: () => <MisCursosPage />, cargada: 'Lucía', rol: 'tutor' },
  'sin-tutor': { pintar: () => <FormacionesSinTutorPage />, cargada: 'Diplomado en Neuropsicología' },
};
const IDS = Object.keys(PANTALLAS);
const boton = (id) => `Ver recorrido: ${RECORRIDOS_GESTORA_G[id].titulo}`;
const pintar = (id) => {
  if (PANTALLAS[id].rol) yo.current = { id: 41, role: PANTALLAS[id].rol };
  // Con el «¿seguro?» de la app (`useConfirm`), como en `App.jsx`.
  return render(<MemoryRouter><ConfirmProvider>{PANTALLAS[id].pintar()}</ConfirmProvider></MemoryRouter>);
};
const titulos = (id, fuera = []) => RECORRIDOS_GESTORA_G[id].pasos.map((p) => p.titulo).filter((t) => !fuera.includes(t));
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
    'products.view', 'products.create', 'products.categorias', 'woocommerce.view', 'woocommerce.edit',
    'woocommerce.sync', 'tutores.gestionar', 'tutores.mis_cursos',
  ].forEach((k) => permisos.add(k));
  yo.current = { id: 41, role: 'admin' };
  ambito.current = UN_CAMPUS;
  api.get.mockReset();
  api.get.mockImplementation(responder);
});
afterEach(() => cleanup());

describe('el bloque Académico, en el modelo (#619, tanda I)', () => {
  it('son seis, en el orden del menú, y están registrados con los demás (VerRecorrido y la prueba a 375 los ven)', () => {
    expect(Object.keys(RECORRIDOS_GESTORA_G)).toEqual(['productos', 'cursos-pendientes', 'woocommerce', 'arbol-categorias', 'mis-cursos', 'sin-tutor']);
    for (const id of IDS) expect(RECORRIDOS_COBROS[id]).toBe(RECORRIDOS_GESTORA_G[id]);
  });

  it('cada uno con el permiso con el que el menú y el servidor dejan ver su pantalla', () => {
    expect(Object.fromEntries(Object.values(RECORRIDOS_GESTORA_G).map((r) => [r.id, r.permiso]))).toEqual({
      productos: 'products.view',
      'cursos-pendientes': ['products.view', 'tutores.mis_cursos'],
      woocommerce: 'woocommerce.view',
      'arbol-categorias': 'products.categorias',
      'mis-cursos': 'tutores.mis_cursos',
      'sin-tutor': 'tutores.gestionar',
    });
  });

  it.each(IDS)('%s: de 5 a 8 pasos, y su pantalla lo ofrece con el margen de scroll', (id) => {
    const r = RECORRIDOS_GESTORA_G[id];
    expect(r.pasos.length).toBeGreaterThanOrEqual(5);
    expect(r.pasos.length).toBeLessThanOrEqual(8);
    const codigo = r.pantalla.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
    expect(codigo).toMatch(new RegExp(`<VerRecorrido id="${id}"`));
    expect(codigo).toContain('[&_[data-recorrido]]:scroll-mt-40');
  });

  it('el botón «Recorrido» de la cabecera ofrece el de cada pantalla, y no el de otra', () => {
    expect(recorridosDeLaRuta('/products')).toEqual(['productos']);
    expect(recorridosDeLaRuta('/products/pending')).toEqual(['cursos-pendientes']);
    expect(recorridosDeLaRuta('/woocommerce')).toEqual(['woocommerce']);
    expect(recorridosDeLaRuta('/configuracion/categorias-arbol')).toEqual(['arbol-categorias']);
    expect(recorridosDeLaRuta('/mis-cursos')).toEqual(['mis-cursos']);
    expect(recorridosDeLaRuta('/tutores/sin-tutor')).toEqual(['sin-tutor']);
    // La ficha de un producto no es el catálogo, ni «Mi campus» es «Mis cursos».
    expect(recorridosDeLaRuta('/products/5')).toEqual([]);
    expect(recorridosDeLaRuta('/mis-cursos/campus')).not.toContain('mis-cursos');
  });

  it('la tutora (solo «Sus cursos») tiene el de Cursos pendientes, sin cambiar de vista; quien solo ve la tienda, sin conectarla', () => {
    const tutora = (k) => k === 'tutores.mis_cursos';
    expect(pasosPara(RECORRIDOS_GESTORA_G['cursos-pendientes'], tutora).map((p) => p.titulo)).not.toContain('Cursos o control de subidas');
    const soloVer = pasosPara(RECORRIDOS_GESTORA_G.woocommerce, (k) => k === 'woocommerce.view').map((p) => p.titulo);
    expect(soloVer).not.toContain('Conectar la tienda');
    expect(soloVer).not.toContain('WordPress y la página del curso');
    expect(soloVer).not.toContain('Importar');
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
  it('Productos sin ninguno: sin la vista ni la lista', async () => {
    api.get.mockImplementation(async (url) => (String(url).startsWith('/products') ? { success: true, data: [] } : responder(url)));
    pintar('productos');
    await screen.findByText('Sin productos todavía', {}, { timeout: 5000 });
    expect(await abrirYRecorrer('productos')).toEqual(titulos('productos', ['Los productos']));
  });

  it('Productos de quien solo consulta: sin «Nuevo producto»', async () => {
    permisos.delete('products.create');
    pintar('productos');
    await cargada('productos');
    expect(await abrirYRecorrer('productos')).toEqual(titulos('productos', ['Nuevo producto']));
  });

  it('Cursos pendientes de una tutora: lo suyo, sin cambiar de vista, crear ni la carga de todas', async () => {
    permisos.clear();
    permisos.add('tutores.mis_cursos');
    yo.current = { id: 41, role: 'tutor' };
    api.get.mockImplementation(async (url) => (String(url).startsWith('/cursos-pendientes/resumen')
      ? { success: true, data: { ...RESUMEN, carga_por_tutora: null, indicadores: null } } : responder(url)));
    pintar('cursos-pendientes');
    await cargada('cursos-pendientes');
    expect(await abrirYRecorrer('cursos-pendientes')).toEqual(titulos('cursos-pendientes', ['Cursos o control de subidas', 'Nuevo pendiente', 'Carga y tiempos']));
  });

  it('WooCommerce sin la tienda conectada: sin «Importar»', async () => {
    api.get.mockImplementation(async (url) => (String(url).startsWith('/woocommerce/credentials') ? { success: true, data: null } : responder(url)));
    pintar('woocommerce');
    await cargada('woocommerce');
    expect(await abrirYRecorrer('woocommerce')).toEqual(titulos('woocommerce', ['Importar']));
  });

  it('Árbol de categorías vacío: sin «El árbol»', async () => {
    api.get.mockImplementation(async (url) => (String(url).startsWith('/product-categories/tree') ? { success: true, data: [] } : responder(url)));
    pintar('arbol-categorias');
    await screen.findByText(/Sin categorias en este proyecto/, {}, { timeout: 5000 });
    expect(await abrirYRecorrer('arbol-categorias')).toEqual(titulos('arbol-categorias', ['El árbol']));
  });

  it('Mis cursos sin cursos ni cobros: todo menos la lista sigue ahí (lo vacío lo dice)', async () => {
    api.get.mockImplementation(async (url) => (String(url).startsWith('/tutores/') ? { success: true, data: [] } : responder(url)));
    pintar('mis-cursos');
    await screen.findByText('Todavía no tienes cursos asignados', {}, { timeout: 5000 });
    expect(await abrirYRecorrer('mis-cursos')).toEqual(titulos('mis-cursos'));
  });

  it('Sin tutor, cuando todas lo tienen: sin la suma, la lista ni sus botones', async () => {
    api.get.mockImplementation(async (url) => (String(url).startsWith('/tutores/formaciones-sin-tutor') ? { success: true, data: [] } : responder(url)));
    pintar('sin-tutor');
    await screen.findByText('Todas tienen tutor', {}, { timeout: 5000 });
    expect(await abrirYRecorrer('sin-tutor')).toEqual(titulos('sin-tutor', ['Lo que suma', 'La lista', 'Se busca tutor', 'Asignar tutor']));
  });

  it('sin «tutores.mis_cursos», Mis cursos no ofrece recorrido', async () => {
    permisos.delete('tutores.mis_cursos');
    pintar('mis-cursos');
    await cargada('mis-cursos');
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: /./ })).toBeNull();
  });
});
