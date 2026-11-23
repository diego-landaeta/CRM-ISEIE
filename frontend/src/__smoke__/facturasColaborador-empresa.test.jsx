// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * #202 · Diego, 10/10: «las facturas de colaboradores son por EMPRESA, no por campus».
 *
 * En MultiCRM la pantalla sigue a la empresa de la cabecera (su prueba es
 * facturasColaborador-empresa.test.jsx). ISEIE no tiene empresa en la cabecera y el
 * campus activo siempre está puesto: si la pantalla siguiera al campus, cada uno
 * quedaría atado a la empresa de su campus. Aquí se abre con TODAS las empresas que
 * ve cada uno y la empresa se elige en la propia pantalla. Si un día la cabecera
 * trae la empresa (`activeIssuerId`), la sigue, como en MultiCRM.
 */

const { cabecera, api } = vi.hoisted(() => ({
  cabecera: { value: {} },
  api: {
    empresas: vi.fn(), mes: vi.fn(), colaboradores: vi.fn(),
    vista: vi.fn(), costePorCampus: vi.fn(), bajarZip: vi.fn(),
    // La página pide las redactoras sin ficha (CRM#1015).
    redactorasSinFicha: vi.fn(),
  },
}));

vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => cabecera.value }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true }) }));
vi.mock('@/modules/facturas-colaborador/api/facturasColaborador.api', async (original) => ({
  ...(await original()),
  facturasColaboradorApi: api,
}));

import FacturasColaboradoresPage from '@/modules/facturas-colaborador/pages/FacturasColaboradoresPage';

// En ISEIE siempre hay un campus activo: el de Ictess (empresa 9).
const CAMPUS_DE_ICTESS = { activeProject: { id: 3, nombre: 'Campus Ictess', sociedad_emisora_id: 9 }, projects: [] };
const EMPRESAS = [{ id: 7, razon_social: 'CEDIA Investigación y Desarrollo SL' }, { id: 9, razon_social: 'Ictess SL' }];
const MES_VACIO = {
  periodo: '2026-09-01', mes: 'septiembre de 2026', facturas: [],
  resumen: { total: 0, recibidas: 0, importe_recibido: 0, importe_acordado: 0 },
};

const abrir = (ruta = '/accounting/facturas-colaboradores') => render(
  <MemoryRouter initialEntries={[ruta]}><FacturasColaboradoresPage /></MemoryRouter>,
);

/** Elige una opción de un desplegable del CRM (Select.tsx). */
async function elegir(etiqueta, opcion) {
  fireEvent.click(screen.getByLabelText(etiqueta));
  fireEvent.mouseDown(await screen.findByRole('option', { name: opcion }));
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  cabecera.value = CAMPUS_DE_ICTESS;
  api.empresas.mockResolvedValue({ data: EMPRESAS });
  api.mes.mockResolvedValue({ data: MES_VACIO });
  api.colaboradores.mockResolvedValue({ data: [{ id: 1, nombre: 'Laura', empresas: [], area: 'seo', email: 'l@x', activo: true }] });
  api.vista.mockResolvedValue({ data: { vista: 'por_pagar', resumen: { total: 0, importe: 0, pendiente: 0 }, facturas: [] } });
  api.costePorCampus.mockResolvedValue({ data: { campus: [] } });
  api.bajarZip.mockResolvedValue(undefined);
  api.redactorasSinFicha.mockResolvedValue({ data: [] });
});

describe('ISEIE · por empresa, no por el campus activo', () => {
  it('«Del mes» no se ata a la empresa del campus: pide todas y enseña el desplegable «Empresa»', async () => {
    abrir();
    await waitFor(() => expect(api.mes).toHaveBeenCalled());
    expect(api.mes.mock.calls[0][0].issuerId).toBeUndefined();
    expect(screen.getByLabelText('Empresa')).toBeTruthy();
    // El coste por campus, también de todas.
    await waitFor(() => expect(api.costePorCampus).toHaveBeenCalled());
    expect(api.costePorCampus.mock.calls[0][1]).toBe('');
  });

  it('al elegir una empresa en «Del mes»: su mes, su coste por campus y su ZIP', async () => {
    abrir('/accounting/facturas-colaboradores?periodo=2026-09');
    await waitFor(() => expect(api.empresas).toHaveBeenCalled());
    // Sin empresa, el ZIP no se puede pedir: es de una empresa y un mes.
    const zip = screen.getByRole('button', { name: 'Descargar el ZIP del mes' });
    expect(zip.disabled).toBe(true);

    await elegir('Empresa', 'Ictess SL');
    await waitFor(() => expect(api.mes.mock.calls.some(([f]) => f.issuerId === 9)).toBe(true));
    await waitFor(() => expect(api.costePorCampus.mock.calls.some(([p, i]) => p === '2026-09' && i === '9')).toBe(true));
    await waitFor(() => expect(zip.disabled).toBe(false));
    fireEvent.click(zip);
    await waitFor(() => expect(api.bajarZip).toHaveBeenCalledWith('2026-09', 9, 'Ictess SL'));
  });

  it('las pestañas (Enviadas, Por pagar, Pagadas, Historial) no fijan empresa y tienen su desplegable', async () => {
    for (const vista of ['enviadas', 'por_pagar', 'pagadas', 'historial']) {
      vi.clearAllMocks();
      const { unmount } = abrir(`/accounting/facturas-colaboradores?vista=${vista}`);
      await waitFor(() => expect(api.vista).toHaveBeenCalled());
      expect(api.vista.mock.calls[0][0]).toMatchObject({ vista, issuerId: '' });
      // El filtro de colaborador, de todas sus empresas.
      await waitFor(() => expect(api.colaboradores).toHaveBeenCalled());
      expect(api.colaboradores.mock.calls[0][0].issuerId).toBeUndefined();
      expect(screen.getByLabelText('Empresa')).toBeTruthy();
      unmount();
    }
  });

  it('«Colaboradores»: con varias empresas, su desplegable; al elegir una, solo quienes le facturan', async () => {
    abrir('/accounting/facturas-colaboradores?vista=colaboradores');
    await waitFor(() => expect(api.colaboradores).toHaveBeenCalled());
    expect(api.colaboradores.mock.calls[0][0].issuerId).toBeUndefined();
    await waitFor(() => expect(screen.getByLabelText('Empresa')).toBeTruthy());
    await elegir('Empresa', 'CEDIA Investigación y Desarrollo SL');
    await waitFor(() => expect(api.colaboradores.mock.calls.some(([f]) => f.issuerId === 7)).toBe(true));
  });

  it('«Colaboradores» con una sola empresa: sin desplegable (no hay nada que elegir)', async () => {
    api.empresas.mockResolvedValue({ data: [EMPRESAS[0]] });
    abrir('/accounting/facturas-colaboradores?vista=colaboradores');
    await waitFor(() => expect(api.empresas).toHaveBeenCalled());
    await waitFor(() => expect(api.colaboradores).toHaveBeenCalled());
    expect(screen.queryByLabelText('Empresa')).toBeNull();
  });

  it('al recargar «Del mes» (anular, pagar, «Actualizar») el coste por campus se pide otra vez', async () => {
    abrir('/accounting/facturas-colaboradores?periodo=2026-09');
    await waitFor(() => expect(api.costePorCampus).toHaveBeenCalled());
    const antes = api.costePorCampus.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /Actualizar/ }));
    await waitFor(() => expect(api.costePorCampus.mock.calls.length).toBeGreaterThan(antes));
  });
});

describe('si la cabecera trae la empresa (como MultiCRM), la sigue', () => {
  it('«Del mes», las pestañas y «Colaboradores» piden solo la suya, sin desplegable', async () => {
    cabecera.value = { ...CAMPUS_DE_ICTESS, activeIssuerId: 7 };
    const { unmount } = abrir();
    await waitFor(() => expect(api.mes).toHaveBeenCalled());
    expect(api.mes.mock.calls.every(([f]) => f.issuerId === 7)).toBe(true);
    expect(screen.queryByLabelText('Empresa')).toBeNull();
    unmount();

    abrir('/accounting/facturas-colaboradores?vista=pagadas');
    await waitFor(() => expect(api.vista).toHaveBeenCalled());
    expect(api.vista.mock.calls.every(([f]) => f.issuerId === '7')).toBe(true);
    cleanup();

    abrir('/accounting/facturas-colaboradores?vista=colaboradores');
    await waitFor(() => expect(api.colaboradores.mock.calls.some(([f]) => f.issuerId === 7)).toBe(true));
    expect(screen.queryByLabelText('Empresa')).toBeNull();
  });
});
