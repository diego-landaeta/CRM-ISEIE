// @vitest-environment jsdom
// La misma prueba que en MultiCRM (frontend/src/test/registrarVenta-106.test.jsx),
// traída con el formulario (paridad 2.6.0, 02/11). En ISEIE «Registrar venta» no
// pregunta el campus: la venta es del proyecto elegido en la barra lateral.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

/*
  «Registrar venta» con las piezas comunes (#106). Diego, en la #134 (21/09):
  «"Registrar venta" no tenía ni Field ni FilaCampos, y en un móvil de 390px
  sus cuatro filas de dos columnas se estrujaban en vez de apilarse: "Por
  defecto: igual al total" salía cortado».
*/

const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: avisos.toast }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true }) }));
vi.mock('@/shared/api/client', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    post: vi.fn().mockResolvedValue({ success: true, data: {} }),
  },
}));
vi.mock('@/shared/components/ui/portal', () => ({ default: ({ children }) => children }));

import RegisterSaleDialog from '@/modules/sales/components/RegisterSaleDialog';

// Las etiquetas de Field (#106) que no apuntan a ningún campo.
const etiquetasSueltas = (raiz, deGrupo = []) => [...raiz.querySelectorAll('label.mb-1\\.5.block.px-1')]
  .filter((l) => !deGrupo.some((g) => l.textContent.startsWith(g)))
  .filter((l) => !l.htmlFor || !raiz.ownerDocument.getElementById(l.htmlFor))
  .map((l) => l.textContent);

const abrir = async (props = {}) => {
  const r = render(<RegisterSaleDialog open onClose={vi.fn()} project={{ id: 1, nombre: 'Campus de prueba' }} {...props} />);
  await act(async () => { await Promise.resolve(); });
  return r;
};

describe('Registrar venta (#106, #134)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  // Sin `globals` en vitest, Testing Library no limpia sola entre pruebas.
  afterEach(cleanup);

  it('no queda ningún desplegable del navegador: producto y método son los del CRM', async () => {
    const { container } = await abrir();
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Producto' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Método de pago' })).toBeInTheDocument();
  });

  it('«Por defecto: igual al total» ya no va dentro del campo, cortado: va debajo', async () => {
    const { container } = await abrir();
    expect(container.querySelector('input[placeholder^="Por defecto"]')).toBeNull();
    expect(screen.getByText(/Si lo dejas vacío, se toma el total/)).toBeInTheDocument();
  });

  it('los campos usan el Field compartido: el obligatorio se anuncia como tal', async () => {
    await abrir({ modoInicial: 'new' });
    expect(screen.getAllByText('(obligatorio)').length).toBeGreaterThanOrEqual(4);
  });

  // Con todo vacío, todo lo que falta en un solo aviso.
  it('cada aviso dice qué falta y dónde ponerlo; con todo vacío, todo a la vez', async () => {
    await abrir({ modoInicial: 'new' });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar venta' }));
    expect(avisos.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Faltan datos', variant: 'destructive' }));
    const { description } = avisos.toast.mock.calls.at(-1)[0];
    for (const que of ['el nombre en «Nombre del cliente»', 'el email o el teléfono', 'la formación en «Producto»', 'el importe en «Importe total»']) {
      expect(description).toContain(que);
    }
    // Si solo falta una cosa, su aviso de siempre.
    fireEvent.change(screen.getByLabelText(/^Nombre del cliente/), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@prueba.local' } });
    fireEvent.change(screen.getByLabelText(/^Importe total/), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar venta' }));
    expect(avisos.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Falta la formación', description: expect.stringMatching(/Producto/) }));
  });

  it('sin proyecto elegido, lo pide en el mismo aviso', async () => {
    await abrir({ project: null, modoInicial: 'new' });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar venta' }));
    const { description } = avisos.toast.mock.calls.at(-1)[0];
    expect(description).toContain('el proyecto');
  });

  it('cada etiqueta enlazada a su campo, con cliente existente y con cliente nuevo (#106)', async () => {
    const { container, unmount } = await abrir();
    expect(etiquetasSueltas(container)).toEqual([]);
    unmount();
    const nuevo = await abrir({ modoInicial: 'new' });
    expect(etiquetasSueltas(nuevo.container)).toEqual([]);
  });
});
