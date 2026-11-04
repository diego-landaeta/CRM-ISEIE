// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * #202 · «He recibido el pago y lo confirmo» (Diego, 04/11). El botón del correo de
 * «Factura pagada» abre esta página sin entrar. Abrirla no confirma nada (los
 * filtros de correo abren los enlaces solos): se confirma al pulsar el botón, y
 * después puede dejar su opinión (1 a 5 y un comentario). En las listas de
 * administración se ve «Pago confirmado por el colaborador» y su opinión.
 */

const { api } = vi.hoisted(() => ({ api: { verPago: vi.fn(), confirmarPago: vi.fn(), opinarDelPago: vi.fn() } }));
vi.mock('@/modules/facturas-colaborador/api/facturasColaborador.api', async (original) => ({
  ...(await original()),
  facturasColaboradorApi: api,
}));

import FacturaPagoPage from '@/modules/facturas-colaborador/pages/FacturaPagoPage';
import ConfirmacionDelPago from '@/modules/facturas-colaborador/components/ConfirmacionDelPago';

const pago = (extra = {}) => ({
  colaborador: 'Laura', empresa: 'CEDIA Formación, S.L.', marca: { nombre: 'ISEIH', logo_url: null },
  mes: 'octubre de 2026', numero_factura: 'F-10', importe: 636, moneda: 'EUR',
  pagada_at: '2026-11-03', forma_pago: 'transferencia', confirmado_at: null, opinion: null, ...extra,
});
const abrir = () => render(
  <MemoryRouter initialEntries={['/factura-colaborador/pago/12.1.firma']}>
    <Routes><Route path="/factura-colaborador/pago/:token" element={<FacturaPagoPage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => { api.verPago.mockReset(); api.confirmarPago.mockReset(); api.opinarDelPago.mockReset(); });
afterEach(cleanup);

describe('la página de «He recibido el pago y lo confirmo»', () => {
  it('abrirla NO confirma (los filtros de correo abren los enlaces solos): enseña la factura y el botón', async () => {
    api.verPago.mockResolvedValue({ data: pago() });
    abrir();
    expect(await screen.findByRole('button', { name: 'He recibido el pago y lo confirmo' })).toBeTruthy();
    expect(screen.getByText(/tu factura de octubre de 2026/)).toBeTruthy();
    expect(screen.getByText(/636,00/)).toBeTruthy();
    expect(api.confirmarPago).not.toHaveBeenCalled();
    expect(screen.queryByText('Pago confirmado')).toBeNull();
    // Ni la valoración: sale después de confirmar.
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('al pulsar el botón confirma, una vez, y sale la valoración', async () => {
    api.verPago.mockResolvedValue({ data: pago() });
    api.confirmarPago.mockResolvedValue({ data: pago({ confirmado_at: '2026-11-04T09:00:00Z' }) });
    abrir();
    fireEvent.click(await screen.findByRole('button', { name: 'He recibido el pago y lo confirmo' }));
    expect(await screen.findByText('Pago confirmado')).toBeTruthy();
    expect(api.confirmarPago).toHaveBeenCalledTimes(1);
    expect(api.confirmarPago).toHaveBeenCalledWith('12.1.firma');
    expect(screen.getByRole('radio', { name: '4 de 5' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'He recibido el pago y lo confirmo' })).toBeNull();
  });

  it('si ya estaba confirmado no lo vuelve a pedir', async () => {
    api.verPago.mockResolvedValue({ data: pago({ confirmado_at: '2026-11-04T09:00:00Z' }) });
    abrir();
    await screen.findByText('Pago confirmado');
    expect(api.confirmarPago).not.toHaveBeenCalled();
  });

  it('la opinión: estrellas y comentario, opcional; se envía y da las gracias', async () => {
    api.verPago.mockResolvedValue({ data: pago({ confirmado_at: '2026-11-04T09:00:00Z' }) });
    api.opinarDelPago.mockResolvedValue({ data: pago({ confirmado_at: '2026-11-04T09:00:00Z', opinion: { valoracion: 4, comentario: 'Bien', at: 'x' } }) });
    abrir();
    const enviar = await screen.findByRole('button', { name: 'Enviar mi opinión' });
    expect(enviar.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '4 de 5' }));
    fireEvent.change(screen.getByLabelText('Comentario'), { target: { value: ' Bien ' } });
    fireEvent.click(enviar);
    await waitFor(() => expect(api.opinarDelPago).toHaveBeenCalledWith('12.1.firma', 4, 'Bien'));
    expect(await screen.findByText(/Gracias por tu opinión \(4 de 5\)/)).toBeTruthy();
  });

  it('un enlace que no vale lo dice', async () => {
    api.verPago.mockRejectedValue({ data: { error: 'Este enlace no existe o ya no es válido' } });
    abrir();
    expect((await screen.findByRole('alert')).textContent).toContain('ya no es válido');
  });
});

describe('en la lista de administración', () => {
  it('«Pago confirmado por el colaborador» con sus estrellas y su comentario', () => {
    render(<ConfirmacionDelPago f={{ pagada_at: '2026-11-03', pago_confirmado_at: '2026-11-04T09:00:00Z', pago_valoracion: 4, pago_comentario: 'Llegó tarde' }} />);
    expect(screen.getByText(/Pago confirmado por el colaborador/)).toBeTruthy();
    expect(screen.getByLabelText('Valoración: 4 de 5').textContent).toBe('★★★★☆');
    expect(screen.getByText(/«Llegó tarde»/)).toBeTruthy();
  });

  it('sin confirmar, nada', () => {
    const { container } = render(<ConfirmacionDelPago f={{ pagada_at: '2026-11-03', pago_confirmado_at: null }} />);
    expect(container.textContent).toBe('');
  });
});
