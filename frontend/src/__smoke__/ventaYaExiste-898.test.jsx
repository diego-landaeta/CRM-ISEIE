// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  CRM#898 (gemela CRM-ISEIE#574) · «Este alumno ya tiene una venta de este
  programa». El servidor responde 409 VENTA_YA_EXISTE con la venta que existe;
  el aviso la enseña y ofrece, por este orden, apuntar el cobro en esa venta o
  crear otra igualmente (que reenvía con `forzar`).
*/

vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/shared/components/ui/portal', () => ({ default: ({ children }) => children }));
const api = vi.hoisted(() => ({
  getById: vi.fn(async (id) => ({ success: true, data: { id, producto_contratado: 'Diplomado', importe_total: 900, importe_pagado: 300 } })),
}));
vi.mock('@/modules/conversions/api/conversions.api', () => ({ conversionsApi: api }));

import VentaYaExisteAviso, { ventaYaExistente } from '@/modules/conversions/components/VentaYaExisteAviso';

const VENTA = { id: 41, lead_id: 7, alumno: 'Alumno de prueba', programa: 'Diplomado', fecha: '2026-07-21', total: 900, cobrado: 300, pendiente: 600, motivo: 'mismo_nombre', otras: 0 };

afterEach(cleanup);

describe('aviso de venta ya existente', () => {
  it('reconoce el 409 VENTA_YA_EXISTE y nada más', () => {
    expect(ventaYaExistente({ data: { code: 'VENTA_YA_EXISTE', data: { venta: VENTA } } })).toEqual(VENTA);
    expect(ventaYaExistente({ data: { code: 'VALIDATION_ERROR' } })).toBeNull();
    expect(ventaYaExistente(new Error('red'))).toBeNull();
  });

  it('enseña el total y lo pendiente, y primero «Apuntar el cobro en esa venta»', () => {
    render(<MemoryRouter><VentaYaExisteAviso venta={VENTA} onCancelar={vi.fn()} onCrearIgualmente={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('Este alumno ya tiene una venta de este programa')).toBeInTheDocument();
    expect(screen.getByText(/total 900,00\s€, pendiente 600,00\s€/)).toBeInTheDocument();
    const botones = screen.getAllByRole('button').map((b) => b.textContent);
    expect(botones.indexOf('Apuntar el cobro en esa venta')).toBeLessThan(botones.indexOf('Crear otra venta igualmente'));
    expect(screen.getByText('Ver esa venta').getAttribute('href')).toBe('/ventas/41');
  });

  it('«Crear otra venta igualmente» llama a reenviar', async () => {
    const crear = vi.fn();
    render(<MemoryRouter><VentaYaExisteAviso venta={VENTA} onCancelar={vi.fn()} onCrearIgualmente={crear} /></MemoryRouter>);
    await act(async () => { fireEvent.click(screen.getByText('Crear otra venta igualmente')); });
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('«Apuntar el cobro en esa venta» abre el cobro de ESA venta', async () => {
    render(<MemoryRouter><VentaYaExisteAviso venta={VENTA} onCancelar={vi.fn()} onCrearIgualmente={vi.fn()} /></MemoryRouter>);
    await act(async () => { fireEvent.click(screen.getByText('Apuntar el cobro en esa venta')); });
    expect(api.getById).toHaveBeenCalledWith(41);
    expect(screen.getByRole('heading', { name: 'Registrar abono' })).toBeInTheDocument();
  });

  it('sin venta no pinta nada', () => {
    const { container } = render(<MemoryRouter><VentaYaExisteAviso venta={null} onCancelar={vi.fn()} onCrearIgualmente={vi.fn()} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
