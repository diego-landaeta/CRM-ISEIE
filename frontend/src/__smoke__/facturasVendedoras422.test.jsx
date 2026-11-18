// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * CRM-ISEIE#422 (gemela de CRM#710) · Facturas de colaboradores con las vendedoras.
 * - El filtro «Vendedoras / Colaboradores» llega al servidor en todas las pestañas.
 * - Las de una vendedora llevan su etiqueta.
 * - Diego, 18/11: «la gestora pone su monto y luego la empresa valida y hace el
 *   pago». Recibida y sin validar: «Validar», y no «Marcar pagada».
 */

const { api } = vi.hoisted(() => ({
  api: {
    empresas: vi.fn(), mes: vi.fn(), colaboradores: vi.fn(), vista: vi.fn(), costePorCampus: vi.fn(), validar: vi.fn(),
  },
}));

vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeIssuerId: 7, isAllProjects: true, activeProject: null }) }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true }) }));
vi.mock('@/modules/facturas-colaborador/api/facturasColaborador.api', async (original) => ({
  ...(await original()),
  facturasColaboradorApi: api,
}));

import FacturasColaboradoresPage from '@/modules/facturas-colaborador/pages/FacturasColaboradoresPage';

const fila = (extra = {}) => ({
  id: 41, colaborador_id: 3, issuer_id: 7, periodo: '2026-10', colaborador_nombre: 'Lucía', email: 'lucia@x.test', area: 'otra',
  tipo: 'vendedora', empresa: 'CEDIA Investigación y Desarrollo SL', importe_esperado: null, importe: '412.50', moneda: 'EUR',
  diferencia: null, numero_factura: 'A-10', numero_recepcion: 'REC-2026-10-0001', subida_at: '2026-11-02T10:00:00Z',
  enviado_at: null, abierto_at: null, caduca_at: null, anulada_at: null, motivo_anulacion: null, nombre_original: 'a.pdf', tamano: 10,
  base: null, total: null, horas: null, cuadra: true, importe_pdf: '412.50', mime: 'application/pdf',
  pagada_at: null, forma_pago: null, referencia_pago: null, con_justificante: false, validada_at: null, estado: 'recibida',
  ...extra,
});
const abrir = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><FacturasColaboradoresPage /></MemoryRouter>);

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  api.empresas.mockResolvedValue({ data: [{ id: 7, razon_social: 'CEDIA Investigación y Desarrollo SL' }] });
  api.colaboradores.mockResolvedValue({ data: [] });
  api.costePorCampus.mockResolvedValue({ data: { campus: [] } });
  api.mes.mockResolvedValue({ data: { periodo: '2026-10', mes: 'octubre de 2026', facturas: [fila()], resumen: { total: 1, recibidas: 1, importe_recibido: 412.5, importe_acordado: 0 } } });
  api.vista.mockResolvedValue({ data: { vista: 'por_validar', resumen: { total: 1, importe: 412.5, pendiente: 412.5 }, facturas: [fila()] } });
  api.validar.mockResolvedValue({ data: { id: 41, validada: true } });
});

describe('«Vendedoras / Colaboradores» (CRM-ISEIE#422)', () => {
  it('el filtro de la dirección llega a «Del mes», a las pestañas y a la lista de fichas', async () => {
    abrir('/finanzas/facturas-colaboradores?tipo=vendedora');
    await waitFor(() => expect(api.mes).toHaveBeenCalled());
    expect(api.mes.mock.calls.at(-1)[0].tipo).toBe('vendedora');
    expect(screen.getByLabelText('Vendedoras o colaboradores')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Por validar' }));
    await waitFor(() => expect(api.vista).toHaveBeenCalled());
    expect(api.vista.mock.calls.at(-1)[0]).toMatchObject({ vista: 'por_validar', tipo: 'vendedora' });

    fireEvent.click(screen.getByRole('button', { name: 'Colaboradores' }));
    await waitFor(() => expect(api.colaboradores.mock.calls.some(([f]) => f.tipo === 'vendedora' && f.estado === 'activos')).toBe(true));
    expect(screen.getByRole('button', { name: /Añadir vendedora/ })).toBeTruthy();
  });

  it('sin filtro, no se pide ningún tipo', async () => {
    abrir('/finanzas/facturas-colaboradores');
    await waitFor(() => expect(api.mes).toHaveBeenCalled());
    expect(api.mes.mock.calls.at(-1)[0].tipo).toBeUndefined();
  });
});

describe('validar antes de pagar', () => {
  it('recibida y sin validar: «Por validar», el botón Validar y no «Marcar pagada»', async () => {
    abrir('/finanzas/facturas-colaboradores');
    const nombre = await screen.findByText('Lucía');
    const tr = nombre.closest('tr');
    expect(within(tr).getByText('Vendedora')).toBeTruthy();
    expect(within(tr).getByText('Por validar')).toBeTruthy();
    expect(within(tr).queryByRole('button', { name: 'Marcar pagada' })).toBeNull();
    fireEvent.click(within(tr).getByRole('button', { name: 'Validar' }));
    await waitFor(() => expect(api.validar).toHaveBeenCalledWith(41));
  });

  it('validada: «Marcar pagada», y ya no «Validar»', async () => {
    api.mes.mockResolvedValue({ data: { periodo: '2026-10', mes: 'octubre de 2026', facturas: [fila({ validada_at: '2026-11-03T09:00:00Z' })], resumen: { total: 1, recibidas: 1, importe_recibido: 412.5, importe_acordado: 0 } } });
    abrir('/finanzas/facturas-colaboradores');
    const tr = (await screen.findByText('Lucía')).closest('tr');
    expect(within(tr).getByRole('button', { name: 'Marcar pagada' })).toBeTruthy();
    expect(within(tr).queryByRole('button', { name: 'Validar' })).toBeNull();
  });
});
