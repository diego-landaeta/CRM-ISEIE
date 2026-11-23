// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

/**
 * El embudo de «Links de pago» (CRM#987; Diego, 21/11/2026): por gestora y por
 * campus, creados, abiertos y pagados con su %, lo cobrado y las cuotas, para el
 * periodo elegido.
 */

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const { default: EmbudoLinks, fechasDe } = await import('@/modules/links-pago/components/EmbudoLinks');

const fila = (x) => ({ creados: 0, abiertos: 0, pagados: 0, pct_abiertos: null, pct_pagados: null, cobrado: 0, cuotas_cobradas: 0, cuotas_fallidas: 0, cuotas_pendientes: 0, ...x });
const DATOS = {
  desde: '2026-11-01', hasta: '2026-11-21',
  total: fila({ creados: 5, abiertos: 4, pagados: 2, pct_abiertos: 80, pct_pagados: 40, cobrado: 800, cuotas_cobradas: 1, cuotas_fallidas: 1, cuotas_pendientes: 1 }),
  por_gestora: [
    fila({ user_id: 1, nombre: 'Laura', creados: 4, abiertos: 3, pagados: 2, pct_abiertos: 75, pct_pagados: 50, cobrado: 800, cuotas_cobradas: 1, cuotas_fallidas: 1, cuotas_pendientes: 1 }),
    fila({ user_id: 2, nombre: 'Ana', creados: 1, abiertos: 1, pct_abiertos: 100, pct_pagados: 0 }),
  ],
  por_campus: [fila({ project_id: 1, nombre: 'Campus Uno', creados: 5, abiertos: 4, pagados: 2, pct_abiertos: 80, pct_pagados: 40, cobrado: 800 })],
};

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ success: true, data: DATOS });
});
afterEach(cleanup);

describe('el embudo', () => {
  it('pide el mes en curso con el ámbito y pinta cada gestora con su % y lo cobrado, y el total', async () => {
    render(<EmbudoLinks ambito={{ projectId: 1 }} />);
    const laura = (await screen.findByText('Laura')).closest('tr');
    expect(within(laura).getByText('800,00 €')).toBeTruthy();
    expect(laura.textContent).toContain('(75 %)');
    expect(laura.textContent).toContain('(50 %)');
    expect(screen.getByText('Total').closest('tr').textContent).toContain('(40 %)');
    const [url, opciones] = get.mock.calls[0];
    expect(url).toBe('/links-pago/embudo');
    expect(opciones.params).toMatchObject({ projectId: 1 });
    expect(opciones.params.desde).toMatch(/-01$/);
  });

  it('por campus, y otro periodo vuelve a pedir', async () => {
    render(<EmbudoLinks />);
    await screen.findByText('Laura');
    fireEvent.click(screen.getByRole('button', { name: 'Por campus' }));
    expect(screen.getByText('Campus Uno')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mes pasado' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('si el servidor falla, lo dice y no pinta una tabla vieja', async () => {
    get.mockRejectedValueOnce({ data: { error: 'Sin permiso' } });
    render(<EmbudoLinks />);
    expect((await screen.findByRole('alert')).textContent).toContain('Sin permiso');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('el recorrido de «Links de pago» enseña el resumen', async () => {
    const { RECORRIDOS_COBROS } = await import('@/shared/lib/recorridosCobros');
    const paso = RECORRIDOS_COBROS['links-pago'].pasos.find((x) => x.donde === '[data-recorrido="links-embudo"]');
    expect(paso?.titulo).toBe('Cómo van tus links');
  });

  it('las fechas de cada periodo', () => {
    expect(fechasDe('mes', '2026-11-21')).toEqual({ desde: '2026-11-01', hasta: '2026-11-21' });
    expect(fechasDe('anterior', '2026-01-15')).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' });
    expect(fechasDe('30', '2026-11-21')).toEqual({ desde: '2026-10-23', hasta: '2026-11-21' });
  });
});
