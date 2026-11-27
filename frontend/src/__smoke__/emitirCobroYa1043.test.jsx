// @vitest-environment jsdom
// Sin jest-dom: la misma prueba en los dos CRM (en ISEIE no está instalado).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

/*
  CRM#1043 (gemela CRM-ISEIE#708) · «Emitir ya la factura de este cobro».

  Ticket de soporte del 23/11: venta en dos cuotas con la primera cobrada; el
  CRM solo ofreció «¿proforma?», la gestora dijo que no y la venta se quedó sin
  la factura de su cobro. Ahora:
    - con «Emitir desde la cola» se ofrece emitirla ya, con la misma llamada que
      el botón de la cola (y su aviso de posible duplicada, CRM#819);
    - si el cobro ya tiene su factura, no se ofrece otra;
    - sin ese permiso, se avisa de que queda en la cola y la emite administración;
    - con cobro, ya no se ofrece la proforma (el servidor la rechaza tras el primer cobro).
*/

const permisos = { cola: true };
vi.mock('@/shared/hooks/usePermission', () => ({
  default: () => ({ can: (k) => (k === 'facturas.cola' ? permisos.cola : false), llevaEquipo: false }),
}));
vi.mock('@/shared/lib/linksPago', () => ({ useLinksPagoEncendidos: () => false, linksPagoEncendidos: () => false }));
vi.mock('@/shared/components/ui/portal', () => ({ default: ({ children }) => children }));
vi.mock('@/shared/hooks/useDialogA11y', () => ({ useEscapeKey: () => {} }));
vi.mock('@/modules/products/hooks/useProducts', () => ({ useProducts: () => ({ products: [] }) }));

const toastMock = vi.fn();
vi.mock('@/shared/hooks/useToast', () => ({ toast: (...a) => toastMock(...a) }));
vi.mock('@/shared/components/ui/useConfirm', () => ({ useConfirm: () => vi.fn() }));

const preguntar = vi.fn(async () => true);
vi.mock('@/modules/invoices/lib/posibleDuplicada', async (original) => ({
  ...(await original()),
  preguntarSiEmitirDuplicada: (...a) => preguntar(...a),
}));

const get = vi.fn();
const post = vi.fn();
vi.mock('@/shared/api/client', () => ({
  default: { get: (...a) => get(...a), post: (...a) => post(...a), patch: vi.fn(), delete: vi.fn() },
  APP_BASE_URL: '',
}));

const createMock = vi.fn();
vi.mock('@/modules/conversions/api/conversions.api', () => ({
  conversionsApi: { create: (...a) => createMock(...a) },
}));

const { default: EmitirFacturaCobro } = await import('@/modules/invoices/components/EmitirFacturaCobro');
const { default: ConversionDialog } = await import('@/modules/conversions/components/ConversionDialog');
const { default: FacturacionAlDiaCard } = await import('@/modules/invoices/components/FacturacionAlDiaCard');

const COBRO = { payment_id: 700, fecha: '2026-11-23', importe: 300, origen: 'stripe', es_el_siguiente: true, posible_duplicada: null };
let cola;

beforeEach(() => {
  permisos.cola = true;
  cola = { project_id: 5, cobros: [COBRO], facturas: [], puede_emitir: true };
  get.mockReset();
  post.mockReset();
  preguntar.mockClear();
  toastMock.mockReset();
  createMock.mockReset();
  get.mockImplementation(async (url) => {
    if (url.startsWith('/invoices/cola/venta/')) return { success: true, data: cola };
    if (url.startsWith('/invoices/siguiente-numero')) return { success: true, data: { siguiente: 37 } };
    return { success: true, data: {} };
  });
  post.mockResolvedValue({ success: true, data: { id: 91, codigo: '2026/0037', payment_id: 700 } });
});
afterEach(cleanup);

const botonEmitir = () => screen.findByRole('button', { name: /Emitir ya la factura de este cobro/i });

describe('#1043 · el bloque de la factura del cobro', () => {
  it('venta con cobro inicial: se ofrece emitir y emite con la llamada de la cola', async () => {
    render(<EmitirFacturaCobro conversionId={42} />);
    fireEvent.click(await botonEmitir());
    await waitFor(() => expect(post).toHaveBeenCalledWith('/invoices/cola/generar', { projectId: 5, paymentId: 700, numero: 37 }));
    expect(get).toHaveBeenCalledWith('/invoices/cola/venta/42');
    expect(await screen.findByText(/Factura 2026\/0037 emitida/)).toBeTruthy();
    // Emitida: ya no se ofrece otra vez.
    expect(screen.queryByRole('button', { name: /Emitir ya la factura/i })).toBeNull();
  });

  it('con el cobro recién apuntado, busca ESE cobro', async () => {
    cola.cobros = [{ ...COBRO, payment_id: 650 }, COBRO];
    render(<EmitirFacturaCobro conversionId={42} paymentId={700} />);
    fireEvent.click(await botonEmitir());
    await waitFor(() => expect(post).toHaveBeenCalledWith('/invoices/cola/generar', expect.objectContaining({ paymentId: 700 })));
  });

  it('si el cobro ya tiene su factura, no se ofrece otra (no duplica)', async () => {
    cola.cobros = [];
    cola.facturas = [{ id: 80, codigo: '2026/0030', payment_id: 700, tipo: 'normal', estado: 'pagada' }];
    render(<EmitirFacturaCobro conversionId={42} paymentId={700} />);
    expect(await screen.findByText(/ya tiene su factura 2026\/0030/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Emitir ya la factura/i })).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('posible duplicada ya sabida: se pregunta antes y viaja confirmada', async () => {
    const otra = { numero: '2026/0030', fecha: '2026-11-22', importe: 300, cliente: '[PRUEBA] Otra', coincide: 'nombre' };
    cola.cobros = [{ ...COBRO, posible_duplicada: otra }];
    render(<EmitirFacturaCobro conversionId={42} />);
    fireEvent.click(await botonEmitir());
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(preguntar).toHaveBeenCalledWith(otra);
    expect(post.mock.calls[0][1]).toMatchObject({ confirmar_duplicada: true });
  });

  it('el servidor la para por posible duplicada: se pregunta y se reenvía confirmada', async () => {
    const otra = { numero: '2026/0031', fecha: '2026-11-22', importe: 300 };
    post.mockRejectedValueOnce({ data: { code: 'POSIBLE_DUPLICADA', error: 'Posible duplicada', data: { otra } } });
    render(<EmitirFacturaCobro conversionId={42} />);
    fireEvent.click(await botonEmitir());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(preguntar).toHaveBeenCalledWith(otra);
    expect(post.mock.calls[1][1]).toMatchObject({ paymentId: 700, confirmar_duplicada: true });
  });

  it('sin «Emitir desde la cola»: avisa de que lo emite administración, sin botón ni llamadas', () => {
    permisos.cola = false;
    render(<EmitirFacturaCobro conversionId={42} />);
    expect(screen.getByTestId('aviso-cobro-en-cola').textContent).toMatch(/la emite administración/);
    expect(screen.queryByRole('button', { name: /Emitir ya la factura/i })).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('#1043 · al registrar la venta con cobro (ConversionDialog)', () => {
  async function registrarPagadaEntera() {
    createMock.mockResolvedValue({ success: true, data: { id: 42, importe_total: 600, importe_pagado: 600 } });
    const { container } = render(<ConversionDialog open onClose={vi.fn()} lead={{ id: 9, nombre: '[PRUEBA] Alumno' }} projectId={5} />);
    fireEvent.change(container.querySelector('input[placeholder*="producto"]'), { target: { value: 'Curso' } });
    fireEvent.change(container.querySelector('input[type="number"][required]'), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: /Pagó TODO/i }));
    fireEvent.submit(container.querySelector('form'));
    await screen.findByText('Venta registrada');
  }

  it('con permiso: «Emitir ya la factura de este cobro», sin proforma', async () => {
    await registrarPagadaEntera();
    expect(await botonEmitir()).toBeTruthy();
    expect(screen.queryByRole('button', { name: /proforma|presupuesto/i })).toBeNull();
    expect(screen.getByTestId('que-es-cada-una').textContent).toMatch(/Proforma/);
  });

  it('sin permiso: el aviso de la cola en vez de «¿proforma?»', async () => {
    permisos.cola = false;
    await registrarPagadaEntera();
    expect(screen.getByTestId('aviso-cobro-en-cola')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Emitir ya la factura/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /proforma|presupuesto/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^Cerrar$/ })).toBeTruthy();
  });
});

describe('#1043 · «factúrala desde la cola» lleva a ese cobro', () => {
  const estadoCola = {
    al_dia_hasta: null, updated_at: null, pagos_sin_factura: 2, importe_sin_factura: 400,
    cola: [
      { payment_id: 650, conversion_id: 40, fecha: '2026-11-20', importe: 100, cliente: '[PRUEBA] Uno', producto: null, gestora: null, origen: 'manual', es_el_siguiente: true },
      { payment_id: 700, conversion_id: 42, fecha: '2026-11-23', importe: 300, cliente: '[PRUEBA] Dos', producto: null, gestora: null, origen: 'stripe', es_el_siguiente: false },
    ],
  };
  beforeEach(() => {
    get.mockImplementation(async () => ({ success: true, data: estadoCola }));
  });

  it('la fila de ese cobro sale marcada', async () => {
    render(<FacturacionAlDiaCard projectId={5} resaltar={{ paymentId: 700, projectId: 5 }} />);
    const fila = await screen.findByText('[PRUEBA] Dos');
    expect(fila.closest('tr').getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('[PRUEBA] Uno').closest('tr').getAttribute('aria-current')).toBeNull();
    expect(screen.queryByTestId('cobro-no-en-cola')).toBeNull();
  });

  it('si no está en la cola, se dice', async () => {
    render(<FacturacionAlDiaCard projectId={5} resaltar={{ paymentId: 999, projectId: 5 }} />);
    expect(await screen.findByTestId('cobro-no-en-cola')).toBeTruthy();
  });

  it('la cola de otro campus no dice nada', async () => {
    render(<FacturacionAlDiaCard projectId={6} resaltar={{ paymentId: 999, projectId: 5 }} />);
    await screen.findByText('[PRUEBA] Uno');
    expect(screen.queryByTestId('cobro-no-en-cola')).toBeNull();
  });
});
