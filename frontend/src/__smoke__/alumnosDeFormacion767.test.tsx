// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  CRM-ISEIE#767 (gemela de CRM#1113) · la sección «Alumnos» de la ficha de una formación: las cifras (activos,
  terminados, total y, de los activos, al día / cuotas pendientes / impago), la
  lista con su enlace a la venta, los filtros y que sin `products.alumnos` no sale.
*/

const get = vi.fn();
let permisos: Record<string, boolean> = { 'products.alumnos': true };
vi.mock('@/shared/api/client', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k: string) => Boolean(permisos[k]) }) }));

const { default: AlumnosDeFormacion } = await import('../modules/products/components/AlumnosDeFormacion');

const alumno = (id: number, nombre: string, estado: string, pago: string | null, extra = {}) => ({
  lead_id: id, nombre, email: null, gestora: 'Dayana', venta_id: 100 + id, ventas: [100 + id], fecha_venta: '2026-10-01',
  inicio: '2026-10-01', fin_acceso: '2026-12-01', origen_fin: 'duracion', detalle_fin: 'Duración de la formación: 2 meses',
  estado, motivo_fuera: null, pago, ...extra,
});

beforeEach(() => {
  permisos = { 'products.alumnos': true };
  get.mockReset();
  get.mockResolvedValue({
    success: true,
    data: {
      hoy: '2026-11-24',
      regla: { curso: 3, diplomado: 6, master: 12, configurada: false },
      solo_lo_suyo: true,
      resumen: { activos: 2, terminados: 1, baja: 1, total: 4, fuera: 0, al_dia: 1, pendiente: 0, impago: 1 },
      alumnos: [
        alumno(1, 'Ana Impago', 'activo', 'impago'),
        alumno(2, 'Berta Al Día', 'activo', 'al_dia'),
        alumno(3, 'Carla Terminó', 'terminado', 'al_dia', { fin_acceso: '2026-03-01' }),
        alumno(4, 'Dora De Baja', 'baja', 'pendiente', { fin_acceso: '2026-11-20', fecha_baja: '2026-11-20', motivo_baja: 'desistimiento' }),
      ],
    },
  });
});
afterEach(() => cleanup());

const pintar = () => render(<MemoryRouter><AlumnosDeFormacion productId={7} campusId={2} /></MemoryRouter>);

describe('AlumnosDeFormacion', () => {
  it('pide los alumnos de la formación en su campus y enseña las cifras', async () => {
    pintar();
    expect(await screen.findByText('Ana Impago')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/products/7/formacion/alumnos?projectId=2');
    const cifra = (t: string) => screen.getByText(t, { selector: 'dt' }).nextElementSibling?.textContent;
    expect(cifra('Activos')).toBe('2');
    expect(cifra('Terminados')).toBe('1');
    expect(cifra('Total')).toBe('4');
    expect(cifra('De baja')).toBe('1');
    expect(cifra('Impago')).toBe('1');
    expect(screen.getByText('(solo los de tus ventas)')).toBeInTheDocument();
  });

  it('cada alumno lleva a su venta; de serie, solo los activos; los filtros cambian la lista', async () => {
    pintar();
    const fila = await screen.findByText('Ana Impago');
    expect(fila.closest('a')).toHaveAttribute('href', '/ventas/101');
    expect(screen.queryByText('Carla Terminó')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Con impago' }));
    expect(screen.queryByText('Berta Al Día')).not.toBeInTheDocument();
    expect(screen.getByText('Ana Impago')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Terminados' }));
    expect(screen.getByText('Carla Terminó')).toBeInTheDocument();
  });

  it('filtro «De baja»: el alumno con su estado «Baja (motivo)»', async () => {
    pintar();
    await screen.findByText('Ana Impago');
    expect(screen.queryByText('Dora De Baja')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'De baja' }));
    expect(screen.getByText('Dora De Baja')).toBeInTheDocument();
    expect(screen.getByText('Baja (Desistimiento en plazo)')).toBeInTheDocument();
    expect(screen.queryByText('Ana Impago')).not.toBeInTheDocument();
  });

  it('sin el permiso no sale ni pide nada', () => {
    permisos = {};
    const { container } = pintar();
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });
});
