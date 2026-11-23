// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * CRM-ISEIE#687 (gemela de CRM#1015) · Las tutoras redactoras en «Facturas de colaboradores».
 * - Diego, 23/11: «que el admin pueda filtrar por los dos equipos, sus facturas».
 *   El desplegable de arriba elige también el equipo (desarrollo o redactoras), y
 *   llega al servidor como `tipo=colaborador` + `equipo` en todas las pestañas.
 * - «Sus fichas»: las redactoras sin ficha salen en «Colaboradores» con un botón
 *   que abre la ficha nueva con su nombre, su correo, su usuario y su área.
 */

const { api, client } = vi.hoisted(() => ({
  api: {
    empresas: vi.fn(), mes: vi.fn(), colaboradores: vi.fn(), vista: vi.fn(), costePorCampus: vi.fn(), redactorasSinFicha: vi.fn(),
  },
  client: { get: vi.fn() },
}));

vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeIssuerId: 7, isAllProjects: true, activeProject: null }) }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true }) }));
vi.mock('@/shared/api/client', () => ({ default: client }));
vi.mock('@/modules/facturas-colaborador/api/facturasColaborador.api', async (original) => ({
  ...(await original()),
  facturasColaboradorApi: api,
}));

import FacturasColaboradoresPage from '@/modules/facturas-colaborador/pages/FacturasColaboradoresPage';
import { filtroDeQuien, quienDeLaDireccion } from '@/modules/facturas-colaborador/api/facturasColaborador.api';

const abrir = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><FacturasColaboradoresPage /></MemoryRouter>);

const fila = (extra = {}) => ({
  id: 51, colaborador_id: 9, issuer_id: 7, periodo: '2026-10', colaborador_nombre: 'Yaibeth', email: 'y@x.test', area: 'redaccion',
  tipo: 'colaborador', equipo: 'redactoras', empresa: 'CEDIA Investigación y Desarrollo SL', importe_esperado: '300', importe: null, moneda: 'EUR',
  diferencia: null, numero_factura: null, numero_recepcion: null, subida_at: null, enviado_at: null, abierto_at: null, caduca_at: null,
  anulada_at: null, motivo_anulacion: null, nombre_original: null, tamano: null, base: null, total: null, horas: null, cuadra: true,
  importe_pdf: null, mime: null, pagada_at: null, forma_pago: null, referencia_pago: null, con_justificante: false, validada_at: null,
  estado: 'sin_enviar',
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.empresas.mockResolvedValue({ data: [{ id: 7, razon_social: 'CEDIA Investigación y Desarrollo SL' }] });
  api.colaboradores.mockResolvedValue({ data: [] });
  api.costePorCampus.mockResolvedValue({ data: { campus: [] } });
  api.mes.mockResolvedValue({ data: { periodo: '2026-10', mes: 'octubre de 2026', facturas: [fila()], resumen: { total: 1, recibidas: 0, importe_recibido: 0, importe_acordado: 300 } } });
  api.vista.mockResolvedValue({ data: { vista: 'enviadas', resumen: { total: 0, importe: 0, pendiente: 0 }, facturas: [] } });
  api.redactorasSinFicha.mockResolvedValue({ data: [{ id: 70, nombre: 'Ninoska', email: 'ninoska@x.test', active: false }] });
  client.get.mockResolvedValue({ data: [] });
});
afterEach(cleanup);

describe('el filtro por equipo (CRM-ISEIE#687)', () => {
  it('cada opción se traduce a lo que entiende el servidor', () => {
    expect(filtroDeQuien('')).toEqual({});
    expect(filtroDeQuien('vendedora')).toEqual({ tipo: 'vendedora' });
    expect(filtroDeQuien('colaborador')).toEqual({ tipo: 'colaborador' });
    expect(filtroDeQuien('redactoras')).toEqual({ tipo: 'colaborador', equipo: 'redactoras' });
    expect(filtroDeQuien('desarrollo')).toEqual({ tipo: 'colaborador', equipo: 'desarrollo' });
    expect(quienDeLaDireccion('redactoras')).toBe('redactoras');
    expect(quienDeLaDireccion('lo-que-sea')).toBe('');
  });

  it('«Tutoras redactoras» llega a «Del mes», a las pestañas y a la lista de fichas', async () => {
    abrir('/finanzas/facturas-colaboradores?tipo=redactoras');
    await waitFor(() => expect(api.mes).toHaveBeenCalled());
    expect(api.mes.mock.calls.at(-1)[0]).toMatchObject({ tipo: 'colaborador', equipo: 'redactoras' });
    // La fila lleva su etiqueta de redactora.
    const tr = (await screen.findByText('Yaibeth')).closest('tr');
    expect(within(tr).getByText('Redactora')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Enviadas' }));
    await waitFor(() => expect(api.vista).toHaveBeenCalled());
    expect(api.vista.mock.calls.at(-1)[0]).toMatchObject({ vista: 'enviadas', tipo: 'colaborador', equipo: 'redactoras' });

    fireEvent.click(screen.getByRole('button', { name: 'Colaboradores' }));
    await waitFor(() => expect(api.colaboradores.mock.calls.some(([f]) => f.equipo === 'redactoras' && f.estado === 'activos')).toBe(true));
    expect(screen.getByRole('button', { name: /Añadir redactora/ })).toBeTruthy();
  });

  it('«Equipo de desarrollo» no pide las redactoras sin ficha', async () => {
    abrir('/finanzas/facturas-colaboradores?tipo=desarrollo&vista=colaboradores');
    await waitFor(() => expect(api.colaboradores).toHaveBeenCalled());
    expect(api.colaboradores.mock.calls.at(-1)[0]).toMatchObject({ tipo: 'colaborador', equipo: 'desarrollo' });
    expect(api.redactorasSinFicha).not.toHaveBeenCalled();
    expect(screen.queryByText(/Tutoras redactoras sin ficha/)).toBeNull();
  });
});

describe('las redactoras sin ficha (CRM-ISEIE#687)', () => {
  it('salen en «Colaboradores» y «Crear su ficha» la abre con sus datos', async () => {
    abrir('/finanzas/facturas-colaboradores?vista=colaboradores');
    const bloque = await screen.findByRole('region', { name: 'Tutoras redactoras sin ficha' });
    expect(within(bloque).getByText('Ninoska')).toBeTruthy();
    expect(within(bloque).getByText('Desactivada')).toBeTruthy();

    fireEvent.click(within(bloque).getByRole('button', { name: /Crear su ficha/ }));
    const dialogo = await screen.findByRole('dialog', { name: 'Añadir tutora redactora' });
    expect(dialogo.querySelector('#col-nombre').value).toBe('Ninoska');
    expect(dialogo.querySelector('#col-email').value).toBe('ninoska@x.test');
    expect(within(dialogo).getByRole('combobox', { name: 'Área' }).textContent).toContain('Redacción de cursos');
    // Su usuario, aunque esté desactivada (la lista del servidor solo trae activos).
    await waitFor(() => expect(within(dialogo).getByText(/Ninoska \(desactivada\) · ninoska@x.test/)).toBeTruthy());
  });
});
