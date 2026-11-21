// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  CRM#906 · Finanzas › Conciliación › Cargos de Stripe.

  Cada cargo cobrado sin cobro en el CRM sale con lo que toca: «Enlazar» con su
  cobro (POST /stripe-payments/:id/link con el cobro, la ruta de #892), «Apuntar
  el cobro en esa venta» (la misma ruta con la venta) o «Crear la venta». Es una
  pestaña de Finanzas › Conciliación, el contenedor de «Facturas y cobros» (#905).
*/

const permisos = vi.hoisted(() => ({ mapa: { 'stripe.edit': true } }));
const red = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/shared/components/ui/portal', () => ({ default: ({ children }) => children }));
vi.mock('@/shared/api/client', () => ({ default: { get: (...a) => red.get(...a), post: (...a) => red.post(...a) } }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 3, nombre: 'Psiko' }, activeIssuerId: null }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' }, permissions: permisos.mapa }) }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));

import { PESTANAS_CONCILIACION } from '@/modules/accounting/lib/pestanasConciliacion';
import CargosStripePestana from '@/modules/accounting/pages/conciliacion/CargosStripePestana';
import VentaYaExisteAviso from '@/modules/conversions/components/VentaYaExisteAviso';
import { NAV_SECTIONS, rutaPermitida } from '@/shared/components/layout/Sidebar';

const COBRO = { id: 70, conversion_id: 9, importe: 100, fecha: '2026-10-03', metodo: 'tarjeta', lead_id: 4, alumno: 'Ana Martín', email: 'ana@x.test', programa: 'Máster', factura_id: 5, factura_codigo: 'F-2026-0005', por: 'correo', otrosCargos: 0 };
const base = { project_id: 3, proyecto: 'Psiko', description: null, lead_id: null, conversion_id: null, moneda: 'EUR', ficha: null, customer_email: null };
const CARGOS = [
  { ...base, id: 1, stripe_id: 'ch_ana', importe: 100, fecha: '2026-10-05', customer_name: 'Ana M.', customer_email: 'ana@x.test', cobros: [COBRO], ventas: [], seguro: true, sugerencia: 'enlazar' },
  { ...base, id: 2, stripe_id: 'ch_raul', importe: 300, fecha: '2026-10-15', customer_name: 'Raúl Gómez', cobros: [], seguro: false, sugerencia: 'apuntar',
    ventas: [{ id: 12, lead_id: 8, alumno: 'Raúl Gómez', email: null, programa: 'Diplomado', fecha: '2026-09-01', total: 900, cobrado: 300, pendiente: 600, por: 'nombre' }] },
  { ...base, id: 3, stripe_id: 'ch_nadie', importe: 150, fecha: '2026-10-25', customer_name: 'Marta Nueva', cobros: [], ventas: [], seguro: false, sugerencia: 'crear' },
];
const RESPUESTA = {
  success: true,
  data: {
    cargos: CARGOS,
    meses: [{ mes: '2026-10', cargos: 3, importe: 550 }],
    resumen: { cargos: 3, importe: 550, seguros: 1, importeSeguros: 100, conCobro: 1, conVenta: 1, sinVenta: 1 },
  },
};

beforeEach(() => {
  permisos.mapa = { 'stripe.edit': true };
  red.get.mockReset().mockImplementation(async (url) => (url.startsWith('/stripe-payments/conciliacion/opciones')
    ? { success: true, data: { productos: [{ id: 40, nombre: 'Máster en Psicología', precio: 900 }], vendedoras: [{ id: 6, nombre: 'Laura', role: 'gestor' }] } }
    : RESPUESTA));
  red.post.mockReset().mockResolvedValue({ success: true, data: {} });
});
afterEach(cleanup);

const pintar = () => render(<MemoryRouter><CargosStripePestana /></MemoryRouter>);

describe('#906 · la pestaña en el contenedor de Conciliación (#905)', () => {
  it('«Cargos de Stripe» es una pestaña de Conciliación, al lado de «Facturas y cobros»', () => {
    expect(PESTANAS_CONCILIACION.map((p) => p.to)).toEqual(['/accounting/conciliacion/facturas', '/accounting/conciliacion/cargos-stripe']);
  });

  it('su dirección pide `stripe.edit`; la entrada «Conciliación» sale con el permiso de cualquiera de sus pestañas', () => {
    expect(rutaPermitida('/accounting/conciliacion/cargos-stripe', (k) => k === 'stripe.edit')).toBe(true);
    expect(rutaPermitida('/accounting/conciliacion/cargos-stripe', (k) => k === 'facturas.gestionar')).toBe(false);
    const entrada = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.to === '/accounting/conciliacion');
    expect([].concat(entrada.permiso)).toEqual(expect.arrayContaining(['facturas.gestionar', 'stripe.edit']));
    expect(rutaPermitida('/accounting/conciliacion', (k) => k === 'stripe.edit')).toBe(true);
    expect(rutaPermitida('/accounting/conciliacion', () => false)).toBe(false);
  });
});

describe('#906 · cargos de Stripe sin enlazar', () => {
  it('pide la lista del campus y enseña cada cargo con su salida', async () => {
    pintar();
    expect(await screen.findByText('Ana M.')).toBeInTheDocument();
    expect(red.get.mock.calls[0][0]).toBe('/stripe-payments/conciliacion?projectId=3');
    expect(screen.getByText('Seguro')).toBeInTheDocument();
    expect(screen.getByText(/factura F-2026-0005/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Apuntar el cobro en esa venta/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Crear la venta$/ })).toBeInTheDocument();
  });

  it('«Enlazar» manda el cobro elegido a la ruta de #892', async () => {
    pintar();
    await screen.findByText('Ana M.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Enlazar$/ })); });
    expect(red.post).toHaveBeenCalledWith('/stripe-payments/1/link', { conversionPaymentId: 70 });
  });

  it('«Apuntar el cobro en esa venta» pregunta antes y manda la venta y su ficha', async () => {
    pintar();
    await screen.findByText('Ana M.');
    fireEvent.click(screen.getByRole('button', { name: /Apuntar el cobro en esa venta/ }));
    expect(red.post).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apuntar el cobro' })); });
    expect(red.post).toHaveBeenCalledWith('/stripe-payments/2/link', { conversionId: 12, leadId: 8 });
  });

  it('«Enlazar todos los seguros» dice cuántos y por cuánto antes de hacerlo', async () => {
    red.post.mockResolvedValue({ success: true, data: { seguros: 1, enlazados: 1, importe: 100, fallos: [] } });
    pintar();
    await screen.findByText('Ana M.');
    fireEvent.click(screen.getByRole('button', { name: /Enlazar todos los seguros/ }));
    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toHaveTextContent(/Se enlazan 1 cargo por 100,00\s€/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enlazarlos' })); });
    expect(red.post).toHaveBeenCalledWith('/stripe-payments/conciliacion/enlazar-seguros', { projectId: 3, mes: null });
  });

  it('el filtro «Sin venta» deja solo los que no tienen venta', async () => {
    pintar();
    await screen.findByText('Ana M.');
    fireEvent.click(screen.getByRole('button', { name: /Sin venta · 1/ }));
    expect(screen.queryByText('Ana M.')).not.toBeInTheDocument();
    expect(screen.getByText('Marta Nueva')).toBeInTheDocument();
  });

  it('«Crear la venta» va con el alumno y el importe del cargo, y el programa y la vendedora elegidos', async () => {
    pintar();
    await screen.findByText('Ana M.');
    fireEvent.click(screen.getByRole('button', { name: /^Crear la venta$/ }));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveTextContent(/150,00\s€/);
    expect(screen.getByDisplayValue('Marta Nueva')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Laura' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Programa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Máster en Psicología' }));
    fireEvent.change(screen.getByLabelText('Vendedora'), { target: { value: '6' } });
    const crear = screen.getAllByRole('button', { name: 'Crear la venta' }).at(-1);
    await act(async () => { fireEvent.click(crear); });
    expect(red.post).toHaveBeenCalledWith('/stripe-payments/3/crear-venta', {
      productoId: 40, vendedoraId: 6, importeTotal: 150, nombre: 'Marta Nueva', email: null,
    });
  });

  it('si la venta ya existe (#898), «Apuntar el cobro en esa venta» enlaza el cargo con ella', async () => {
    const apuntar = vi.fn(async () => {});
    const hecho = vi.fn();
    const venta = { id: 41, lead_id: 7, alumno: 'Sara', programa: 'Máster', total: 900, cobrado: 0, pendiente: 900 };
    render(<MemoryRouter><VentaYaExisteAviso venta={venta} onCancelar={vi.fn()} onCrearIgualmente={vi.fn()} onApuntarCobro={apuntar} onCobroApuntado={hecho} /></MemoryRouter>);
    await act(async () => { fireEvent.click(screen.getByText('Apuntar el cobro en esa venta')); });
    expect(apuntar).toHaveBeenCalledWith(venta);
    expect(hecho).toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Registrar abono' })).not.toBeInTheDocument();
  });
});
