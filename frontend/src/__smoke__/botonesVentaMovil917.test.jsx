// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  Gemela de CRM#917 (18/11): en el móvil la fila de botones de la venta
  («Abonar», «Emitir proforma», «Editar», «Fraccionar», la papelera) iba al
  lado del programa, sin salto de línea, y sacaba la ficha del prospecto de la
  pantalla. Lo mismo la cabecera de Finanzas › Facturas. En ISEIE, a 320 px,
  también se salían «WhatsApp» (al lado del teléfono) y la pestaña «Abonos».

  jsdom no maqueta, así que aquí se defiende la regla que lo arregla: en
  pantallas estrechas la fila baja debajo del programa y salta de línea, y en
  el PC (`sm:`) vuelve a la derecha en una sola línea. Las medidas reales se
  tomaron con Playwright (ver la PR).
*/

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const ventas = vi.hoisted(() => ({ byLead: vi.fn(), listRefunds: vi.fn(), getById: vi.fn() }));
const facturas = vi.hoisted(() => ({
  list: vi.fn(), stats: vi.fn(), listIssuers: vi.fn(), ventasSinFactura: vi.fn(), byConversion: vi.fn(),
}));

vi.mock('@/shared/api/client', () => ({ default: api, API_BASE_URL: '/api' }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'superadmin' }, permissions: { '*': true }, alcanceComercial: null, projects: [{ id: 4, nombre: 'Campus A' }] }),
}));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({
    activeProject: { id: 4, nombre: 'Campus A', sociedad_emisora_id: null },
    activeIssuerId: null,
    projects: [{ id: 4, nombre: 'Campus A' }],
    switchProject: vi.fn(),
  }),
}));
vi.mock('@/modules/conversions/api/conversions.api', async (importOriginal) => ({
  ...(await importOriginal()), conversionsApi: ventas,
}));
vi.mock('@/modules/invoices/api/invoices.api', async (importOriginal) => ({
  ...(await importOriginal()), invoicesApi: facturas, invoiceFaltantes: () => [],
}));
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

const { default: ConversionsTab } = await import('@/modules/conversions/components/ConversionsTab');
const { default: InvoicesPage } = await import('@/modules/invoices/pages/InvoicesPage');
const { default: LeadInfoCard } = await import('@/modules/leads/components/lead-detail/LeadInfoCard');

/** Una venta sin cobrar: salen todos sus botones. */
const venta = (id, programa) => ({
  id, lead_id: 3617, project_id: 4, producto_contratado: programa, producto_contratado_id: 10,
  importe_total: '400.00', importe_pagado: '0', importe_pendiente: '400.00', metodo_pago: 'transferencia',
  fecha_conversion: '2026-11-18', fecha_compromiso_pago: null, items: [], payments: [], payments_count: '0',
  refunds: [], installments: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  ventas.byLead.mockResolvedValue({ success: true, data: [venta(560, 'Máster en Psicopedagogía Clínica'), venta(558, 'Curso de Fonoaudiología')] });
  ventas.listRefunds.mockResolvedValue({ success: true, data: [] });
  ventas.getById.mockResolvedValue({ success: true, data: null });
  facturas.byConversion.mockResolvedValue({ success: true, data: null });
  facturas.list.mockResolvedValue({ success: true, data: [], pagination: { total: 0 } });
  facturas.stats.mockResolvedValue({ success: true, data: null });
  facturas.listIssuers.mockResolvedValue({ success: true, data: [] });
  facturas.ventasSinFactura.mockResolvedValue({ success: true, data: [] });
  api.get.mockResolvedValue({ success: true, data: [] });
});
afterEach(cleanup);

const clases = (el) => el.className.split(/\s+/);

describe('Ficha del prospecto: la fila de botones de cada venta cabe en el móvil', () => {
  it('en el móvil baja debajo del programa y salta de línea; en el PC, a la derecha en una línea', async () => {
    render(<MemoryRouter><ConversionsTab lead={{ id: 3617 }} projectId={4} canManage /></MemoryRouter>);
    const botones = await screen.findAllByRole('button', { name: /Abonar/ });
    expect(botones).toHaveLength(2);
    for (const abonar of botones) {
      const fila = abonar.parentElement;
      expect(clases(fila)).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'sm:flex-nowrap', 'sm:flex-shrink-0']));
      const cabecera = fila.parentElement;
      expect(clases(cabecera)).toEqual(expect.arrayContaining(['flex', 'flex-col', 'sm:flex-row', 'sm:justify-between']));
      // El bloque del programa puede encogerse y su línea de etiquetas salta.
      const programa = cabecera.firstElementChild;
      expect(clases(programa)).toContain('min-w-0');
      expect(clases(programa.firstElementChild)).toContain('flex-wrap');
    }
  });
});

describe('Finanzas › Facturas: los botones de la cabecera saltan de línea', () => {
  it('«Nueva factura» y «Configuración» van en una fila con flex-wrap', async () => {
    render(<MemoryRouter><InvoicesPage /></MemoryRouter>);
    const config = await screen.findByRole('link', { name: /Configuración/ });
    const fila = config.parentElement;
    expect(clases(fila)).toEqual(expect.arrayContaining(['flex', 'flex-wrap']));
    expect(fila).toContainElement(screen.getByRole('link', { name: /Nueva factura/ }));
  });

  it('las pestañas Facturas/Proformas/Abonos se desplazan solas en vez de ensanchar la página (320 px)', async () => {
    render(<MemoryRouter><InvoicesPage /></MemoryRouter>);
    const abonos = await screen.findByRole('button', { name: /Abonos/ });
    expect(clases(abonos.parentElement)).toEqual(expect.arrayContaining(['max-w-full', 'overflow-x-auto']));
  });
});

describe('Ficha del prospecto: el teléfono y sus botones saltan de línea (320 px)', () => {
  it('«Llamar» y «WhatsApp» van en una fila con flex-wrap', async () => {
    render(<MemoryRouter><LeadInfoCard lead={{ id: 3617, project_id: 4, nombre: 'Alumna', email: 'a@example.com', telefono: '+34600000000', custom_fields: {} }} onUpdate={vi.fn()} /></MemoryRouter>);
    const llamar = await screen.findByRole('button', { name: /Llamar/ });
    const fila = llamar.parentElement;
    expect(clases(fila)).toEqual(expect.arrayContaining(['inline-flex', 'flex-wrap']));
    expect(fila).toContainElement(screen.getByRole('button', { name: /WhatsApp/ }));
  });
});
