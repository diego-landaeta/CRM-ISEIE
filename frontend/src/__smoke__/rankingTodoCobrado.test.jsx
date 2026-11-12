// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';

// Diego, 12/11/2026: «los montos de los rankings de todas las vistas son del
// monto cobrado». Ventas ponía «Facturado», que era lo vendido, y no lo cobrado.
// Las cifras son inventadas.

const respuestas = vi.hoisted(() => ({ my: null, equipo: null }));
vi.mock('@/shared/api/client', () => ({
  default: {
    get: vi.fn(async (url) => {
      if (url.startsWith('/ventas/my-stats')) return { success: true, data: respuestas.my };
      if (url.startsWith('/ventas/gestores-stats')) return { success: true, data: respuestas.equipo };
      return { success: true, data: null };
    }),
    post: vi.fn(),
  },
}));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
// Recharts mide su caja con ResizeObserver, que jsdom no trae.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const { default: MyGoalCard } = await import('@/modules/sales/components/MyGoalCard');
const { default: GestoresStatsTable } = await import('@/modules/sales/components/GestoresStatsTable');
const { default: RankingGestoras } = await import('@/modules/reports/components/RankingGestoras');

const GESTORA = {
  user_id: 2, nombre: 'Gestora A', email: 'f@x', role: 'gestor', is_available: true, recibe_leads: true,
  ventas: 3, compartidas: 0, vendido: 1000, cobrado: 2000,
  meta_ventas: null, meta_facturacion: null, progreso_ventas_pct: null, progreso_facturacion_pct: null,
};

afterEach(cleanup);

describe('Mi meta del mes', () => {
  it('enseña lo cobrado, no lo vendido', async () => {
    respuestas.my = GESTORA;
    render(<MyGoalCard projectId={1} periodo="2026-11" />);
    await waitFor(() => expect(screen.getByText('Cobrado')).toBeTruthy());
    expect(screen.queryByText('Facturado')).toBeNull();
    expect(document.body.textContent).toMatch(/2000,00\s€/);
    expect(document.body.textContent).not.toMatch(/1000,00\s€/);
  });
});

describe('Equipo de ventas', () => {
  it('la columna de la meta es lo cobrado y lo vendido va aparte', async () => {
    respuestas.equipo = { gestores: [GESTORA] };
    render(<GestoresStatsTable projectId={1} periodo="2026-11" canEdit={false} />);
    await waitFor(() => expect(screen.getByText('Cobrado / Meta')).toBeTruthy());
    expect(screen.queryByText('Facturado / Meta')).toBeNull();
    const fila = screen.getByText('Gestora A').closest('tr');
    const celdas = within(fila).getAllByRole('cell').map((c) => c.textContent);
    expect(celdas[2]).toMatch(/2000,00\s€/);
    expect(celdas[3]).toMatch(/1000,00\s€/);
  });
});

describe('Ranking del mes (Reportes)', () => {
  it('arranca en lo cobrado', () => {
    render(<RankingGestoras asesoras={[{ asesora: 'Gestora A', ventas: 3, vendido: 1000, cobrado: 2000 }]} mes="noviembre" />);
    expect(screen.getByRole('button', { name: 'Cobrado' }).getAttribute('aria-pressed')).toBe('true');
  });
});
