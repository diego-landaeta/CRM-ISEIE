// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';

// Mocks de dependencias externas (deben declararse antes del import del componente).
// El componente empezo a usar `useAuth` —entro con el commit de «bugs A+B+C de
// Dayana/Ana»— y la prueba se quedo montandolo sin proveedor. Reventaba con
// «useAuth must be used within AuthProvider», y ademas el error se escapaba y
// ensuciaba la salida de los OTROS ficheros cuando corrian juntos: por eso
// parecia que ExportDialog y ConversionDialog fallaban por lo mismo, y no era
// asi. Tarea #70.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 3, nombre: 'Angel M.', email: 'angel@empresa.com', role: 'admin' },
    logout: vi.fn(),
  }),
}));

// ISEIE trabaja con un solo proyecto: no hay vista de «Todos los proyectos»
// ni desplegable de proyecto en el formulario (en MultiCRM sí, y su prueba lo
// mira; aquí no aplica).
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 1, nombre: 'ISEIE', producto_label: 'Producto' } }),
}));

vi.mock('@/modules/products/hooks/useProducts', () => ({
  useProducts: () => ({ products: [], refetch: vi.fn() }),
}));

vi.mock('@/shared/api/client', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    post: vi.fn().mockResolvedValue({ success: true }),
    patch: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/shared/hooks/useDialogA11y', () => ({
  useEscapeKey: () => {},
}));

// Portal renderiza inline para testear sin document.body shenanigans
vi.mock('@/shared/components/ui/portal', () => ({
  default: ({ children }) => children,
}));

// ProductCombobox simplificado a input controlado
vi.mock('@/modules/leads/components/ProductCombobox', () => ({
  default: ({ value, onChange, id }) => (
    <input
      id={id}
      data-testid="product-combobox"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import LeadFormDialog from '@/modules/leads/components/LeadFormDialog';

afterEach(cleanup);

// Las etiquetas de Field (#106) que no apuntan a ningún campo. Las de grupo
// (varios controles juntos, como «IVA» o «Pago recibido hoy») no tienen a
// cuál apuntar y se dicen aparte.
const etiquetasSueltas = (raiz, deGrupo = []) => [...raiz.querySelectorAll('label.mb-1\\.5.block.px-1')]
  .filter((l) => !deGrupo.some((g) => l.textContent.startsWith(g)))
  .filter((l) => !l.htmlFor || !raiz.ownerDocument.getElementById(l.htmlFor))
  .map((l) => l.textContent);

describe('LeadFormDialog', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('no renderiza nada cuando open=false', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<LeadFormDialog open={false} onClose={onClose} onSubmit={onSubmit} />);
    expect(screen.queryByText(/Nuevo Prospecto/i)).not.toBeInTheDocument();
  });

  // Los dos titulos van en minuscula y sin la palabra «Lead»: la pantalla se
  // llama Prospectos desde el repaso de vocabulario, y el dialogo tiene que
  // decir lo mismo que la pantalla desde la que se abre.
  // Los títulos de ISEIE («Nuevo Prospecto» / «Editar Lead») son los suyos.
  it('renderiza titulo "Nuevo Prospecto" cuando no hay lead', async () => {
    render(<LeadFormDialog open onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(await screen.findByText('Nuevo Prospecto')).toBeInTheDocument();
    // Espera el useEffect de carga de custom_fields para evitar warning de act()
    await act(async () => { await Promise.resolve(); });
  });

  it('renderiza titulo "Editar Lead" cuando hay un lead', async () => {
    render(<LeadFormDialog open onClose={vi.fn()} onSubmit={vi.fn()} lead={{ id: 1, nombre: 'X', email: 'x@y.com' }} />);
    expect(await screen.findByText('Editar Lead')).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
  });

  it('llama onSubmit con los datos del formulario al submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue();
    const onClose = vi.fn();
    const { container } = render(<LeadFormDialog open onClose={onClose} onSubmit={onSubmit} />);

    // Inputs por nombre del registro de react-hook-form (atributo `name`)
    const nombreInput = container.querySelector('input[name="nombre"]');
    const emailInput = container.querySelector('input[name="email"]');
    const telefonoInput = container.querySelector('input[name="telefono"]');
    expect(nombreInput).toBeInTheDocument();
    expect(emailInput).toBeInTheDocument();

    fireEvent.input(nombreInput, { target: { value: 'Juan Pérez' } });
    fireEvent.input(emailInput, { target: { value: 'juan@example.com' } });
    fireEvent.input(telefonoInput, { target: { value: '600123456' } });

    // El boton de submit es el ultimo dentro del form (puede no tener type="submit" explicito)
    const form = container.querySelector('form');
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({
      nombre: 'Juan Pérez',
      email: 'juan@example.com',
      telefono: '600123456',
      origen: 'directo',
    });
    // Tras submit, el dialog debe cerrarse
    expect(onClose).toHaveBeenCalled();
  });

  // Visto en la prueba a mano: el globo «Rellene este campo» del navegador en
  // los personalizados obligatorios. Ahora lo dice el Field de cada uno.
  // QA de Diego, 22/10, punto 11: con el nombre vacío decía «debe tener al menos 2 caracteres».
  it('el nombre vacío dice «Falta el nombre» debajo del campo y no crea', async () => {
    const onSubmit = vi.fn().mockResolvedValue();
    const { container } = render(<LeadFormDialog open onClose={vi.fn()} onSubmit={onSubmit} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.input(container.querySelector('input[name="telefono"]'), { target: { value: '600123456' } });
    fireEvent.submit(container.querySelector('form'));
    expect(await screen.findByText('Falta el nombre')).toBeInTheDocument();
    expect(screen.queryByText('El nombre debe tener al menos 2 caracteres')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('un personalizado obligatorio vacío: lo dice debajo del campo y no crea', async () => {
    const client = (await import('@/shared/api/client')).default;
    client.get.mockResolvedValueOnce({ success: true, data: [
      { id: 1, field_key: 'dni', label: 'DNI', type: 'text', required: true },
      { id: 2, field_key: 'nivel', label: 'Nivel', type: 'select', required: true, options: ['A'] },
    ] });
    const onSubmit = vi.fn().mockResolvedValue();
    const { container } = render(<LeadFormDialog open onClose={vi.fn()} onSubmit={onSubmit} />);
    await act(async () => { await Promise.resolve(); });
    const form = container.querySelector('form');
    expect(form.noValidate).toBe(true);
    fireEvent.input(container.querySelector('input[name="nombre"]'), { target: { value: 'Juan' } });
    fireEvent.input(container.querySelector('input[name="telefono"]'), { target: { value: '600123456' } });
    fireEvent.submit(form);
    expect(await screen.findByText('Falta «DNI»: es obligatorio.')).toBeInTheDocument();
    // El desplegable nunca se comprobó, y así sigue: no sale aviso para «Nivel».
    expect(screen.queryByText('Falta «Nivel»: es obligatorio.')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^DNI/), { target: { value: '12345678Z' } });
    expect(screen.queryByText('Falta «DNI»: es obligatorio.')).toBeNull();
    fireEvent.submit(form);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].custom_fields).toEqual({ dni: '12345678Z' });
  });

  // Sin el globo del navegador, «2-» en un personalizado de número pasaba como vacío.
  it('un personalizado de número con algo que no es un número: lo dice debajo y no crea', async () => {
    const client = (await import('@/shared/api/client')).default;
    client.get.mockResolvedValueOnce({ success: true, data: [{ id: 3, field_key: 'edad', label: 'Edad', type: 'number', required: false }] });
    const onSubmit = vi.fn().mockResolvedValue();
    const { container } = render(<LeadFormDialog open onClose={vi.fn()} onSubmit={onSubmit} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.input(container.querySelector('input[name="nombre"]'), { target: { value: 'Juan' } });
    fireEvent.input(container.querySelector('input[name="telefono"]'), { target: { value: '600123456' } });
    Object.defineProperty(screen.getByLabelText('Edad'), 'validity', { value: { badInput: true } });
    fireEvent.submit(container.querySelector('form'));
    expect(await screen.findByText('En «Edad», escribe solo un número.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Al cerrar y volver a abrir, el aviso de la vez anterior no se arrastra.
  it('al volver a abrir, no sale el aviso de un personalizado de la vez anterior', async () => {
    const client = (await import('@/shared/api/client')).default;
    const antes = client.get.getMockImplementation();
    client.get.mockResolvedValue({ success: true, data: [
      { id: 1, field_key: 'dni', label: 'DNI', type: 'text', required: true },
    ] });
    try {
      const props = { onClose: vi.fn(), onSubmit: vi.fn().mockResolvedValue(), lead: null };
      const { container, rerender } = render(<LeadFormDialog open {...props} />);
      await act(async () => { await Promise.resolve(); });
      fireEvent.input(container.querySelector('input[name="nombre"]'), { target: { value: 'Juan' } });
      fireEvent.input(container.querySelector('input[name="telefono"]'), { target: { value: '600123456' } });
      fireEvent.submit(container.querySelector('form'));
      expect(await screen.findByText('Falta «DNI»: es obligatorio.')).toBeInTheDocument();
      rerender(<LeadFormDialog open={false} {...props} />);
      rerender(<LeadFormDialog open {...props} />);
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByLabelText(/^DNI/)).toBeInTheDocument();
      expect(screen.queryByText('Falta «DNI»: es obligatorio.')).toBeNull();
    } finally {
      client.get.mockImplementation(antes);
    }
  });

  it('no llama onSubmit si el email es invalido', async () => {
    const onSubmit = vi.fn();
    const { container } = render(<LeadFormDialog open onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.input(container.querySelector('input[name="nombre"]'), { target: { value: 'Juan' } });
    fireEvent.input(container.querySelector('input[name="email"]'), { target: { value: 'no-es-email' } });

    fireEvent.submit(container.querySelector('form'));

    await waitFor(() => {
      // Mensaje del schema de Zod
      expect(screen.getByText(/Email no válido: escríbelo como nombre@dominio.com/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
  // #106: el aviso de «forma de contacto» viene del esquema sin campo y no se
  // pintaba en ningún sitio: al pulsar «Crear» no pasaba nada.
  it('sin ninguna forma de contacto, dice que falta y no crea', async () => {
    const onSubmit = vi.fn();
    const { container } = render(<LeadFormDialog open onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.input(container.querySelector('input[name="nombre"]'), { target: { value: 'Juan' } });
    fireEvent.submit(container.querySelector('form'));
    const aviso = await screen.findByText(/Hace falta al menos una forma de contacto/i);
    expect(aviso).toHaveAttribute('role', 'alert');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Propio de ISEIE: con «No tiene nombre» marcado no se pide el nombre; se
  // crea como «Anónimo (tel …)».
  it('con «No tiene nombre» marcado, no pide el nombre y crea «Anónimo (tel …)»', async () => {
    const onSubmit = vi.fn().mockResolvedValue();
    const { container } = render(<LeadFormDialog open onClose={vi.fn()} onSubmit={onSubmit} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('checkbox', { name: /No tiene nombre/ }));
    fireEvent.input(container.querySelector('input[name="telefono"]'), { target: { value: '600123456' } });
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].nombre).toBe('Anónimo (tel 600123456)');
    expect(screen.queryByText('Falta el nombre')).toBeNull();
  });

  it('el desplegable de WhatsApp es el del CRM, no el del navegador', async () => {
    const { container } = render(<LeadFormDialog open onClose={vi.fn()} onSubmit={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Qué tienes de WhatsApp' })).toBeInTheDocument();
  });

  it('cada etiqueta enlazada a su campo (#106)', async () => {
    const { container } = render(<LeadFormDialog open onClose={vi.fn()} onSubmit={vi.fn()} />);
    await screen.findAllByText(/Nuevo Prospecto/);
    expect(etiquetasSueltas(container)).toEqual([]);
  });
});
