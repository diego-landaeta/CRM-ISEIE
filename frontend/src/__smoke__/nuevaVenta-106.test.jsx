// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/*
  «Nueva venta» (convertir un prospecto) con las piezas comunes (#106), como
  en MultiCRM: ningún desplegable del navegador (el descuento y el método del
  pago inicial lo eran), la clase común en vez de su copia local, y cada aviso
  dice qué falta y dónde.
*/

vi.mock('@/shared/components/ui/portal', () => ({ default: ({ children }) => children }));
vi.mock('@/shared/hooks/useDialogA11y', () => ({ useEscapeKey: () => {} }));
const catalogo = vi.hoisted(() => ({ products: [] }));
vi.mock('@/modules/products/hooks/useProducts', () => ({ useProducts: () => catalogo }));
const api = vi.hoisted(() => ({ create: vi.fn(), toast: vi.fn() }));
vi.mock('@/modules/conversions/api/conversions.api', () => ({ conversionsApi: { create: api.create } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: api.toast }));

import ConversionDialog from '@/modules/conversions/components/ConversionDialog';

// Las etiquetas de Field (#106) que no apuntan a ningún campo. Las de grupo
// (varios controles juntos, como «IVA» o «Pago recibido hoy») no tienen a
// cuál apuntar y se dicen aparte.
const etiquetasSueltas = (raiz, deGrupo = []) => [...raiz.querySelectorAll('label.mb-1\\.5.block.px-1')]
  .filter((l) => !deGrupo.some((g) => l.textContent.startsWith(g)))
  .filter((l) => !l.htmlFor || !raiz.ownerDocument.getElementById(l.htmlFor))
  .map((l) => l.textContent);

const lead = { id: 99, nombre: 'Ana Test' };
const abrir = () => render(<ConversionDialog open onClose={vi.fn()} lead={lead} projectId={1} />);

describe('Nueva venta (#106)', () => {
  beforeEach(() => { vi.clearAllMocks(); catalogo.products = []; api.create.mockResolvedValue({ success: true, data: { id: 1 } }); });
  afterEach(() => cleanup());

  it('no queda ningún desplegable del navegador: el descuento es el del CRM', () => {
    const { container } = abrir();
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Descuento' })).toBeInTheDocument();
  });

  it('el método del pago inicial (con pago parcial) también es el del CRM', () => {
    const { container } = abrir();
    fireEvent.click(screen.getByRole('button', { name: /^Parcial$/i }));
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Método del pago inicial' })).toBeInTheDocument();
  });

  it('los avisos dicen qué falta y dónde ponerlo', async () => {
    const { container } = abrir();
    fireEvent.change(container.querySelector('input[type="number"][required]'), { target: { value: '500' } });
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Falta el producto contratado',
      description: expect.stringMatching(/Producto contratado/),
    })));
    expect(api.create).not.toHaveBeenCalled();
  });

  // Sin el globo del navegador, «2-» en una casilla de número pasaba como vacío.
  it('una casilla de número con algo que no es un número va en el aviso', async () => {
    const { container } = abrir();
    fireEvent.change(container.querySelector('#venta-producto-contratado'), { target: { value: 'Curso X' } });
    Object.defineProperty(container.querySelector('#venta-precio-base'), 'validity', { value: { badInput: true } });
    fireEvent.submit(container.querySelector('form'));
    // Una sola vez: mal escrito, no también «falta el precio».
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Número no válido', description: 'En «Precio base (EUR)», escribe solo un número.',
    })));
    expect(api.create).not.toHaveBeenCalled();
  });

  it('sin producto ni precio, los dos en un solo aviso (#106)', async () => {
    const { container } = abrir();
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(api.toast).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Faltan datos',
      description: 'Falta el producto en «Producto contratado» y el precio en «Precio base (EUR)».',
    })));
    expect(api.create).not.toHaveBeenCalled();
  });

  it('si el descuento se come el precio, su aviso aparte, después de lo que falta', async () => {
    const { container } = abrir();
    fireEvent.change(container.querySelector('#venta-producto-contratado'), { target: { value: 'Curso X' } });
    fireEvent.change(container.querySelector('input[type="number"][required]'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Descuento' }));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Monto fijo (€)' }));
    fireEvent.change(container.querySelector('#venta-descuento-valor'), { target: { value: '100' } });
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(api.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'El total queda en 0' })));
    expect(api.create).not.toHaveBeenCalled();
  });

  it('el obligatorio se anuncia como tal (Field compartido)', () => {
    abrir();
    expect(screen.getAllByText('(obligatorio)').length).toBeGreaterThanOrEqual(2);
  });

  it('cada etiqueta enlazada a su campo, salvo las de grupo (#106)', () => {
    const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={lead} projectId={1} />);
    expect(etiquetasSueltas(container, ['IVA', 'Pago recibido hoy'])).toEqual([]);
  });

  // En la prueba a mano, el globo «Rellene este campo» del navegador salía
  // antes que el aviso del CRM, y no se veía nunca.
  it('avisa el CRM, no el navegador: el formulario lleva noValidate', () => {
    const { container } = abrir();
    expect(container.querySelector('form').noValidate).toBe(true);
    // Los obligatorios lo siguen diciendo al lector de pantalla.
    expect(container.querySelector('input[type="number"][required]')).not.toBeNull();
  });

  // Con noValidate el navegador ya no comprueba min, max ni los céntimos de
  // step="0.01": los comprueba el CRM, los mismos, diciendo la casilla.
  describe('los límites de cada casilla, ahora los dice el CRM', () => {
    const precioBase = (c) => c.querySelector('input[type="number"][required]');
    const preparar = () => {
      const r = abrir();
      fireEvent.change(r.container.querySelector('#venta-producto-contratado'), { target: { value: 'Curso X' } });
      fireEvent.change(precioBase(r.container), { target: { value: '500' } });
      return r;
    };
    const enviarYVer = async (container, title) => {
      fireEvent.submit(container.querySelector('form'));
      await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ title, variant: 'destructive' })));
      expect(api.create).not.toHaveBeenCalled();
    };

    it('precio con más de 2 decimales', async () => {
      const { container } = preparar();
      fireEvent.change(precioBase(container), { target: { value: '500.005' } });
      await enviarYVer(container, 'Demasiados decimales');
    });

    it('descuento negativo', async () => {
      const { container } = preparar();
      fireEvent.click(screen.getByRole('combobox', { name: 'Descuento' }));
      fireEvent.mouseDown(screen.getByRole('option', { name: 'Monto fijo (€)' }));
      fireEvent.change(container.querySelector('#venta-descuento-valor'), { target: { value: '-50' } });
      await enviarYVer(container, 'Descuento no válido');
    });

    it('IVA de más de 100', async () => {
      const { container } = preparar();
      fireEvent.change(container.querySelector('input[type="number"][max="100"]'), { target: { value: '150' } });
      await enviarYVer(container, 'IVA no válido');
    });

    it('más de 60 cuotas', async () => {
      const { container } = preparar();
      fireEvent.click(screen.getByRole('combobox', { name: /Método de pago/i }));
      fireEvent.mouseDown(await screen.findByRole('option', { name: 'Fraccionado' }));
      fireEvent.change(container.querySelector('#venta-num-cuotas'), { target: { value: '61' } });
      await enviarYVer(container, 'Demasiadas cuotas');
    });

    it('lo que estaba bien se sigue registrando igual', async () => {
      const { container } = preparar();
      fireEvent.change(precioBase(container), { target: { value: '499.99' } });
      fireEvent.click(screen.getByRole('button', { name: /Pagó TODO/i }));
      fireEvent.submit(container.querySelector('form'));
      await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
      expect(api.create.mock.calls[0][0]).toMatchObject({ importe_total: 499.99 });
    });
  });

  // Visto en la prueba a mano: se registraba a uno, se cerraba, y al abrir el
  // de otro ya estaban puestos el producto y el precio del anterior.
  describe('cada apertura empieza vacía', () => {
    const precio = (c) => c.querySelector('input[type="number"][required]');
    const rellenar = (c) => {
      fireEvent.change(c.querySelector('#venta-producto-contratado'), { target: { value: 'Curso prueba' } });
      fireEvent.change(precio(c), { target: { value: '500' } });
      fireEvent.click(screen.getByRole('button', { name: /^Parcial$/i }));
    };

    it('al abrirlo para otro prospecto no trae lo escrito para el anterior', () => {
      const props = { onClose: vi.fn(), projectId: 1 };
      const { container, rerender } = render(<ConversionDialog open lead={{ id: 1, nombre: 'Sergio' }} {...props} />);
      rellenar(container);
      rerender(<ConversionDialog open={false} lead={null} {...props} />);
      rerender(<ConversionDialog open lead={{ id: 2, nombre: 'Claudia' }} {...props} />);
      expect(screen.getByText(/Lead: Claudia/)).toBeInTheDocument();
      expect(container.querySelector('#venta-producto-contratado')).toHaveValue('');
      expect(precio(container)).toHaveValue(null);
      expect(container.querySelector('input[placeholder*="pagó"]')).toBeNull();
    });

    it('tampoco al cerrarlo sin registrar y volver a abrir el mismo', () => {
      const props = { onClose: vi.fn(), projectId: 1, lead };
      const { container, rerender } = render(<ConversionDialog open {...props} />);
      rellenar(container);
      rerender(<ConversionDialog open={false} {...props} />);
      rerender(<ConversionDialog open {...props} />);
      expect(container.querySelector('#venta-producto-contratado')).toHaveValue('');
      expect(precio(container)).toHaveValue(null);
    });

    it('si el prospecto trae su producto de interés, sigue saliendo puesto', () => {
      const { container } = render(<ConversionDialog open onClose={vi.fn()} projectId={1} lead={{ id: 3, nombre: 'Eva', producto_nombre: 'Taller Logopedia' }} />);
      expect(container.querySelector('#venta-producto-contratado')).toHaveValue('Taller Logopedia');
    });
  });

  describe('con catálogo: un solo desplegable', () => {
    beforeEach(() => { catalogo.products = [{ id: 1, nombre: 'Curso Dislexia', payment_links: null }]; });

    it('la casilla de texto no trae la lista del navegador (el catálogo ya está arriba)', () => {
      const { container } = abrir();
      expect(container.querySelector('#venta-producto-contratado').getAttribute('list')).toBeNull();
      expect(container.querySelector('datalist')).toBeNull();
    });

    it('con un nombre escrito a mano, el desplegable dice «Seleccionar…», no se queda en blanco', () => {
      const { container } = abrir();
      fireEvent.change(container.querySelector('#venta-producto-contratado'), { target: { value: 'Curso prueba' } });
      expect(screen.getByRole('combobox', { name: /Producto contratado/i })).toHaveTextContent('Seleccionar o escribir abajo');
    });

    it('al elegir del catálogo, la casilla de texto se rellena igual que antes', () => {
      const { container } = abrir();
      fireEvent.click(screen.getByRole('combobox', { name: /Producto contratado/i }));
      fireEvent.mouseDown(screen.getByRole('option', { name: 'Curso Dislexia' }));
      expect(container.querySelector('#venta-producto-contratado')).toHaveValue('Curso Dislexia');
      expect(screen.getByRole('combobox', { name: /Producto contratado/i })).toHaveTextContent('Curso Dislexia');
    });

    // Visto en la prueba a mano de ISEIE: con «+ Añadir más productos» cada
    // producto seguía con la lista del navegador.
    it('con varios productos, tampoco: el catálogo con el desplegable del CRM y el precio se trae igual', () => {
      catalogo.products = [{ id: 1, nombre: 'Curso Dislexia', precio: 350, payment_links: null }];
      const { container } = abrir();
      fireEvent.click(screen.getByRole('button', { name: /Añadir más productos/ }));
      fireEvent.click(screen.getByRole('button', { name: /añadir otro producto/ }));
      expect(container.querySelector('datalist')).toBeNull();
      expect(container.querySelector('input[list]')).toBeNull();
      fireEvent.click(screen.getByRole('combobox', { name: 'Producto 2 del catálogo' }));
      fireEvent.mouseDown(screen.getByRole('option', { name: 'Curso Dislexia' }));
      expect(screen.getByLabelText('Producto 2')).toHaveValue('Curso Dislexia');
      expect(screen.getByLabelText('Precio unitario del producto 2')).toHaveValue(350);
      // Escrito a mano, igual que antes: si coincide con el catálogo, se enlaza.
      fireEvent.change(screen.getByLabelText('Producto 1'), { target: { value: 'Curso Dislexia' } });
      expect(screen.getByRole('combobox', { name: 'Producto 1 del catálogo' })).toHaveTextContent('Curso Dislexia');
      expect(screen.getByLabelText('Precio unitario del producto 1')).toHaveValue(350);
    });
  });
});
