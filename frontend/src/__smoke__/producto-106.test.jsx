// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/*
  «Producto» con las piezas comunes (#106), como en MultiCRM: fuera la copia
  local de Field y la de la clase de los campos (`smallInput`), las áreas de
  texto con la clase común, «Datos del programa» que ya no se estruja en dos
  columnas en el móvil, y los avisos dicen en qué campo está el problema, en
  español.
*/

const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: avisos.toast }));
vi.mock('@/shared/components/ui/portal', () => ({ default: ({ children }) => children }));
vi.mock('@/shared/hooks/useDialogA11y', () => ({ useEscapeKey: () => {} }));
vi.mock('@/shared/components/ui/useConfirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeProject: { id: 1, producto_label: 'Curso' } }) }));
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn().mockResolvedValue({ success: true, data: [] }) } }));
vi.mock('@/modules/products/api/products.api', () => ({
  uploadProductImage: vi.fn(), deleteProductImage: vi.fn(), getProductImageUrl: vi.fn(),
}));

import ProductFormDialog from '@/modules/products/components/ProductFormDialog';
import { productSchema } from '@/modules/products/validation/product.schema';

const abrir = async () => {
  const r = render(<ProductFormDialog open onClose={vi.fn()} product={null} onSubmit={vi.fn()} />);
  await act(async () => { await Promise.resolve(); });
  return r;
};

describe('Producto (#106)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => cleanup());

  it('todos los campos con la clase común y un nombre que dice qué son', async () => {
    const { container } = await abrir();
    const campos = [...container.querySelectorAll('input:not([type=file]), textarea')];
    expect(campos.length).toBeGreaterThan(15);
    for (const c of campos) {
      expect(c.className).toMatch(/bg-muted\/50/);
      // Con su etiqueta enlazada (o, en los textos del programa, su aria-label).
      expect(c.labels?.length > 0 || Boolean(c.getAttribute('aria-label')), c.outerHTML.slice(0, 80)).toBe(true);
    }
    // La clase de antes (`smallInput`) llevaba rounded-lg y otro foco.
    expect(campos.filter((c) => c.className.includes('rounded-lg'))).toEqual([]);
  });

  it('el Field común: el nombre se marca obligatorio sin asterisco en el texto', async () => {
    await abrir();
    expect(screen.queryByText('Nombre *')).toBeNull();
    expect(screen.getByText('(obligatorio)')).toBeInTheDocument();
  });

  it('«Datos del programa» se apila en el móvil (antes, dos columnas a 390 px)', async () => {
    await abrir();
    const fila = screen.getByLabelText('Horas').closest('div.min-w-0').parentElement;
    expect(fila.className).toMatch(/grid-cols-1 sm:grid-cols-2/);
  });

  it('el aviso dice en qué campo está el problema, y en español', async () => {
    const { container } = await abrir();
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Máster TCC' } });
    fireEvent.change(screen.getByLabelText('Nº módulos'), { target: { value: '-2' } });
    await act(async () => { fireEvent.submit(container.querySelector('form')); });
    await waitFor(() => expect(avisos.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Revisa «Nº módulos»', description: 'Escribe un número entero, 0 o mayor',
    })));
  });

  // Como en los demás formularios: una frase, sin «Campo: mensaje · …».
  it('sin nombre y con Nº módulos mal: los dos en el mismo aviso', async () => {
    const { container } = await abrir();
    fireEvent.change(screen.getByLabelText('Nº módulos'), { target: { value: '-2' } });
    await act(async () => { fireEvent.submit(container.querySelector('form')); });
    await waitFor(() => expect(avisos.toast).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Faltan datos',
      description: 'Falta el nombre en «Nombre» y un número entero (0 o más) en «Nº módulos».',
    })));
  });

  // Sin el globo del navegador, «2-» en «Nº módulos» pasaba como vacío y se guardaba.
  it('«Nº módulos» con algo que no es un número: lo dice y no guarda', async () => {
    const onSubmit = vi.fn();
    const { container } = render(<ProductFormDialog open onClose={vi.fn()} product={null} onSubmit={onSubmit} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Máster TCC' } });
    Object.defineProperty(screen.getByLabelText('Nº módulos'), 'validity', { value: { badInput: true } });
    await act(async () => { fireEvent.submit(container.querySelector('form')); });
    await waitFor(() => expect(avisos.toast).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Número no válido', description: 'En «Nº módulos», escribe solo un número.',
    })));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Visto en la prueba a mano: el globo del navegador (min="0", step="0.01")
  // se adelantaba al aviso del esquema, que dice el campo.
  it('avisa el CRM, no el navegador; y los céntimos del precio los comprueba el esquema', async () => {
    const { container } = await abrir();
    expect(container.querySelector('form').noValidate).toBe(true);
    expect(productSchema.safeParse({ nombre: 'Máster', precio: '10.005' }).success).toBe(false);
    expect(productSchema.safeParse({ nombre: 'Máster', precio: '10.05' }).success).toBe(true);
    expect(productSchema.safeParse({ nombre: 'Máster', precio: '0.07' }).success).toBe(true);
  });

  // Visto en la prueba a mano: vacío decía «al menos 2 caracteres».
  it('sin nombre dice que es obligatorio; con una letra, que es corto', () => {
    const vacio = productSchema.safeParse({ nombre: '' });
    expect(vacio.error.issues[0].message).toBe('Falta el nombre');
    const corto = productSchema.safeParse({ nombre: 'A' });
    expect(corto.error.issues[0].message).toBe('El nombre debe tener al menos 2 caracteres');
  });

  it('el esquema ya no dice «Invalid input» ni «>= 0»', () => {
    const r = productSchema.safeParse({ nombre: 'Máster', precio: -1, plazas_totales: -3 });
    const msgs = r.error.issues.map((i) => i.message);
    expect(msgs).toContain('El precio no puede ser negativo');
    expect(msgs).toContain('Escribe un número entero, 0 o mayor');
    expect(msgs.join(' ')).not.toMatch(/Invalid input|>=/);
  });
});
