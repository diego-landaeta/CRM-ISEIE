// @vitest-environment jsdom
// #186, gemela de MultiCRM#163 (frontend/src/test/compartidasFiltro163.test.jsx)
// y de la pantalla Ventas del 360 (frontend/src/test/compartidasVentas186.test.jsx).
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza, aquí.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * «Todas · Solo compartidas · Solo enteras» en Ventas (las tarjetas), en
 * Finanzas › Ingresos (la lista y sus tarjetas) y en Análisis de ventas. La
 * pantalla manda `compartidas` y el servidor filtra; con «Todas» no se manda
 * nada, como antes.
 */

if (typeof window !== 'undefined') {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({
    activeProject: { id: 1, nombre: 'Campus de prueba' }, activeIssuer: null, activeIssuerId: null,
    projects: [{ id: 1, nombre: 'Campus de prueba' }], switchProject: vi.fn(), switchIssuer: vi.fn(),
  }),
}));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true, veGestoras: false }) }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { default: IncomePage } = await import('@/modules/accounting/pages/IncomePage');
const { default: SalesAnalysisPage } = await import('@/modules/sales/pages/SalesAnalysisPage');
const { default: SalesPage } = await import('@/modules/sales/pages/SalesPage');
// Las tarjetas de Ventas son `lazy`: se cargan ya, para que la prueba no dependa de
// lo que tarde la primera carga de cada una.
await Promise.all([
  import('@/modules/sales/components/ResumenVentas'), import('@/modules/sales/components/CursosVendidosCard'),
  import('@/modules/sales/components/EvolucionVentas'), import('@/modules/sales/components/DesgloseVentas'),
  import('@/modules/sales/components/VentasPorPais'), import('@/modules/sales/components/ClientesVentas'),
]);

afterEach(cleanup);

beforeEach(() => {
  get.mockReset();
  // El resumen es un objeto: con `null` la pantalla espera sin romperse.
  get.mockImplementation(async (url) => (String(url).startsWith('/ventas/resumen')
    ? { success: true, data: null }
    : { success: true, data: [], pagination: { total: 0 } }));
});

/**
 * Los parámetros de la última llamada a esa ruta, vengan en `params` o en la
 * propia dirección (`/ventas/resumen?projectId=1&…`).
 */
function ultima(ruta) {
  const llamada = [...get.mock.calls].reverse().find(([u]) => String(u).split('?')[0] === ruta);
  if (!llamada) return null;
  const [url, opciones] = llamada;
  const deLaUrl = Object.fromEntries(new URLSearchParams(String(url).split('?')[1] || ''));
  return { ...deLaUrl, ...(opciones?.params || {}) };
}

describe('Finanzas › Ingresos', () => {
  it('con «Todas» no manda el filtro; con «Solo compartidas», sí (lista y tarjetas)', async () => {
    render(<MemoryRouter><IncomePage /></MemoryRouter>);
    await waitFor(() => expect(ultima('/conversions')).not.toBeNull());
    expect(ultima('/conversions')).not.toHaveProperty('compartidas');
    fireEvent.change(screen.getByLabelText('Reparto:'), { target: { value: 'solo' } });
    await waitFor(() => expect(ultima('/conversions')).toMatchObject({ compartidas: 'solo' }));
    // «Programas más vendidos», también.
    await waitFor(() => expect(ultima('/ventas/top-products')).toMatchObject({ compartidas: 'solo' }), { timeout: 10000 });
  }, 30000);

  it('«Solo enteras», también en la lista del periodo', async () => {
    render(<MemoryRouter><IncomePage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Reparto:'), { target: { value: 'enteras' } });
    await waitFor(() => expect(ultima('/conversions/filas')).toMatchObject({ compartidas: 'enteras' }));
  });

  it('«Quitar filtros» lo devuelve a «Todas»', async () => {
    render(<MemoryRouter><IncomePage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Reparto:'), { target: { value: 'solo' } });
    await waitFor(() => expect(ultima('/conversions')).toMatchObject({ compartidas: 'solo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    await waitFor(() => expect(ultima('/conversions')).not.toHaveProperty('compartidas'));
    expect(screen.getByLabelText('Reparto:')).toHaveValue('todas');
  });
});

describe('Finanzas › Ingresos, «Ver las cuotas»', () => {
  const vacio = { n: 0, importe: 0 };
  const TOTALES = {
    importe: 0, pagado: 0, pendiente: 0, iva: 0, facturadas: 0, sinFactura: 0, noRequiereFactura: 0, pendientesDeFacturar: 0,
    facturasDeAntes: { n: 1, importe: 40 }, facturadoEnPeriodo: { n: 1, importe: 40 },
    cobrosDelPeriodo: { matricula: vacio, cuotas: vacio }, cobradoDeMas: vacio,
    facturasPorClase: { venta: vacio, cuota: { n: 1, importe: 40 }, parte: vacio, suelta: vacio }, porProyecto: [],
  };
  it('manda el filtro, y al cambiarlo se vuelve a pedir', async () => {
    get.mockImplementation(async (url) => (url === '/conversions'
      ? { success: true, data: [], pagination: { total: 0 }, totales: TOTALES }
      : { success: true, data: [], pagination: { total: 0 } }));
    render(<MemoryRouter><IncomePage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Reparto:'), { target: { value: 'solo' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Ver las cuotas' }));
    await waitFor(() => expect(ultima('/conversions/cuotas')).toMatchObject({ compartidas: 'solo' }));
    // Cambiar el «Reparto» tira el desglose: era el del filtro de antes.
    fireEvent.change(screen.getByLabelText('Reparto:'), { target: { value: 'enteras' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Ver las cuotas' }));
    await waitFor(() => expect(ultima('/conversions/cuotas')).toMatchObject({ compartidas: 'enteras' }));
  });
});

describe('Análisis de ventas', () => {
  it('el resumen manda el filtro', async () => {
    render(<MemoryRouter><SalesAnalysisPage /></MemoryRouter>);
    await waitFor(() => expect(ultima('/ventas/resumen')).not.toBeNull());
    expect(ultima('/ventas/resumen')).not.toHaveProperty('compartidas');
    fireEvent.change(screen.getByLabelText('Reparto'), { target: { value: 'solo' } });
    await waitFor(() => expect(ultima('/ventas/resumen')).toMatchObject({ compartidas: 'solo' }));
  });
});

describe('Ventas · las tarjetas siguen al «Reparto»', () => {
  const TARJETAS = ['/ventas/resumen', '/ventas/top-products', '/ventas/serie', '/ventas/desglose', '/ventas/paises', '/ventas/por-cliente'];
  // Las tarjetas son `lazy`: la primera vez tardan en cargar más que el segundo por defecto.
  const ESPERA = { timeout: 20000 };

  it('con «Todas», ninguna lo manda; con «Solo compartidas», todas', async () => {
    render(<MemoryRouter><SalesPage /></MemoryRouter>);
    await waitFor(() => TARJETAS.forEach((t) => expect(ultima(t)).not.toBeNull()), ESPERA);
    TARJETAS.forEach((t) => expect(ultima(t)).not.toHaveProperty('compartidas'));
    fireEvent.change(screen.getByLabelText('Reparto'), { target: { value: 'solo' } });
    await waitFor(() => TARJETAS.forEach((t) => expect(ultima(t)).toMatchObject({ compartidas: 'solo' })), ESPERA);
  }, 60000);

  it('se combina con los demás filtros: el periodo sigue puesto', async () => {
    render(<MemoryRouter><SalesPage /></MemoryRouter>);
    await waitFor(() => expect(ultima('/ventas/resumen')).not.toBeNull(), ESPERA);
    const { from, to } = ultima('/ventas/resumen');
    fireEvent.change(screen.getByLabelText('Reparto'), { target: { value: 'enteras' } });
    await waitFor(() => expect(ultima('/ventas/resumen')).toMatchObject({ compartidas: 'enteras', from, to, projectId: '1' }), ESPERA);
  }, 30000);
});
