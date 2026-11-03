// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';

/*
  «Producto» (alta y edición) con las piezas comunes (#106), gemela de la de
  MultiCRM: fuera la copia local de la clase de los campos (`smallInput`, otro
  redondeo y otro foco) y la del Field; el régimen fiscal con su Field; y los
  avisos dicen en qué campo está el problema, en español.

  En ISEIE el producto tiene UN enlace de pago (Stripe) y no la lista de
  enlaces ni la cascada de categorías de MultiCRM: las pruebas de los enlaces
  múltiples no aplican y aquí no están.
*/

const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: avisos.toast }));
vi.mock('@/shared/components/ui/portal', () => ({ default: ({ children }) => children }));
vi.mock('@/shared/hooks/useDialogA11y', () => ({ useEscapeKey: () => {} }));
vi.mock('@/shared/components/ui/useConfirm', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeProject: { id: 1, producto_label: 'Curso' } }) }));
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn().mockResolvedValue({ success: true, data: [] }) } }));
vi.mock('@/modules/products/api/products.api', () => ({
  uploadProductImage: vi.fn(), deleteProductImage: vi.fn(), getProductImageUrl: vi.fn(),
}));

import ProductFormDialog from '@/modules/products/components/ProductFormDialog';
import { productSchema } from '@/modules/products/validation/product.schema';

afterEach(cleanup);

const abrir = async (onSubmit = vi.fn()) => {
  const r = render(<ProductFormDialog open onClose={vi.fn()} product={null} onSubmit={onSubmit} />);
  await act(async () => { await Promise.resolve(); });
  return r;
};
const enviar = async (container) => {
  await act(async () => { fireEvent.submit(container.querySelector('form')); });
};

describe('Producto (#106)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('todos los campos con la clase común y un nombre que dice qué son', async () => {
    const { container } = await abrir();
    const campos = [...container.querySelectorAll('input:not([type=file]), textarea')];
    expect(campos.length).toBeGreaterThan(15);
    for (const c of campos) {
      expect(c.className).toMatch(/bg-muted\/50/);
      // Con su etiqueta enlazada (o, en las de contenido, su aria-label).
      expect(c.labels?.length > 0 || Boolean(c.getAttribute('aria-label')), c.outerHTML.slice(0, 80)).toBe(true);
    }
    // La clase de antes (`smallInput`) llevaba rounded-lg y otro foco.
    expect(campos.filter((c) => c.className.includes('rounded-lg'))).toEqual([]);
  });

  it('el nombre se marca obligatorio con el Field (no con un asterisco en el texto)', async () => {
    await abrir();
    expect(screen.queryByText('Nombre *')).toBeNull();
    expect(screen.getByText('(obligatorio)')).toBeTruthy();
  });

  it('el régimen fiscal lleva su Field, con la ayuda debajo', async () => {
    await abrir();
    const campo = screen.getByRole('combobox', { name: 'Régimen fiscal' }).closest('div.min-w-0');
    expect(campo.textContent).toMatch(/Régimen fiscal \(IVA\)/);
    expect(campo.textContent).toMatch(/Déjalo por defecto/);
  });

  it('el aviso dice en qué campo está el problema, y en español', async () => {
    const { container } = await abrir();
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Máster TCC' } });
    fireEvent.change(screen.getByLabelText('Nº módulos'), { target: { value: '-2' } });
    await enviar(container);
    await waitFor(() => expect(avisos.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Revisa «Nº módulos»', description: 'Escribe un número entero, 0 o mayor',
    })));
  });

  it('sin nombre y con un número mal: los dos en el mismo aviso', async () => {
    const onSubmit = vi.fn();
    const { container } = await abrir(onSubmit);
    fireEvent.change(screen.getByLabelText('Nº módulos'), { target: { value: '-2' } });
    await enviar(container);
    await waitFor(() => expect(avisos.toast).toHaveBeenLastCalledWith(expect.objectContaining({
      // Como en los demás formularios: una frase, sin «Campo: mensaje · …».
      title: 'Faltan datos',
      description: 'Falta el nombre en «Nombre» y un número entero (0 o más) en «Nº módulos».',
    })));
    // Debajo del nombre, en rojo, lo mismo dicho corto.
    expect(screen.getByText('Falta el nombre')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Sin el globo del navegador, «2-» en «Nº módulos» pasaba como vacío y se guardaba.
  it('«Nº módulos» con algo que no es un número: lo dice y no guarda', async () => {
    const onSubmit = vi.fn();
    const { container } = await abrir(onSubmit);
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Máster TCC' } });
    Object.defineProperty(screen.getByLabelText('Nº módulos'), 'validity', { value: { badInput: true } });
    await enviar(container);
    await waitFor(() => expect(avisos.toast).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Número no válido', description: 'En «Nº módulos», escribe solo un número.',
    })));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('con todo bien, guarda', async () => {
    const onSubmit = vi.fn().mockResolvedValue();
    const { container } = await abrir(onSubmit);
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Máster TCC' } });
    await enviar(container);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Máster TCC' })));
  });

  // El globo del navegador (min="0", step="0.01") se adelantaba al aviso del
  // esquema, que dice el campo.
  it('avisa el CRM, no el navegador; y los céntimos del precio los comprueba el esquema', async () => {
    const { container } = await abrir();
    expect(container.querySelector('form').noValidate).toBe(true);
    expect(productSchema.safeParse({ nombre: 'Máster', precio: '10.005' }).success).toBe(false);
    expect(productSchema.safeParse({ nombre: 'Máster', precio: '10.05' }).success).toBe(true);
    expect(productSchema.safeParse({ nombre: 'Máster', precio: '0.07' }).success).toBe(true);
  });

  it('el esquema ya no dice «Invalid input» ni «>= 0»', () => {
    const r = productSchema.safeParse({ nombre: 'Máster', precio: -1, plazas_totales: -3 });
    const msgs = r.error.issues.map((i) => i.message);
    expect(msgs).toContain('El precio no puede ser negativo');
    expect(msgs).toContain('Escribe un número entero, 0 o mayor');
    expect(msgs.join(' ')).not.toMatch(/Invalid input|>=/);
  });
});
