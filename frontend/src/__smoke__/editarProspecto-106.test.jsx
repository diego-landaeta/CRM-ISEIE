// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/*
  «Editar prospecto» (la ficha en modo edición) con las piezas comunes
  (#106), como en MultiCRM: etiquetas del Field compartido (eran <p>
  sueltos), el canal con el desplegable del CRM y las notas con la clase común.
*/

const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: avisos.toast }));

import LeadInfoCard from '@/modules/leads/components/lead-detail/LeadInfoCard';

const lead = { id: 7, nombre: 'Ana Test', email: 'ana@prueba.local', telefono: '', notas: 'hola', origen: 'meta_ads' };
const editar = (onUpdate = vi.fn()) => {
  const r = render(<LeadInfoCard lead={lead} onUpdate={onUpdate} />);
  fireEvent.click(screen.getByRole('button', { name: /Editar/ }));
  return r;
};

describe('Editar prospecto (#106)', () => {
  afterEach(() => cleanup());

  it('cada campo con su etiqueta del Field común, enlazada al campo', () => {
    editar();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ana Test');
    expect(screen.getByLabelText('Email')).toHaveValue('ana@prueba.local');
    expect(screen.getByLabelText('Teléfono')).toBeInTheDocument();
    expect(screen.getByLabelText('Notas').tagName).toBe('TEXTAREA');
  });

  it('el canal es el desplegable del CRM, con el canal del prospecto', () => {
    const { container } = editar();
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Canal' })).toHaveTextContent('Meta Ads');
  });

  it('las notas llevan la clase común (no una propia)', () => {
    editar();
    expect(screen.getByLabelText('Notas').className).toMatch(/h-9 .*h-auto/);
  });

  it('si no se guarda, el aviso dice qué no se pudo hacer', async () => {
    editar(vi.fn().mockResolvedValue({ success: false, error: 'El email ya existe' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'otro@prueba.local' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Guardar/ })); });
    expect(avisos.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'No se pudo guardar el prospecto', description: 'El email ya existe',
    }));
  });
});
