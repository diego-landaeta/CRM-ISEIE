// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Sin `globals` en vitest, Testing Library no limpia sola entre pruebas.
afterEach(cleanup);

const updateMock = vi.fn();
vi.mock('@/modules/conversions/api/conversions.api', () => ({
  conversionsApi: { update: (...a) => updateMock(...a) },
}));
const toastMock = vi.fn();
vi.mock('@/shared/hooks/useToast', () => ({ toast: (...a) => toastMock(...a) }));

import FechaInicioEditable from '@/modules/conversions/components/FechaInicioEditable';
import { faltaFechaInicio, ayudaFechaInicio, AVISO_FECHA_PASADA, AYUDA_FECHA_INICIO } from '@/modules/conversions/components/FechaInicioCurso';

/**
 * La fecha de inicio del curso en la ficha de la venta (#767, paso 1): se ve,
 * y quien puede editar ventas la pone o la cambia.
 */

beforeEach(() => {
  updateMock.mockReset();
  updateMock.mockResolvedValue({ success: true, data: {} });
  toastMock.mockReset();
});

describe('las reglas de la fecha', () => {
  it('falta si está vacía o mal escrita', () => {
    expect(faltaFechaInicio('')).toMatchObject({ title: 'Falta la fecha de inicio del curso' });
    expect(faltaFechaInicio(null)).not.toBeNull();
    expect(faltaFechaInicio('01/12/2026')).not.toBeNull();
    expect(faltaFechaInicio('2026-12-01')).toBeNull();
  });

  it('una pasada avisa de que la matrícula irá con el pago; una futura, del día anterior', () => {
    expect(ayudaFechaInicio('2026-11-01', '2026-11-23')).toBe(AVISO_FECHA_PASADA);
    expect(ayudaFechaInicio('2026-11-23', '2026-11-23')).toBe(AYUDA_FECHA_INICIO);
    expect(ayudaFechaInicio('2026-12-01', '2026-11-23')).toBe(AYUDA_FECHA_INICIO);
  });
});

describe('FechaInicioEditable', () => {
  it('sin fecha lo dice, y sin permiso no se puede tocar', () => {
    render(<FechaInicioEditable conversionId={5} value={null} canEdit={false} />);
    expect(screen.getByText(/Sin fecha: se matricula al pagar/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('con fecha, la enseña; «Cambiar» la guarda en la venta', async () => {
    const onSaved = vi.fn();
    render(<FechaInicioEditable conversionId={5} value="2026-12-01" canEdit onSaved={onSaved} />);
    expect(screen.getByText('Inicio del curso')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    fireEvent.change(screen.getByLabelText('Inicio del curso'), { target: { value: '2027-01-11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(5, { fecha_inicio: '2027-01-11' }));
    expect(onSaved).toHaveBeenCalledWith('2027-01-11');
  });

  it('no deja guardarla en blanco', async () => {
    render(<FechaInicioEditable conversionId={5} value="2026-12-01" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    fireEvent.change(screen.getByLabelText('Inicio del curso'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Falta la fecha' }));
    expect(updateMock).not.toHaveBeenCalled();
  });
});
