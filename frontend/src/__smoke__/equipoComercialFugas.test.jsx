// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  Equipo comercial: lo que la pantalla le enseñaba a una líder y el servidor le
  niega o le recorta (QA del 09/11/2026).

  · `usePermission().llevaEquipo` sale de `alcance_comercial` de /auth/me.
  · Facturas: sin Editar (corregir), Abono, Venta ni Eliminar para quien lleva
    equipo (el servidor responde 403); quien no lo lleva, como siempre.
  · Finanzas › Dashboard: sin Egresos ni Balance cuando el servidor dice
    `solo_administracion`, y con la nota que lo explica.
*/

const sesion = vi.hoisted(() => ({
  user: { id: 5, role: 'admin' },
  permissions: { '*': true },
  alcanceComercial: null,
  projects: [{ id: 4, nombre: 'Campus A' }],
}));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const facturas = vi.hoisted(() => ({
  list: vi.fn(), stats: vi.fn(), listIssuers: vi.fn(), ventasSinFactura: vi.fn(),
}));

vi.mock('@/shared/api/client', () => ({ default: api, API_BASE_URL: '/api' }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => sesion }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({
    activeProject: { id: 4, nombre: 'Campus A', sociedad_emisora_id: null },
    activeIssuerId: null,
    projects: sesion.projects,
    switchProject: vi.fn(),
  }),
}));
vi.mock('@/modules/invoices/api/invoices.api', () => ({ invoicesApi: facturas, invoiceFaltantes: () => [] }));
// Lo que no se mira aquí y hace sus propias llamadas.
vi.mock('@/modules/invoices/components/FacturacionAlDiaCard', () => ({ default: () => null }));
vi.mock('@/modules/invoices/components/AvisoHuecosFacturas', () => ({ default: () => null }));
vi.mock('@/modules/invoices/components/TutorialButton', () => ({ default: () => null }));
vi.mock('recharts', () => {
  const Nada = ({ children }) => children ?? null;
  return {
    ResponsiveContainer: Nada, BarChart: Nada, LineChart: Nada, Bar: () => null, Line: () => null,
    XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null, Legend: () => null,
  };
});

const { default: usePermission } = await import('@/shared/hooks/usePermission');
const { default: InvoicesPage } = await import('@/modules/invoices/pages/InvoicesPage');
const { default: AccountingDashboardPage } = await import('@/modules/accounting/pages/AccountingDashboardPage');

const FACTURA = {
  id: 77, codigo: 'A-2026-0077', numero: 77, serie: 'A', estado: 'emitida', tipo: 'normal',
  cliente_nombre: 'Cliente Uno', cliente_email: null, total: 120, fecha_emision: '2026-11-02',
  project_id: 4, conversion_id: 9, moneda: 'EUR',
};

const DASHBOARD = {
  ingresos: { total_cobrado: 100, total_facturado: 500, total_pendiente: 400, total_emitido: 120, num_facturas: 1 },
  egresos: { total: 0, num_egresos: 0, por_categoria: [] },
  balance: null,
  cuentas_por_cobrar: [],
  cuentas_por_cobrar_resumen: { num: 0, total: 0, num_vencido: 0, total_vencido: 0 },
  trend: { ingresos: [], egresos: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  sesion.alcanceComercial = null;
  facturas.list.mockResolvedValue({ success: true, data: [FACTURA], pagination: { total: 1 } });
  facturas.stats.mockResolvedValue({ success: true, data: null });
  facturas.listIssuers.mockResolvedValue({ success: true, data: [] });
  facturas.ventasSinFactura.mockResolvedValue({ success: true, data: [] });
  api.get.mockResolvedValue({ success: true, data: [] });
});
afterEach(cleanup);

describe('usePermission().llevaEquipo', () => {
  it('con alcance de más de una persona, lleva equipo; null o solo ella, no', () => {
    sesion.alcanceComercial = [5, 11, 12];
    expect(renderHook(() => usePermission()).result.current.llevaEquipo).toBe(true);
    sesion.alcanceComercial = null;
    expect(renderHook(() => usePermission()).result.current.llevaEquipo).toBe(false);
    sesion.alcanceComercial = [5];
    expect(renderHook(() => usePermission()).result.current.llevaEquipo).toBe(false);
  });
});

describe('Facturas: los botones que el servidor le niega a quien lleva equipo', () => {
  const pintar = () => render(<MemoryRouter><InvoicesPage /></MemoryRouter>);

  it('admin sin equipo: Editar, Abono, Venta y Eliminar', async () => {
    pintar();
    expect(await screen.findByText('Cliente Uno')).toBeInTheDocument();
    expect(screen.getByTitle('Editar IVA, datos del cliente o concepto')).toBeInTheDocument();
    expect(screen.getByTitle('Crear factura rectificativa (de abono)')).toBeInTheDocument();
    expect(screen.getByTitle('Asociar esta factura a una venta del cliente')).toBeInTheDocument();
    expect(screen.getByTitle('Eliminar la factura y liberar su número (se equivocaron al cargarla)')).toBeInTheDocument();
  });

  it('con equipo comercial: ninguno de los cuatro', async () => {
    sesion.alcanceComercial = [5, 11, 12];
    pintar();
    expect(await screen.findByText('Cliente Uno')).toBeInTheDocument();
    expect(screen.queryByTitle('Editar IVA, datos del cliente o concepto')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Crear factura rectificativa (de abono)')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Asociar esta factura a una venta del cliente')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Eliminar la factura y liberar su número (se equivocaron al cargarla)')).not.toBeInTheDocument();
  });
});

describe('Finanzas › Dashboard: egresos y balance, solo para administración sin equipo', () => {
  const pintar = () => render(<MemoryRouter><AccountingDashboardPage /></MemoryRouter>);
  const responder = (datos) => api.get.mockImplementation(async (url) => (
    String(url).startsWith('/accounting/dashboard') ? { success: true, data: datos } : { success: true, data: [] }));

  it('con `solo_administracion`: ni Egresos ni Balance neto, y la nota', async () => {
    responder({ ...DASHBOARD, solo_administracion: ['egresos', 'balance'] });
    pintar();
    expect(await screen.findByText('Ingresos cobrados')).toBeInTheDocument();
    expect(screen.getByText(/Egresos y balance: solo para administración sin equipo/)).toBeInTheDocument();
    expect(screen.queryByText('Balance neto')).not.toBeInTheDocument();
    expect(screen.queryByText('Egresos por categoría')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Nuevo egreso')).not.toBeInTheDocument();
  });

  it('sin la marca (admin sin equipo): como siempre', async () => {
    responder({ ...DASHBOARD, egresos: { total: 50, num_egresos: 1, por_categoria: [] }, balance: 50, solo_administracion: [] });
    pintar();
    expect(await screen.findByText('Balance neto')).toBeInTheDocument();
    expect(screen.getByText('Egresos por categoría')).toBeInTheDocument();
    expect(screen.getByLabelText('Nuevo egreso')).toBeInTheDocument();
    expect(screen.queryByText(/solo para administración sin equipo/)).not.toBeInTheDocument();
  });
});

describe('los desplegables de gestora piden solo el alcance (GET /users?alcance=comercial)', () => {
  // Prospectos (filtro y reasignar en bloque), la ficha (reasignar), Ventas,
  // la Cola, Clientes y la exportación a Wasapi. El servidor ya ignora un
  // filtro de fuera del equipo, pero ofrecerlo confunde (QA del 09/11/2026).
  const PANTALLAS = [
    'modules/leads/pages/LeadsPage.tsx',
    'modules/leads/pages/LeadDetailPage.tsx',
    'modules/sales/pages/SalesPage.tsx',
    'modules/proceso/pages/ColaDelDiaPage.tsx',
    'modules/clients/pages/ClientsPage.tsx',
    'modules/leads/components/WasapiExportDialog.tsx',
  ];
  it.each(PANTALLAS)('%s', async (ruta) => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const fuente = readFileSync(resolve(process.cwd(), 'src', ruta), 'utf8');
    const llamadas = fuente.match(/client\s*\.get(?:<[^>]*>)?\(\s*[`'"]\/users[^\n]*/g) || [];
    expect(llamadas.length).toBeGreaterThan(0);
    for (const l of llamadas) expect(l).toMatch(/alcance(=|: ')comercial/);
  });
});
