// @vitest-environment jsdom
// Traída de MultiCRM (#692). ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';

despuesDeCada(limpiar);

// #692 · El detalle de una venta cuenta como cobrado lo que suman sus pagos, y
// avisa si el importe que tenía guardado la venta dice otra cosa. Era el caso de
// #551/#552 en /testeo: «Cobrado 430 €, Pendiente 0 €» con «Pagos registrados (0)».
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

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

const base = {
  id: 552, lead_id: 3, producto_contratado: 'Curso', importe_total: 430,
  fecha_conversion: '2026-10-12', fecha_compromiso_pago: null, metodo_pago: 'tarjeta',
  notas_pago: null, lead_nombre: 'Prueba', lead_email: 'p@test.com', proyecto_nombre: 'Campus',
  payments: [], installments: [], items: [],
};

function abrir() {
  return render(
    <MemoryRouter initialEntries={['/finanzas/ventas/552']}>
      <Routes><Route path="/finanzas/ventas/:id" element={<SaleDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe('#692 · el detalle de la venta y sus pagos', () => {
  it('sin pagos, avisa de que el cobrado guardado no cuadra', async () => {
    venta.actual = { ...base, importe_pagado: 0, importe_pendiente: 430, importe_pagado_guardado: 430, cobrado_de_mas: 0 };
    abrir();
    const aviso = await screen.findByRole('alert');
    expect(aviso.textContent).toMatch(/no coincide con sus pagos registrados/);
    expect(screen.getByText(/Pagos registrados \(0\)/)).toBeTruthy();
  });

  it('si cuadra, no hay aviso', async () => {
    venta.actual = { ...base, importe_pagado: 430, importe_pendiente: 0, importe_pagado_guardado: 430, cobrado_de_mas: 0 };
    abrir();
    await screen.findByText('Datos de la venta');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('con pagos por encima del importe, lo dice aparte', async () => {
    venta.actual = { ...base, importe_pagado: 860, importe_pendiente: 0, importe_pagado_guardado: 860, cobrado_de_mas: 430 };
    abrir();
    const nota = await screen.findByRole('note');
    expect(nota.textContent).toMatch(/más que el importe de la venta/);
  });
});
