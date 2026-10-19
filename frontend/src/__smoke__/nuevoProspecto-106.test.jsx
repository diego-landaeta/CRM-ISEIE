// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/*
  «Nuevo prospecto» con las piezas comunes (#106), como en MultiCRM.

  - El aviso «Hace falta al menos una forma de contacto» viene del esquema sin
    campo y no se pintaba en ningún sitio: al pulsar «Crear» no pasaba nada.
  - El desplegable de WhatsApp era el del navegador, distinto de «Origen» y
    «País» (#125, #134).
*/

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 3, nombre: 'Ana', role: 'admin' }, logout: vi.fn() }),
}));
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
  },
}));
vi.mock('@/shared/hooks/useDialogA11y', () => ({ useEscapeKey: () => {} }));
vi.mock('@/shared/components/ui/portal', () => ({ default: ({ children }) => children }));
vi.mock('@/modules/leads/components/ProductCombobox', () => ({
  default: ({ value, onChange, id }) => <input id={id} data-testid="product-combobox" value={value || ''} onChange={(e) => onChange(e.target.value)} />,
}));

import LeadFormDialog from '@/modules/leads/components/LeadFormDialog';

// Las etiquetas de Field (#106) que no apuntan a ningún campo. Las de grupo
// (varios controles juntos, como «IVA» o «Pago recibido hoy») no tienen a
// cuál apuntar y se dicen aparte.
const etiquetasSueltas = (raiz, deGrupo = []) => [...raiz.querySelectorAll('label.mb-1\\.5.block.px-1')]
  .filter((l) => !deGrupo.some((g) => l.textContent.startsWith(g)))
  .filter((l) => !l.htmlFor || !raiz.ownerDocument.getElementById(l.htmlFor))
  .map((l) => l.textContent);

describe('Nuevo prospecto (#106)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => cleanup());

  it('sin ninguna forma de contacto, dice que falta y no crea', async () => {
    const onSubmit = vi.fn();
    const { container } = render(<LeadFormDialog open onClose={vi.fn()} onSubmit={onSubmit} lead={null} />);
    fireEvent.input(container.querySelector('input[name="nombre"]'), { target: { value: 'Juan' } });
    fireEvent.submit(container.querySelector('form'));
    const aviso = await screen.findByText(/Hace falta al menos una forma de contacto/i);
    expect(aviso).toHaveAttribute('role', 'alert');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('el correo mal escrito dice cómo escribirlo', async () => {
    const onSubmit = vi.fn();
    const { container } = render(<LeadFormDialog open onClose={vi.fn()} onSubmit={onSubmit} lead={null} />);
    fireEvent.input(container.querySelector('input[name="email"]'), { target: { value: 'no-es-email' } });
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(screen.getByText(/Email no válido: escríbelo como nombre@dominio.com/i)).toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('no queda ningún desplegable del navegador: WhatsApp usa el del CRM', () => {
    const { container } = render(<LeadFormDialog open onClose={vi.fn()} onSubmit={vi.fn()} lead={null} />);
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: /Qué tienes de WhatsApp/i })).toBeInTheDocument();
  });

  it('usa el Field compartido: el obligatorio se anuncia como tal', () => {
    render(<LeadFormDialog open onClose={vi.fn()} onSubmit={vi.fn()} lead={null} />);
    expect(screen.getAllByText('(obligatorio)').length).toBeGreaterThanOrEqual(2);
  });

  // Visto en la prueba a mano: el globo «Rellene este campo» del navegador en
  // los personalizados obligatorios. Ahora lo dice el Field de cada uno.
  it('un personalizado obligatorio vacío: lo dice debajo del campo y no crea', async () => {
    const client = (await import('@/shared/api/client')).default;
    client.get.mockResolvedValueOnce({ success: true, data: [
      { id: 1, field_key: 'dni', label: 'DNI', type: 'text', required: true },
      { id: 2, field_key: 'nivel', label: 'Nivel', type: 'select', required: true, options: ['A'] },
    ] });
    const onSubmit = vi.fn().mockResolvedValue();
    const { container } = render(<LeadFormDialog open onClose={vi.fn()} onSubmit={onSubmit} lead={null} />);
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
    const { container } = render(<LeadFormDialog open onClose={vi.fn()} onSubmit={onSubmit} lead={null} />);
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

  it('cada etiqueta enlazada a su campo (#106)', async () => {
    const { container } = render(<LeadFormDialog open onClose={vi.fn()} onSubmit={vi.fn()} />);
    await screen.findAllByText(/Nuevo prospecto/i);
    expect(etiquetasSueltas(container)).toEqual([]);
  });
});
