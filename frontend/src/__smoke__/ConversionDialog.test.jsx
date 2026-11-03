// @vitest-environment jsdom
// La misma prueba que en MultiCRM (frontend/src/test/ConversionDialog.test.jsx),
// traída con «Nueva venta» (paridad 2.6.0, 02/11). Lo que cambia en ISEIE: sin
// `VITE_FACTURACION_V2` el diálogo se cierra al registrar (flujo clásico), y no
// hay número de factura al convertir.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Sin `globals` en vitest, Testing Library no limpia sola entre pruebas.
afterEach(cleanup);

// Mocks ANTES de import del componente
vi.mock('@/shared/components/ui/portal', () => ({
  default: ({ children }) => children,
}));

vi.mock('@/shared/hooks/useDialogA11y', () => ({
  useEscapeKey: () => {},
}));

const productsState = { products: [] };
vi.mock('@/modules/products/hooks/useProducts', () => ({
  useProducts: () => productsState,
}));

const createMock = vi.fn();
vi.mock('@/modules/conversions/api/conversions.api', () => ({
  conversionsApi: {
    create: (...args) => createMock(...args),
  },
}));

const toastMock = vi.fn();
vi.mock('@/shared/hooks/useToast', () => ({
  toast: (...args) => toastMock(...args),
}));

import ConversionDialog from '@/modules/conversions/components/ConversionDialog';

// Las etiquetas de Field (#106) que no apuntan a ningún campo. Las de grupo
// (varios controles juntos, como «IVA» o «Pago recibido hoy») no tienen a
// cuál apuntar y se dicen aparte.
const etiquetasSueltas = (raiz, deGrupo = []) => [...raiz.querySelectorAll('label.mb-1\\.5.block.px-1')]
  .filter((l) => !deGrupo.some((g) => l.textContent.startsWith(g)))
  .filter((l) => !l.htmlFor || !raiz.ownerDocument.getElementById(l.htmlFor))
  .map((l) => l.textContent);

const baseLead = { id: 99, nombre: 'Ana Test' };

beforeEach(() => {
  productsState.products = [];
  createMock.mockReset();
  createMock.mockResolvedValue({ success: true, data: { id: 1 } });
  toastMock.mockReset();
});

describe('ConversionDialog — render base', () => {
  it('no renderiza nada cuando open=false', () => {
    render(<ConversionDialog open={false} onClose={vi.fn()} lead={baseLead} projectId={1} />);
    expect(screen.queryByText(/Registrar conversi[oó]n/i)).not.toBeInTheDocument();
  });

  it('renderiza con nombre del lead en subtítulo', () => {
    render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    expect(screen.getByText(/Lead: Ana Test/i)).toBeInTheDocument();
  });

  it('campo "Fecha compromiso" oculto si metodo_pago no es fraccionado', () => {
    render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    expect(screen.queryByText(/Fecha compromiso de pago pendiente/i)).not.toBeInTheDocument();
  });

  it('campo "Fecha compromiso" se muestra si metodo_pago = fraccionado', async () => {
    render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    // Sin productos solo hay un combobox: "Metodo de pago"
    const metodoTrigger = screen.getByRole('combobox', { name: /Método de pago/i });
    fireEvent.click(metodoTrigger);
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'Fraccionado' }));
    expect(await screen.findByText(/Fecha compromiso de pago pendiente/i)).toBeInTheDocument();
  });
});

/**
 * Rellenar el dialogo como lo hace una persona, no por posicion.
 *
 * Estas pruebas cogian los campos con `querySelectorAll('input[type=number]')[0]`
 * y `[1]`, dando por hecho que eran el total y el pagado «segun el grid del
 * JSX». Cuando el dialogo crecio —multi-item, IVA, descuentos— esos indices
 * pasaron a apuntar a otros campos, y la prueba mandaba 300 como total y 0 como
 * pagado sin que nadie lo viera. Meses en rojo.
 *
 * Y hay un cambio de verdad detras: el importe pagado YA NO SE ESCRIBE
 * directamente. Primero se elige «Sin pago», «Parcial» o «Pagó TODO», y solo
 * «Parcial» abre la casilla. Es como funciona la pantalla hoy, asi que es como
 * tiene que probarse.
 */

/** El precio base: el unico number obligatorio mientras no haya multi-item. */
const precioBase = (container) => container.querySelector('input[type="number"][required]');

/** Marca «Pagó TODO»: el pagado pasa a ser el total, sin tocar el metodo. */
const pagoTotal = () => fireEvent.click(screen.getByRole('button', { name: /Pagó TODO/i }));

/**
 * Marca «Parcial» y escribe cuanto.
 *
 * Ojo: «Parcial» pone el metodo en `fraccionado` a proposito —el resto se cobra
 * a plazos—, asi que un envio valido por esta via necesita ademas las cuotas.
 * Aqui se usa solo para los casos que se caen ANTES de esa comprobacion.
 */
const pagoParcial = (container, cuanto) => {
  fireEvent.click(screen.getByRole('button', { name: /^Parcial$/i }));
  fireEvent.change(container.querySelector('input[placeholder*="pagó"]'), { target: { value: cuanto } });
};

describe('ConversionDialog — validaciones', () => {
  it('rechaza producto vacío con toast destructive', async () => {
    const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    // No tocamos producto (queda vacío). Ponemos importe válido.
    const importeTotal = container.querySelector('input[type="number"][required]');
    fireEvent.change(importeTotal, { target: { value: '500' } });
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Falta el producto contratado', variant: 'destructive' }),
      );
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rechaza importe_total = 0 con toast destructive', async () => {
    const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    // El input de producto es text required, lo llenamos
    const productoInput = container.querySelector('input[placeholder*="producto"]');
    fireEvent.change(productoInput, { target: { value: 'Curso X' } });
    // importe_total queda vacío → 0
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Falta el precio', variant: 'destructive' }),
      );
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rechaza importe_pagado > importe_total con toast destructive', async () => {
    const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    fireEvent.change(container.querySelector('input[placeholder*="producto"]'), { target: { value: 'Curso X' } });
    fireEvent.change(precioBase(container), { target: { value: '500' } });
    pagoParcial(container, '600');
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'El pago de hoy no cuadra', variant: 'destructive' }),
      );
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  // Esta pasaba en VERDE, y era la peor de las tres.
  //
  // Decia probar «pagado = total», pero `numbers[1]` hacia rato que no era el
  // pagado: mandaba 500 de total y 0 de pagado, y como lo unico que comprobaba
  // era que la API se llamase, pasaba. Una prueba verde que no prueba lo que
  // dice es peor que una roja: la roja al menos se ve.
  //
  // Ahora se pulsa «Pagó TODO» —que es como se marca eso en la pantalla— y se
  // comprueban los dos importes, que es lo que el nombre promete.
  it('importe_pagado = importe_total se acepta (caso borde)', async () => {
    const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} onCreated={vi.fn()} />);
    fireEvent.change(container.querySelector('input[placeholder*="producto"]'), { target: { value: 'X' } });
    fireEvent.change(precioBase(container), { target: { value: '500' } });
    pagoTotal();
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0]).toMatchObject({ importe_total: 500, importe_pagado: 500 });
  });
});

describe('ConversionDialog — submit', () => {
  it('submit válido llama API con lead_id, project_id, producto e importes correctos', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <ConversionDialog open onClose={onClose} lead={baseLead} projectId={7} onCreated={onCreated} />,
    );

    fireEvent.change(container.querySelector('input[placeholder*="producto"]'), { target: { value: 'Master IA' } });
    fireEvent.change(precioBase(container), { target: { value: '1200' } });
    pagoTotal();

    fireEvent.submit(container.querySelector('form'));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));

    const payload = createMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      lead_id: 99,
      project_id: 7,
      producto_contratado: 'Master IA',
      // El IVA viene incluido por defecto —el precio del curso ya es el final—
      // asi que el total es el precio base tal cual, no 1200 + 21%.
      importe_total: 1200,
      importe_pagado: 1200,
      metodo_pago: 'tarjeta',
    });

    // En ISEIE el paso del documento sigue detrás de `VITE_FACTURACION_V2`
    // (solo en staging): sin él, la venta se registra, se avisa al padre y se
    // cierra, como siempre.
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('error de API muestra toast destructive sin cerrar el dialog', async () => {
    createMock.mockRejectedValueOnce({ data: { error: 'Lead duplicado' } });
    const onClose = vi.fn();
    const { container } = render(
      <ConversionDialog open onClose={onClose} lead={baseLead} projectId={1} onCreated={vi.fn()} />,
    );
    fireEvent.change(container.querySelector('input[placeholder*="producto"]'), { target: { value: 'X' } });
    fireEvent.change(precioBase(container), { target: { value: '100' } });
    // Desde el 21/10 hay que decir si ha pagado: sin eso ni se llama a la API.
    pagoTotal();
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'No se pudo registrar la venta', description: 'Lead duplicado' }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

// Visto en la prueba a mano de la #106: se registraba a Sergio, se cerraba, y
// al abrir el de Claudia ya estaban puestos el producto y el precio de Sergio.
describe('ConversionDialog — cada apertura empieza vacía', () => {
  const rellenar = (container) => {
    fireEvent.change(container.querySelector('#venta-producto-contratado'), { target: { value: 'Curso prueba' } });
    fireEvent.change(precioBase(container), { target: { value: '500' } });
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
    expect(precioBase(container)).toHaveValue(null);
    expect(container.querySelector('input[placeholder*="pagó"]')).toBeNull();
  });

  it('tampoco al cerrarlo sin registrar y volver a abrir el mismo', () => {
    const props = { onClose: vi.fn(), projectId: 1, lead: baseLead };
    const { container, rerender } = render(<ConversionDialog open {...props} />);
    rellenar(container);
    rerender(<ConversionDialog open={false} {...props} />);
    rerender(<ConversionDialog open {...props} />);
    expect(container.querySelector('#venta-producto-contratado')).toHaveValue('');
    expect(precioBase(container)).toHaveValue(null);
  });

  it('si el prospecto trae su producto de interés, sigue saliendo puesto', () => {
    const { container } = render(<ConversionDialog open onClose={vi.fn()} projectId={1} lead={{ id: 3, nombre: 'Eva', producto_nombre: 'Taller Logopedia' }} />);
    expect(container.querySelector('#venta-producto-contratado')).toHaveValue('Taller Logopedia');
  });
});

describe('ConversionDialog — payment links derivados', () => {
  function pickProduct(name) {
    const productoTrigger = screen.getByRole('combobox', { name: /Producto contratado/i });
    fireEvent.click(productoTrigger);
    fireEvent.mouseDown(screen.getByRole('option', { name }));
  }

  it('usa payment_links del producto si existe array', () => {
    productsState.products = [
      {
        id: 1,
        nombre: 'Master IA',
        payment_links: [
          { label: 'Pago completo', url: 'https://buy.stripe.com/full', tipo: 'completo' },
          { label: 'Anticipo', url: 'https://buy.stripe.com/down', tipo: 'anticipo' },
        ],
      },
    ];
    render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    pickProduct('Master IA');
    const linkTrigger = screen.getByRole('combobox', { name: /Enlace de pago/i });
    fireEvent.click(linkTrigger);
    expect(screen.getByRole('option', { name: /Pago completo/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Anticipo/i })).toBeInTheDocument();
  });

  it('si no hay payment_links usa fallback stripe_link como enlace único', () => {
    productsState.products = [
      { id: 1, nombre: 'Curso Y', stripe_link: 'https://buy.stripe.com/legacy', payment_links: null },
    ];
    render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    pickProduct('Curso Y');
    const linkTrigger = screen.getByRole('combobox', { name: /Enlace de pago/i });
    fireEvent.click(linkTrigger);
    expect(screen.getByRole('option', { name: /Pago completo/i })).toBeInTheDocument();
  });

  it('producto sin payment_links ni stripe_link muestra mensaje "no tiene enlaces"', () => {
    productsState.products = [{ id: 1, nombre: 'Sin enlaces', payment_links: null }];
    render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    pickProduct('Sin enlaces');
    expect(screen.getByText(/no tiene enlaces configurados/i)).toBeInTheDocument();
  });
});

// #106: «Nueva venta» con las piezas comunes. Ningún desplegable del navegador
// (el descuento y el método del pago inicial lo eran), y cada aviso dice qué
// falta y dónde.
describe('ConversionDialog — formato común (#106)', () => {
  it('no queda ningún desplegable del navegador: el descuento es el del CRM', () => {
    const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Descuento' })).toBeInTheDocument();
  });

  it('el método del pago inicial (con pago parcial) también es el del CRM', () => {
    const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    fireEvent.click(screen.getByRole('button', { name: /^Parcial$/i }));
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Método del pago inicial' })).toBeInTheDocument();
  });

  it('los avisos dicen qué falta y dónde ponerlo', async () => {
    const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    fireEvent.change(precioBase(container), { target: { value: '500' } });
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Falta el producto contratado',
      description: expect.stringMatching(/Producto contratado/),
    })));
  });

  // Sin el globo del navegador, «2-» en una casilla de número pasaba como vacío.
  it('una casilla de número con algo que no es un número va en el aviso', async () => {
    const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    fireEvent.change(container.querySelector('#venta-producto-contratado'), { target: { value: 'Curso X' } });
    Object.defineProperty(precioBase(container), 'validity', { value: { badInput: true } });
    fireEvent.submit(container.querySelector('form'));
    // Una sola vez: mal escrito, no también «falta el precio».
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Número no válido', description: 'En «Precio base (EUR)», escribe solo un número.',
    })));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('sin producto ni precio, los dos en un solo aviso', async () => {
    const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Faltan datos',
      description: 'Falta el producto en «Producto contratado» y el precio en «Precio base (EUR)».',
    })));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('el obligatorio se anuncia como tal (Field compartido)', () => {
    render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    expect(screen.getAllByText('(obligatorio)').length).toBeGreaterThanOrEqual(2);
  });

  it('cada etiqueta enlazada a su campo, salvo las de grupo (#106)', () => {
    const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    expect(etiquetasSueltas(container, ['IVA', 'Pago recibido hoy'])).toEqual([]);
  });

  // En la prueba a mano, el globo «Rellene este campo» del navegador salía
  // antes que el aviso del CRM, y no se veía nunca.
  it('avisa el CRM, no el navegador: el formulario lleva noValidate', () => {
    const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
    expect(container.querySelector('form').noValidate).toBe(true);
    // Los obligatorios lo siguen diciendo al lector de pantalla.
    expect(precioBase(container)).not.toBeNull();
  });

  // Con noValidate el navegador ya no comprueba min, max ni los céntimos de
  // step="0.01": los comprueba el CRM, los mismos, diciendo la casilla.
  describe('los límites de cada casilla, ahora los dice el CRM', () => {
    const preparar = () => {
      const r = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
      fireEvent.change(r.container.querySelector('#venta-producto-contratado'), { target: { value: 'Curso X' } });
      fireEvent.change(precioBase(r.container), { target: { value: '500' } });
      return r;
    };
    const enviarYVer = async (container, title) => {
      fireEvent.submit(container.querySelector('form'));
      await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title, variant: 'destructive' })));
      expect(createMock).not.toHaveBeenCalled();
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
      pagoTotal();
      fireEvent.submit(container.querySelector('form'));
      await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
      expect(createMock.mock.calls[0][0]).toMatchObject({ importe_total: 499.99 });
    });
  });

  describe('con catálogo: un solo desplegable', () => {
    beforeEach(() => {
      productsState.products = [{ id: 1, nombre: 'Curso Dislexia', payment_links: null }];
    });

    it('la casilla de texto no trae la lista del navegador (el catálogo ya está arriba)', () => {
      const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
      expect(container.querySelector('#venta-producto-contratado').getAttribute('list')).toBeNull();
      expect(container.querySelector('datalist')).toBeNull();
    });

    it('con un nombre escrito a mano, el desplegable dice «Seleccionar…», no se queda en blanco', () => {
      const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
      fireEvent.change(container.querySelector('#venta-producto-contratado'), { target: { value: 'Curso prueba' } });
      expect(screen.getByRole('combobox', { name: /Producto contratado/i })).toHaveTextContent('Seleccionar o escribir abajo');
    });

    it('al elegir del catálogo, la casilla de texto se rellena igual que antes', () => {
      const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
      fireEvent.click(screen.getByRole('combobox', { name: /Producto contratado/i }));
      fireEvent.mouseDown(screen.getByRole('option', { name: 'Curso Dislexia' }));
      expect(container.querySelector('#venta-producto-contratado')).toHaveValue('Curso Dislexia');
      expect(screen.getByRole('combobox', { name: /Producto contratado/i })).toHaveTextContent('Curso Dislexia');
    });

    // Visto en la prueba a mano de ISEIE: con «+ Añadir más productos» cada
    // producto seguía con la lista del navegador.
    it('con varios productos, tampoco: el catálogo con el desplegable del CRM y el precio se trae igual', () => {
      productsState.products = [{ id: 1, nombre: 'Curso Dislexia', precio: 350, payment_links: null }];
      const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={1} />);
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

/**
 * 21/10/2026, Diego: eligió «Transferencia» como forma de pago, se quedó en «Sin pago» —que
 * venía marcado— y la venta salió sin cobro, sin factura y sin aviso a Make. Ahora no viene
 * nada marcado y hay que elegirlo.
 */
describe('ConversionDialog — hay que decir si ha pagado', () => {
  it('sin elegir «Sin pago», «Parcial» o «Pagó TODO» no registra la venta', async () => {
    const { container } = render(
      <ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={7} onCreated={vi.fn()} />,
    );
    fireEvent.change(container.querySelector('input[placeholder*="producto"]'), { target: { value: 'Diplomado n8n' } });
    fireEvent.change(precioBase(container), { target: { value: '965' } });
    expect(screen.getByText(/la forma de pago sola no registra el cobro/i)).toBeInTheDocument();
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Falta decir si ha pagado', variant: 'destructive' })));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('con «Sin pago» elegido sí la registra, con 0 pagado', async () => {
    const { container } = render(
      <ConversionDialog open onClose={vi.fn()} lead={baseLead} projectId={7} onCreated={vi.fn()} />,
    );
    fireEvent.change(container.querySelector('input[placeholder*="producto"]'), { target: { value: 'Diplomado n8n' } });
    fireEvent.change(precioBase(container), { target: { value: '965' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sin pago$/i }));
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0]).toMatchObject({ importe_total: 965, importe_pagado: 0 });
  });
});
