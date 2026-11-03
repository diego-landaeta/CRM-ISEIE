// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

// #367 (gemela de diego-landaeta/CRM#534) · «Productos vendidos» del Dashboard: las rectificativas, aparte.
//
// Octubre de 2026: la tarjeta decía «Cuentoterapia −541,67 €» y «Tarot
// Terapéutico (dolor emocional) 0,00 €», porque los abonos restaban dentro de su
// producto. Ahora cada producto enseña lo facturado y los abonos van en su fila,
// dentro del total.
//
// ANTES del arreglo la tarjeta no pintaba la fila «Rectificativas»: falla.

vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 1 }, activeIssuerId: null }),
}));

const respuesta = vi.hoisted(() => ({ data: null }));
vi.mock('@/shared/api/client', () => ({
  default: { get: vi.fn(async () => ({ success: true, data: respuesta.data })) },
}));

const { default: CursosVendidosCard } = await import('@/modules/sales/components/CursosVendidosCard');

const textoDe = (el) => (el.textContent || '').replace(/\s+/g, ' ');

afterEach(cleanup);

beforeEach(() => {
  respuesta.data = {
    total: { facturado: 958.33, ventas: 3 },
    productos: [
      { product_id: 20, producto: 'Máster en Psicología', facturado: 1500, ventas: 1 },
      { product_id: 22, producto: 'Tarot Terapéutico (dolor emocional)', facturado: 140, ventas: 1 },
      { product_id: 21, producto: 'Cuentoterapia', facturado: 108.33, ventas: 1 },
    ],
    sin_producto: { facturado: 0, ventas: 0 },
    rectificativas: {
      facturado: -790, ventas: 2,
      productos: [
        { product_id: 21, producto: 'Cuentoterapia', facturado: -650 },
        { product_id: 22, producto: 'Tarot Terapéutico (dolor emocional)', facturado: -140 },
      ],
    },
  };
});

describe('Productos vendidos (lo facturado)', () => {
  it('los abonos salen en su fila, con los productos a los que tocan', async () => {
    const { container } = render(<CursosVendidosCard medida="facturado" />);
    await waitFor(() => expect(screen.getByText('Rectificativas (abonos)')).toBeTruthy());
    const t = textoDe(container);
    expect(t).toMatch(/-?−?790,00 € · Cuentoterapia, Tarot Terapéutico \(dolor emocional\)/);
  });

  it('ningún producto se pinta en negativo, y el total de arriba es el de siempre', async () => {
    const { container } = render(<CursosVendidosCard medida="facturado" />);
    await waitFor(() => expect(screen.getByText('Rectificativas (abonos)')).toBeTruthy());
    const t = textoDe(container);
    expect(t).toMatch(/facturado 108,33 €/);
    expect(t).not.toMatch(/facturado [-−]541/);
    expect(t).toMatch(/958,33 €/);
  });

  it('sin abonos en el periodo, no hay fila', async () => {
    respuesta.data = { ...respuesta.data, rectificativas: { facturado: 0, ventas: 0, productos: [] } };
    render(<CursosVendidosCard medida="facturado" />);
    await waitFor(() => expect(screen.getByText('Cuentoterapia')).toBeTruthy());
    expect(screen.queryByText('Rectificativas (abonos)')).toBeNull();
  });
});
