// @vitest-environment jsdom
// Traída de MultiCRM (2.6.0). ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';

despuesDeCada(limpiar);
if (typeof window !== 'undefined') {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

/*
  Gemela de CRM#223, punto 2 · «Programas más vendidos · Histórico» no era
  histórico: seguía el periodo elegido. Con «Este mes» al principio de mes decía
  «Sin ventas registradas todavía», como si nunca se hubiera vendido nada.

  Terminada cuando: la etiqueta del bloque dice el periodo que enseña.
*/

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get } }));

const { nombreDelRango } = await import('@/shared/lib/rangosDeFecha');
const { default: TopProductsCard } = await import('@/modules/sales/components/TopProductsCard');

const HOY = new Date(2026, 10, 3); // 3 nov 2026 (martes)

describe('cómo se dice un rango (#223)', () => {
  it('si es un atajo, su nombre', () => {
    expect(nombreDelRango({ from: '2026-11-01', to: '2026-11-03' }, HOY)).toBe('Este mes');
    expect(nombreDelRango({ from: '2026-10-01', to: '2026-10-31' }, HOY)).toBe('El mes pasado');
    expect(nombreDelRango({ from: '2026-11-03', to: '2026-11-03' }, HOY)).toBe('Hoy');
  });

  it('si no, las fechas, cortas, y el año solo si no es el de hoy', () => {
    expect(nombreDelRango({ from: '2026-09-01', to: '2026-09-30' }, HOY)).toBe('1–30 sep');
    expect(nombreDelRango({ from: '2026-09-15', to: '2026-10-03' }, HOY)).toBe('15 sep – 3 oct');
    expect(nombreDelRango({ from: '2026-08-20', to: '2026-08-20' }, HOY)).toBe('20 ago');
    expect(nombreDelRango({ from: '2025-03-01', to: '2025-03-31' }, HOY)).toBe('1–31 mar 2025');
    expect(nombreDelRango({ from: '2025-12-15', to: '2026-01-10' }, HOY)).toBe('15 dic 2025 – 10 ene 2026');
  });

  it('sin rango, nada', () => {
    expect(nombreDelRango(null, HOY)).toBeNull();
    expect(nombreDelRango({ from: '2026-09-01' }, HOY)).toBeNull();
  });
});

describe('la tarjeta «Programas más vendidos» (#223)', () => {
  beforeEach(() => { get.mockReset(); get.mockResolvedValue({ success: true, data: [] }); });
  const pintar = async (props) => {
    render(<TopProductsCard projectId={1} {...props} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  };

  it('con un rango de la pantalla, dice ese periodo, no «Histórico»', async () => {
    await pintar({ from: '2026-09-01', to: '2026-09-30' });
    // Con el año detrás si no es el de hoy: la prueba no caduca en enero.
    expect(screen.getByText((t, el) => el.tagName === 'SPAN' && /^1–30 sep( 2026)?$/.test(t))).toBeTruthy();
    expect(screen.queryByText('Histórico')).toBeNull();
  });

  it('vacía en un periodo, lo dice del periodo, no «todavía»', async () => {
    await pintar({ from: '2026-09-01', to: '2026-09-30' });
    expect(screen.getByText(/^Sin ventas en este periodo \(1–30 sep( 2026)?\)\.$/)).toBeTruthy();
    expect(screen.queryByText(/todavía/)).toBeNull();
  });

  it('sin rango ni días sigue siendo histórico, de verdad', async () => {
    await pintar({});
    expect(screen.getByText('Histórico')).toBeTruthy();
    expect(screen.getByText('Sin ventas registradas todavía.')).toBeTruthy();
    expect(get.mock.calls[0][0]).not.toMatch(/from=|days=/);
  });

  it('con días, «Últimos Nd»', async () => {
    await pintar({ days: 30 });
    expect(screen.getByText('Últimos 30d')).toBeTruthy();
  });
});
