// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/*
  «Cuotas de pago» (#106): el concepto de las cuotas sin la lista del
  navegador, que tenía otro estilo y mezclaba lo escrito antes en otras
  casillas. Como el producto de Nueva venta: los de siempre en el desplegable
  del CRM y debajo la casilla para escribir otro.
*/

const api = vi.hoisted(() => ({
  listInstallments: vi.fn(), generateInstallments: vi.fn(), update: vi.fn(), toast: vi.fn(),
}));
vi.mock('@/modules/conversions/api/conversions.api', () => ({ conversionsApi: api }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: api.toast }));

import InstallmentsDialog from '@/modules/conversions/components/InstallmentsDialog';

const conversion = { id: 7, importe_total: 900, importe_pagado: 0, metodo_pago: 'tarjeta' };
const abrir = async () => {
  const r = render(<InstallmentsDialog conversion={conversion} onClose={vi.fn()} onSaved={vi.fn()} />);
  await screen.findByRole('combobox', { name: 'Concepto de las cuotas' });
  return r;
};

describe('Cuotas de pago: el concepto (#106)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listInstallments.mockResolvedValue({ success: true, data: [] });
    api.generateInstallments.mockResolvedValue({ success: true });
    api.update.mockResolvedValue({ success: true });
  });
  afterEach(() => cleanup());

  it('sin la lista del navegador: el desplegable del CRM con los de siempre', async () => {
    const { container } = await abrir();
    expect(container.querySelector('datalist')).toBeNull();
    expect(container.querySelector('input[list]')).toBeNull();
    fireEvent.click(screen.getByRole('combobox', { name: 'Concepto de las cuotas' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Seleccionar o escribir abajo', 'Mensualidad', 'Matrícula', 'Cuota del curso', 'Materiales', 'Certificado', 'Reserva de plaza',
    ]);
  });

  it('elegido o escrito, se guarda igual que antes', async () => {
    await abrir();
    fireEvent.click(screen.getByRole('combobox', { name: 'Concepto de las cuotas' }));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Matrícula' }));
    // La etiqueta lleva a la casilla de escribir, y ahí sale lo elegido.
    expect(screen.getByLabelText(/^Concepto de las cuotas/, { selector: 'input' })).toHaveValue('Matrícula');
    // Otro escrito a mano: el desplegable vuelve a «Seleccionar…».
    fireEvent.change(screen.getByLabelText('Escribir el concepto'), { target: { value: 'Tutoría' } });
    expect(screen.getByRole('combobox', { name: 'Concepto de las cuotas' })).toHaveTextContent('Seleccionar o escribir abajo');
    fireEvent.click(screen.getByRole('button', { name: /Guardar cuotas/ }));
    await waitFor(() => expect(api.generateInstallments).toHaveBeenCalledWith(7, expect.objectContaining({ concepto: 'Tutoría' })));
  });

  // Visto en el navegador: en el móvil el importe no se encogía y la fecha y
  // la papelera de cada cuota se salían por la derecha.
  it('en el móvil, el importe de cada cuota se encoge y deja sitio a la fecha', async () => {
    const { container } = await abrir();
    const importes = [...container.querySelectorAll('input[type="number"][step="0.01"].flex-1.h-8')];
    expect(importes.length).toBeGreaterThan(0);
    for (const i of importes) expect(i.className).toMatch(/\bmin-w-0\b/);
  });
});
