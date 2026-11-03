// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

/*
  «Campos personalizados» con las piezas comunes (#106): el campo tal como
  sale en los formularios (CustomFieldRenderer, que llevaba la etiqueta a
  mano con un rojo suelto y un textarea con clases propias) y la pestaña donde
  se definen (en ISEIE, su página «Campos personalizados»).
*/

vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeProject: { id: 1, nombre: 'ISEIE' } }) }));
vi.mock('@/shared/api/client', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ success: true, data: [
      { id: 8, field_key: 'nivel', label: 'Nivel de estudios', type: 'select', required: true, grupo: 'Perfil', options: ['Grado', 'Máster'] },
    ] }),
    post: vi.fn(), patch: vi.fn(), delete: vi.fn(),
  },
}));

import CustomFieldRenderer from '@/modules/field-definitions/components/CustomFieldRenderer';
import FieldDefinitionsPage from '@/modules/field-definitions/pages/FieldDefinitionsPage';

afterEach(cleanup);

const campo = (type, extra = {}) => ({ id: 1, field_key: 'k', label: 'Mi campo', type, required: true, ...extra });

describe('CustomFieldRenderer (#106)', () => {
  it('el obligatorio con el Field común: con su nombre, no un asterisco rojo suelto', () => {
    render(<CustomFieldRenderer field={campo('text')} value="" />);
    expect(screen.getByText('(obligatorio)')).toBeTruthy();
    expect(screen.getByLabelText(/^Mi campo/).className).toMatch(/bg-muted\/50/);
  });

  it('el área de texto con la clase común', () => {
    render(<CustomFieldRenderer field={campo('textarea')} value="" />);
    const t = screen.getByLabelText(/^Mi campo/);
    expect(t.tagName).toBe('TEXTAREA');
    expect(t.className).toMatch(/h-9 .*h-auto/);
  });

  it('el desplegable, con el Field y su nombre', () => {
    render(<CustomFieldRenderer field={campo('select', { options: { choices: ['A'] } })} value="" />);
    expect(screen.getByRole('combobox', { name: 'Mi campo' })).toBeTruthy();
    expect(screen.getByText('(obligatorio)')).toBeTruthy();
  });
});

// En MultiCRM los campos se definen también en la pestaña «Campos» de los
// ajustes del proyecto (FieldsTab), que ISEIE no tiene: aquí se definen en su
// página, «Campos personalizados».
describe('Campos personalizados: la página (#106)', () => {
  const abrirNuevo = async () => {
    render(<FieldDefinitionsPage />);
    await act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
    fireEvent.click(screen.getAllByRole('button', { name: /Nuevo campo/ })[0]);
  };

  it('nuevo campo: cada casilla con su etiqueta del Field y la clase común', async () => {
    await abrirNuevo();
    for (const nombre of [/^Etiqueta visible/, /^Clave interna/]) {
      expect(screen.getByLabelText(nombre).className).toMatch(/bg-muted\/50/);
    }
    // La etiqueta obligatoria lo dice con su nombre (también sale en la vista
    // previa del campo obligatorio que ya hay).
    expect(screen.getByLabelText(/^Etiqueta visible/).closest('div.min-w-0').textContent).toMatch(/\(obligatorio\)/);
  });

  it('sin etiqueta no guarda, y dice dónde ponerla', async () => {
    const { toast } = await import('@/shared/hooks/useToast');
    const client = (await import('@/shared/api/client')).default;
    await abrirNuevo();
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Falta la etiqueta', description: expect.stringMatching(/«Etiqueta visible»/), variant: 'destructive',
    }));
    expect(client.post).not.toHaveBeenCalled();
  });

  it('una clave mal escrita: dice que no es válida y en qué campo', async () => {
    const { toast } = await import('@/shared/hooks/useToast');
    await abrirNuevo();
    fireEvent.change(screen.getByLabelText(/^Etiqueta visible/), { target: { value: 'Nivel' } });
    fireEvent.change(screen.getByLabelText(/^Clave interna/), { target: { value: '9nivel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Clave no válida', description: expect.stringMatching(/«Clave interna»/),
    }));
  });
});
