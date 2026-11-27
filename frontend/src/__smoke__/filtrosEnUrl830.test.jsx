// @vitest-environment jsdom
// #830, gemela de MultiCRM#1194 (frontend/src/test/filtrosEnUrl1194.test.jsx).
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza, aquí.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup as limpiar, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate, useNavigationType } from 'react-router-dom';

/**
 * Los filtros de Ventas y de Análisis de ventas viven en la dirección: recargar,
 * volver atrás desde una venta o pasar el enlace abre con los mismos filtros. Un
 * valor que no se entiende se ignora. ISEIE tiene un solo campus y no hay
 * empresas: lo del campus en la dirección es solo del 360.
 */

if (typeof window !== 'undefined') {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}
afterEach(() => cleanup());

const get = vi.hoisted(() => vi.fn());
const permisos = vi.hoisted(() => ({ veGestoras: true }));
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({
    activeProject: { id: 1, nombre: 'Campus de prueba' }, activeIssuer: null, activeIssuerId: null,
    projects: [{ id: 1, nombre: 'Campus de prueba', paises_por_subdominio: { es: 'ES', mx: 'MX' } }],
    switchProject: vi.fn(), switchIssuer: vi.fn(),
  }),
}));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true, veGestoras: permisos.veGestoras }) }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { default: SalesPage } = await import('@/modules/sales/pages/SalesPage');
const { default: SalesAnalysisPage } = await import('@/modules/sales/pages/SalesAnalysisPage');
const { default: IncomePage } = await import('@/modules/accounting/pages/IncomePage');
await Promise.all([
  import('@/modules/sales/components/ResumenVentas'), import('@/modules/sales/components/CursosVendidosCard'),
  import('@/modules/sales/components/EvolucionVentas'), import('@/modules/sales/components/DesgloseVentas'),
  import('@/modules/sales/components/VentasPorPais'), import('@/modules/sales/components/ClientesVentas'),
]);

const GESTORAS = [{ id: 7, nombre: 'Ana' }, { id: 9, nombre: 'Bea' }];

beforeEach(() => {
  get.mockReset();
  permisos.veGestoras = true;
  get.mockImplementation(async (url) => {
    const u = String(url);
    if (u.startsWith('/users')) return { success: true, data: GESTORAS };
    if (u.startsWith('/ventas/gestores-stats')) {
      return { success: true, data: { gestores: GESTORAS.map((g) => ({ user_id: g.id, nombre: g.nombre, role: 'gestor', ventas: 3 })) } };
    }
    if (u.startsWith('/conversions/productos')) return { success: true, data: ['Máster en Psicología', 'Curso de Coaching'] };
    if (u.startsWith('/ventas/resumen')) return { success: true, data: null };
    return { success: true, data: [], pagination: { total: 0 } };
  });
});

/** Los parámetros de la última llamada a esa ruta, en `params` o en la dirección. */
function ultima(ruta) {
  const llamada = [...get.mock.calls].reverse().find(([u]) => String(u).split('?')[0] === ruta);
  if (!llamada) return null;
  const [url, opciones] = llamada;
  const deLaUrl = Object.fromEntries(new URLSearchParams(String(url).split('?')[1] || ''));
  return { ...deLaUrl, ...(opciones?.params || {}) };
}

/**
 * Monta la pantalla en esa dirección, con la ficha de una venta al lado para
 * ir y volver. `router` dice dónde está, cómo llegó (PUSH/REPLACE/POP) y navega.
 */
function abrir(Pagina, ruta, entrada) {
  const router = { state: {}, navigate: null };
  function Espia() {
    router.state = { location: useLocation(), historyAction: useNavigationType() };
    router.navigate = useNavigate();
    return null;
  }
  const vista = render(
    <MemoryRouter initialEntries={[entrada]}>
      <Espia />
      <Routes>
        <Route path={ruta} element={<Pagina />} />
        <Route path={`${ruta}/:id`} element={<p>Ficha de la venta</p>} />
      </Routes>
    </MemoryRouter>,
  );
  const busqueda = () => new URLSearchParams(router.state.location.search);
  return { router, busqueda, ...vista };
}

const ESPERA = { timeout: 20000 };
const VENTAS = '/ventas';
const INGRESOS = '/accounting/income';
const ANALISIS = '/ventas/analisis';

describe('Contabilidad › Ingresos (/accounting/income) · los filtros en la dirección', () => {
  const MES = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  })();

  it('abrir con ?reparto=solo aplica el filtro (el enlace compartido)', async () => {
    abrir(IncomePage, INGRESOS, `${INGRESOS}?reparto=solo`);
    await waitFor(() => expect(ultima('/conversions')).toMatchObject({ compartidas: 'solo' }), ESPERA);
    expect(screen.getByLabelText('Reparto:')).toHaveValue('solo');
  }, 30000);

  it('cambiar el filtro cambia la dirección, sin llenar el historial', async () => {
    const { router, busqueda } = abrir(IncomePage, INGRESOS, INGRESOS);
    await waitFor(() => expect(ultima('/conversions')).not.toBeNull(), ESPERA);
    fireEvent.change(screen.getByLabelText('Reparto:'), { target: { value: 'enteras' } });
    await waitFor(() => expect(busqueda().get('reparto')).toBe('enteras'));
    expect(router.state.historyAction).toBe('REPLACE');
    await waitFor(() => expect(ultima('/conversions')).toMatchObject({ compartidas: 'enteras' }), ESPERA);
  }, 30000);

  it('al recargar salen los mismos filtros: reparto, gestora, curso y fechas', async () => {
    const primera = abrir(IncomePage, INGRESOS, INGRESOS);
    await waitFor(() => expect(screen.getByRole('option', { name: /Bea/ })).toBeInTheDocument(), ESPERA);
    fireEvent.change(screen.getByLabelText('Reparto:'), { target: { value: 'solo' } });
    await waitFor(() => expect(primera.busqueda().get('reparto')).toBe('solo'));
    fireEvent.change(screen.getByDisplayValue('— Todas (vista general) —'), { target: { value: '9' } });
    await waitFor(() => expect(primera.busqueda().get('gestora')).toBe('9'));
    fireEvent.change(await screen.findByDisplayValue('— Todos los cursos —'), { target: { value: 'Curso de Coaching' } });
    await waitFor(() => expect(primera.busqueda().get('curso')).toBe('Curso de Coaching'));
    fireEvent.click(screen.getByRole('button', { name: 'Mes pasado' }));
    await waitFor(() => expect(primera.busqueda().get('desde')).not.toBeNull());
    const { desde, hasta } = Object.fromEntries(primera.busqueda());
    const direccion = primera.router.state.location.pathname + primera.router.state.location.search;
    primera.unmount();

    get.mockClear();
    abrir(IncomePage, INGRESOS, direccion);
    await waitFor(() => expect(ultima('/conversions')).toMatchObject({
      compartidas: 'solo', responsableId: 9, producto: 'Curso de Coaching', from: desde, to: hasta,
    }), ESPERA);
    expect(screen.getByLabelText('Reparto:')).toHaveValue('solo');
  }, 60000);

  it('el botón atrás desde la ficha de una venta vuelve con los filtros puestos', async () => {
    const { router, busqueda } = abrir(IncomePage, INGRESOS, INGRESOS);
    await waitFor(() => expect(ultima('/conversions')).not.toBeNull(), ESPERA);
    fireEvent.change(screen.getByLabelText('Reparto:'), { target: { value: 'solo' } });
    await waitFor(() => expect(busqueda().get('reparto')).toBe('solo'));
    act(() => router.navigate(`${INGRESOS}/42`));
    expect(screen.getByText('Ficha de la venta')).toBeInTheDocument();
    act(() => router.navigate(-1));
    expect(router.state.historyAction).toBe('POP');
    await waitFor(() => expect(screen.getByLabelText('Reparto:')).toHaveValue('solo'), ESPERA);
    expect(busqueda().get('reparto')).toBe('solo');
  }, 30000);

  it('borrar una fecha a mano se conserva como «sin fecha», no vuelve la del mes', async () => {
    const { busqueda } = abrir(IncomePage, INGRESOS, INGRESOS);
    await waitFor(() => expect(ultima('/conversions')).toMatchObject({ from: MES }), ESPERA);
    const [desde] = screen.getAllByDisplayValue(MES);
    fireEvent.change(desde, { target: { value: '' } });
    await waitFor(() => expect(busqueda().get('desde')).toBe('no'));
    await waitFor(() => expect(ultima('/conversions')).not.toHaveProperty('from'), ESPERA);
  }, 30000);

  it('un valor que no se entiende se ignora y la pantalla no se rompe', async () => {
    abrir(IncomePage, INGRESOS, `${INGRESOS}?reparto=mitad&desde=2026-13-01&hasta=x&gestora=-3`);
    await waitFor(() => expect(ultima('/conversions')).not.toBeNull(), ESPERA);
    const p = ultima('/conversions');
    expect(p).not.toHaveProperty('compartidas');
    expect(p).not.toHaveProperty('responsableId');
    expect(p.from).toBe(MES);
    expect(screen.getByLabelText('Reparto:')).toHaveValue('todas');
  }, 30000);

  it('una gestora que no está en su lista se ignora; a quien no ve el equipo, ni se manda', async () => {
    abrir(IncomePage, INGRESOS, `${INGRESOS}?gestora=55`);
    await waitFor(() => expect(screen.getByRole('option', { name: /Bea/ })).toBeInTheDocument(), ESPERA);
    await waitFor(() => expect(ultima('/conversions')).not.toHaveProperty('responsableId'), ESPERA);
    limpiar();
    permisos.veGestoras = false;
    get.mockClear();
    abrir(IncomePage, INGRESOS, `${INGRESOS}?gestora=9`);
    await waitFor(() => expect(ultima('/conversions')).not.toBeNull(), ESPERA);
    expect(ultima('/conversions')).not.toHaveProperty('responsableId');
  }, 30000);

  it('«Quitar filtros» limpia también la dirección', async () => {
    const { busqueda } = abrir(IncomePage, INGRESOS, `${INGRESOS}?reparto=solo&desde=2026-01-01&hasta=2026-01-31`);
    fireEvent.click(await screen.findByText('Quitar filtros', {}, ESPERA));
    await waitFor(() => expect(busqueda().get('reparto')).toBeNull());
    expect(busqueda().get('desde')).toBeNull();
    await waitFor(() => expect(ultima('/conversions')).toMatchObject({ from: MES }), ESPERA);
  }, 30000);
});

describe('Ventas · los filtros en la dirección', () => {
  it('abrir con ?reparto=solo aplica el filtro (el enlace compartido)', async () => {
    abrir(SalesPage, VENTAS, `${VENTAS}?reparto=solo`);
    await waitFor(() => expect(ultima('/ventas/resumen')).toMatchObject({ compartidas: 'solo' }), ESPERA);
    expect(screen.getByLabelText('Reparto')).toHaveValue('solo');
  }, 30000);

  it('cambiar el filtro cambia la dirección, sin llenar el historial', async () => {
    const { router, busqueda } = abrir(SalesPage, VENTAS, VENTAS);
    await waitFor(() => expect(ultima('/ventas/resumen')).not.toBeNull(), ESPERA);
    fireEvent.change(screen.getByLabelText('Reparto'), { target: { value: 'enteras' } });
    await waitFor(() => expect(busqueda().get('reparto')).toBe('enteras'));
    expect(router.state.historyAction).toBe('REPLACE');
    await waitFor(() => expect(ultima('/ventas/resumen')).toMatchObject({ compartidas: 'enteras' }), ESPERA);
  }, 30000);

  it('al recargar salen los mismos filtros: reparto, gestora, país y fechas', async () => {
    const primera = abrir(SalesPage, VENTAS, VENTAS);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bea' })).toBeInTheDocument(), ESPERA);
    fireEvent.change(screen.getByLabelText('Reparto'), { target: { value: 'solo' } });
    await waitFor(() => expect(primera.busqueda().get('reparto')).toBe('solo'));
    fireEvent.change(screen.getByTitle('Filtrar por gestora'), { target: { value: '9' } });
    await waitFor(() => expect(primera.busqueda().get('gestora')).toBe('9'));
    fireEvent.change(screen.getByLabelText('País de entrada'), { target: { value: 'MX' } });
    await waitFor(() => expect(primera.busqueda().get('pais')).toBe('MX'));
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-03-01' } });
    await waitFor(() => expect(primera.busqueda().get('desde')).toBe('2026-03-01'));
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-03-31' } });
    await waitFor(() => expect(primera.busqueda().get('hasta')).toBe('2026-03-31'));
    const direccion = primera.router.state.location.pathname + primera.router.state.location.search;
    primera.unmount();

    get.mockClear();
    abrir(SalesPage, VENTAS, direccion);
    await waitFor(() => expect(ultima('/ventas/resumen')).toMatchObject({
      compartidas: 'solo', responsableId: '9', paisEntrada: 'MX', from: '2026-03-01', to: '2026-03-31',
    }), ESPERA);
    expect(screen.getByLabelText('Reparto')).toHaveValue('solo');
    expect(screen.getByLabelText('País de entrada')).toHaveValue('MX');
  }, 60000);

  it('el botón atrás desde la ficha de una venta vuelve con los filtros puestos', async () => {
    const { router, busqueda } = abrir(SalesPage, VENTAS, VENTAS);
    await waitFor(() => expect(ultima('/ventas/resumen')).not.toBeNull(), ESPERA);
    fireEvent.change(screen.getByLabelText('Reparto'), { target: { value: 'solo' } });
    await waitFor(() => expect(busqueda().get('reparto')).toBe('solo'));
    act(() => router.navigate(`${VENTAS}/42`));
    expect(screen.getByText('Ficha de la venta')).toBeInTheDocument();
    act(() => router.navigate(-1));
    expect(router.state.historyAction).toBe('POP');
    await waitFor(() => expect(screen.getByLabelText('Reparto')).toHaveValue('solo'), ESPERA);
    expect(busqueda().get('reparto')).toBe('solo');
  }, 30000);

  it('un valor que no se entiende se ignora y la pantalla no se rompe', async () => {
    abrir(SalesPage, VENTAS, `${VENTAS}?reparto=mitad&periodo=siempre&desde=2026-02-31&hasta=ayer&gestora=abc&pais=ZZ`);
    await waitFor(() => expect(ultima('/ventas/resumen')).not.toBeNull(), ESPERA);
    const p = ultima('/ventas/resumen');
    expect(p).not.toHaveProperty('compartidas');
    expect(p).not.toHaveProperty('responsableId');
    expect(p).not.toHaveProperty('paisEntrada');
    // El año en curso, que es como se abre.
    expect(p.from).toBe(`${new Date().getFullYear()}-01-01`);
    expect(screen.getByLabelText('Reparto')).toHaveValue('todas');
    expect(screen.queryByText('Quitar filtros')).toBeNull();
  }, 30000);

  it('a quien no elige gestora, la gestora de la dirección no se le manda', async () => {
    permisos.veGestoras = false;
    abrir(SalesPage, VENTAS, `${VENTAS}?gestora=9`);
    await waitFor(() => expect(ultima('/ventas/resumen')).not.toBeNull(), ESPERA);
    expect(ultima('/ventas/resumen')).not.toHaveProperty('responsableId');
    expect(get.mock.calls.some(([u]) => String(u).startsWith('/users'))).toBe(false);
  }, 30000);

  it('una gestora que no está en la lista se ignora en cuanto llega la lista', async () => {
    abrir(SalesPage, VENTAS, `${VENTAS}?gestora=55`);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bea' })).toBeInTheDocument(), ESPERA);
    await waitFor(() => expect(ultima('/ventas/resumen')).not.toHaveProperty('responsableId'), ESPERA);
  }, 30000);

  it('«Quitar filtros» limpia también la dirección', async () => {
    const { busqueda } = abrir(SalesPage, VENTAS, `${VENTAS}?reparto=solo&periodo=mes&pais=ES`);
    fireEvent.click(await screen.findByText('Quitar filtros', {}, ESPERA));
    await waitFor(() => expect(busqueda().get('reparto')).toBeNull());
    expect(busqueda().get('periodo')).toBeNull();
    expect(busqueda().get('pais')).toBeNull();
    expect(screen.getByLabelText('Reparto')).toHaveValue('todas');
  }, 30000);
});

describe('Análisis de ventas · los filtros en la dirección', () => {
  it('abrir con ?reparto=solo, la vista, la búsqueda y la página los aplica', async () => {
    abrir(SalesAnalysisPage, ANALISIS, `${ANALISIS}?reparto=solo&vista=cliente&q=ana&pagina=2&desde=2026-01-01&hasta=2026-06-30`);
    await waitFor(() => expect(ultima('/ventas/por-cliente')).toMatchObject({
      compartidas: 'solo', search: 'ana', page: 2, from: '2026-01-01', to: '2026-06-30',
    }));
    expect(screen.getByLabelText('Reparto')).toHaveValue('solo');
    expect(screen.getByPlaceholderText('Cliente, email o programa…')).toHaveValue('ana');
  });

  it('cambiar el filtro cambia la dirección y vuelve a la primera página', async () => {
    const { router, busqueda } = abrir(SalesAnalysisPage, ANALISIS, `${ANALISIS}?vista=cliente&pagina=3`);
    await waitFor(() => expect(ultima('/ventas/por-cliente')).toMatchObject({ page: 3 }));
    fireEvent.change(screen.getByLabelText('Reparto'), { target: { value: 'enteras' } });
    await waitFor(() => expect(busqueda().get('reparto')).toBe('enteras'));
    expect(busqueda().get('pagina')).toBeNull();
    expect(busqueda().get('vista')).toBe('cliente');
    expect(router.state.historyAction).toBe('REPLACE');
    await waitFor(() => expect(ultima('/ventas/por-cliente')).toMatchObject({ compartidas: 'enteras', page: 1 }));
  });

  it('buscar y cambiar de vista también van a la dirección', async () => {
    const { busqueda } = abrir(SalesAnalysisPage, ANALISIS, ANALISIS);
    fireEvent.change(screen.getByPlaceholderText('Cliente, email o programa…'), { target: { value: ' Luis ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(busqueda().get('q')).toBe('Luis'));
    fireEvent.click(screen.getByRole('button', { name: /Por asesora/ }));
    await waitFor(() => expect(busqueda().get('vista')).toBe('asesora'));
    await waitFor(() => expect(ultima('/ventas/por-asesora')).toMatchObject({ search: 'Luis' }));
  });

  it('un valor que no se entiende se ignora y la pantalla no se rompe', async () => {
    abrir(SalesAnalysisPage, ANALISIS, `${ANALISIS}?reparto=x&vista=nada&pagina=-4&desde=31-12-2026`);
    await waitFor(() => expect(ultima('/ventas/resumen')).not.toBeNull());
    const p = ultima('/ventas/resumen');
    expect(p).not.toHaveProperty('compartidas');
    expect(p).not.toHaveProperty('from');
    expect(screen.getByLabelText('Reparto')).toHaveValue('todas');
  });

  it('«Quitar filtros» limpia también la dirección', async () => {
    const { busqueda } = abrir(SalesAnalysisPage, ANALISIS, `${ANALISIS}?reparto=solo&q=ana&desde=2026-01-01`);
    fireEvent.click(await screen.findByText('Quitar filtros'));
    await waitFor(() => expect(busqueda().get('reparto')).toBeNull());
    expect(busqueda().get('q')).toBeNull();
    expect(busqueda().get('desde')).toBeNull();
    expect(screen.getByPlaceholderText('Cliente, email o programa…')).toHaveValue('');
    await waitFor(() => expect(ultima('/ventas/resumen')).not.toHaveProperty('compartidas'));
  });
});
