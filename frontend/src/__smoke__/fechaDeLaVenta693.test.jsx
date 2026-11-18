// @vitest-environment jsdom
// Traída de MultiCRM (#693). ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';

despuesDeCada(limpiar);

// #693 · La fecha de una venta salía un día distinta en la lista (Finanzas ›
// Ventas) y en su detalle. La venta es un DATE («2026-10-12»): la lista lo leía
// tal cual y el detalle con `new Date()`, que es medianoche UTC. Se prueba desde
// Bogotá (UTC-5), donde esa medianoche es el día anterior a las 19:00.
process.env.TZ = 'America/Bogota';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { hoyEnMadrid, sumarMeses } from '@/shared/lib/fechas';
import { formatDate } from '@/shared/lib/format';

const venta = vi.hoisted(() => ({ actual: null }));
vi.mock('@/shared/api/client', () => ({
  default: { get: vi.fn(async () => ({ success: true, data: venta.actual })) },
}));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/modules/sales/components/RepartoVentaCard', () => ({ default: () => null }));
// La ficha pide permisos (cargos de Stripe sin enlazar, gemela de CRM#892; links de
// pago). Aquí no se miran: sin ninguno, esas tarjetas no salen y no hace falta sesión.
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => false, llevaEquipo: false }) }));

const { default: SaleDetailPage } = await import('@/modules/sales/pages/SaleDetailPage');

afterEach(() => { vi.useRealTimers(); });

describe('#693 · el día de una venta nueva es el de Madrid', () => {
  it('una venta a las 23:30 de Madrid es de ese día', () => {
    // 11/10/2026 23:30 en Madrid (CEST, UTC+2) = 21:30 UTC.
    expect(hoyEnMadrid(new Date('2026-10-11T21:30:00Z'))).toBe('2026-10-11');
  });

  it('una venta a las 00:30 de Madrid ya es del día siguiente (en UTC aún era «ayer»)', () => {
    // 12/10/2026 00:30 en Madrid = 11/10 22:30 UTC = 11/10 17:30 en Bogotá.
    const instante = new Date('2026-10-11T22:30:00Z');
    expect(instante.toISOString().slice(0, 10)).toBe('2026-10-11'); // lo de antes
    expect(hoyEnMadrid(instante)).toBe('2026-10-12');
  });

  it('en invierno (UTC+1) también', () => {
    expect(hoyEnMadrid(new Date('2026-12-31T22:30:00Z'))).toBe('2026-12-31'); // 23:30
    expect(hoyEnMadrid(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01'); // 00:30
  });

  it('sin argumento, el de ahora', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T22:30:00Z'));
    expect(hoyEnMadrid()).toBe('2026-10-12');
  });
});

describe('#693 · las cuotas no se corren de día', () => {
  it('la cuota del día 1 sigue siendo del día 1 un mes después', () => {
    expect(sumarMeses('2026-03-01', 0)).toBe('2026-03-01');
    expect(sumarMeses('2026-03-01', 1)).toBe('2026-04-01');
    expect(sumarMeses('2026-11-15', 2)).toBe('2027-01-15');
  });
});

describe('#693 · lista y detalle dicen el mismo día', () => {
  it('el formateador de la lista lee el día tal cual', () => {
    expect(formatDate('2026-10-12')).toMatch(/^12 oct/);
  });

  it('el detalle de la venta enseña el 12, no el 11', async () => {
    venta.actual = {
      id: 552, lead_id: 3, producto_contratado: 'Curso', importe_total: 430, importe_pagado: 0,
      importe_pendiente: 430, fecha_conversion: '2026-10-12', fecha_compromiso_pago: null,
      metodo_pago: 'tarjeta', notas_pago: null, lead_nombre: 'Prueba', lead_email: 'p@test.com',
      proyecto_nombre: 'Campus', payments: [], installments: [], items: [],
    };
    render(
      <MemoryRouter initialEntries={['/finanzas/ventas/552']}>
        <Routes><Route path="/finanzas/ventas/:id" element={<SaleDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Datos de la venta');
    const lista = formatDate('2026-10-12');
    expect(screen.getByText(lista)).toBeTruthy();
    expect(screen.queryByText(/11 oct 2026/)).toBeNull();
  });
});
