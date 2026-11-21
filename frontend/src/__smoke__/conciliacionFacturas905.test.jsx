// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * CRM#905 · Finanzas › Conciliación › Facturas y cobros.
 *
 *   · la entrada y su pestaña piden `facturas.gestionar` (la misma clave que el servidor);
 *   · la pantalla enseña las dos listas con su «Seguro» y «Enlazar» manda la pareja;
 *   · «Enlazar todas las seguras» pregunta cuántas y por cuánto, y manda lo que se vio.
 */

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' }, permissions: null }) }));
// Un objeto nuevo en cada llamada, como cuando el contexto se vuelve a pintar:
// la pantalla no debe recargar sin parar por eso.
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: -1 }, activeIssuerId: null, projects: [{ id: 1, nombre: 'Psiko Aprende' }], switchProject: () => {} }),
}));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'light' }));

const DATOS = {
  mes: '2026-11', dias: 7,
  facturas: [{
    id: 79, project_id: 1, campus: 'Psiko Aprende', codigo: '2026/X-9001', fecha: '2026-11-05', total: 500, estado: 'emitida',
    cliente_nombre: 'MARTA JIMENEZ', cliente_email: null, conversion_id: null,
    candidatos: [{ payment_id: 243, fecha: '2026-11-04', importe: 500, cliente: 'Marta Jiménez', producto: 'Máster', conversion_id: 259, dias: 1, por: 'nombre', segura: true }],
  }],
  cobros: [{
    id: 250, project_id: 1, campus: 'Psiko Aprende', fecha: '2026-11-18', importe: 420, metodo: null, conversion_id: 261, lead_id: 9,
    cliente: 'Pablo Ortega', cliente_email: null, producto: 'Máster', de_stripe: false, en_cola: true, fuera_de_cola: null, candidatas: [],
  }],
  resumen: { facturas_sin_cobro: 1, importe_facturas: 500, cobros_sin_factura: 1, importe_cobros: 420, seguras: 1, importe_seguras: 500 },
};
const cliente = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ default: cliente }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { rutaPermitida } = await import('@/shared/components/layout/Sidebar');
const { default: Pagina } = await import('@/modules/accounting/pages/ConciliacionFacturasPage');

afterEach(() => cleanup());

const pinta = () => render(<MemoryRouter><Pagina /></MemoryRouter>);

beforeEach(() => {
  cliente.get.mockReset().mockResolvedValue({ success: true, data: DATOS });
  cliente.post.mockReset().mockResolvedValue({ success: true, data: { enlazadas: 1, importe: 500, fallidas: [] } });
});

describe('#905 · Conciliación › Facturas y cobros', () => {
  it('la entrada y su pestaña piden facturas.gestionar', () => {
    const con = (k) => k === 'facturas.gestionar';
    const sin = () => false;
    expect(rutaPermitida('/accounting/conciliacion', con)).toBe(true);
    expect(rutaPermitida('/accounting/conciliacion/facturas', con)).toBe(true);
    expect(rutaPermitida('/accounting/conciliacion', sin)).toBe(false);
    expect(rutaPermitida('/accounting/conciliacion/facturas', sin)).toBe(false);
  });

  it('enseña la factura con su cobro «Seguro» y el cobro sin factura con «Emitir factura»', async () => {
    pinta();
    expect(await screen.findAllByText('2026/X-9001')).not.toHaveLength(0);
    expect(screen.getByText('Seguro')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Emitir factura/ })).toBeTruthy();
    expect(cliente.get.mock.calls[0][0]).toMatch(/^\/conciliacion\/facturas-cobros\?mes=\d{4}-\d{2}$/);
  });

  it('«Enlazar» manda la factura y el cobro', async () => {
    pinta();
    fireEvent.click(await screen.findByRole('button', { name: /Enlazar la factura 2026\/X-9001 con el cobro del 04\/11\/2026/ }));
    await waitFor(() => expect(cliente.post).toHaveBeenCalledWith('/conciliacion/facturas-cobros/enlazar', { invoiceId: 79, paymentId: 243 }));
  });

  it('«Enlazar todas las seguras» pregunta cuántas y por cuánto, y manda lo que se vio', async () => {
    pinta();
    fireEvent.click(await screen.findByRole('button', { name: /Enlazar todas las seguras \(1\)/ }));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo.textContent).toMatch(/1 factura con su cobro, por 500,00\s€/);
    fireEvent.click(screen.getByRole('button', { name: 'Enlazar 1' }));
    await waitFor(() => expect(cliente.post).toHaveBeenCalledWith(
      expect.stringMatching(/^\/conciliacion\/facturas-cobros\/enlazar-seguras\?mes=/),
      expect.objectContaining({ cuantas: 1, importe: 500 }),
    ));
  });
});
