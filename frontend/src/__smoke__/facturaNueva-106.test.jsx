// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';

/*
  «Nueva factura» (y el abono) y «Datos fiscales» con las piezas comunes
  (#106), como en MultiCRM: ningún desplegable del navegador, cada campo con
  su Field y la clase común (las dos pantallas tenían su propia copia de
  Field), y los conceptos se apilan en el móvil en vez de estrujarse.
*/

vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({
    activeProject: { id: 1, nombre: 'ISEIE', sociedad_emisora_id: 7 },
    projects: [{ id: 1, nombre: 'ISEIE', sociedad_emisora_id: 7 }, { id: 2, nombre: 'ISEIH', sociedad_emisora_id: 7 }],
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/shared/api/client', () => ({
  default: {
    get: vi.fn((url) => Promise.resolve(url.startsWith('/products')
      ? { success: true, data: [{ id: 5, nombre: 'Máster TCC', precio: 900 }] }
      : { success: false })),
  },
}));
vi.mock('@/modules/conversions/api/conversions.api', () => ({
  conversionsApi: { byLead: vi.fn().mockResolvedValue({ success: true, data: [] }) },
}));
vi.mock('@/modules/invoices/api/invoices.api', () => ({
  invoicesApi: {
    getConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
    listIssuers: vi.fn().mockResolvedValue({ success: true, data: [{ id: 3, razon_social: 'ISEIE SL', nif: 'B1', es_default: true }] }),
    listRegimenes: vi.fn().mockResolvedValue({ success: true, data: [{ id: 9, nombre: 'España', aplica_iva: true, iva_pct: 21 }] }),
    resolveRegimen: vi.fn().mockResolvedValue({ success: false }),
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    leadFiscalData: vi.fn().mockResolvedValue({ success: false }),
  },
}));

import InvoiceCreatePage from '@/modules/invoices/pages/InvoiceCreatePage';
import { toast } from '@/shared/hooks/useToast';
import FiscalDataDialog from '@/modules/invoices/components/FiscalDataDialog';

const esperar = () => act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
const abrir = async (ruta = '/facturas/nueva') => {
  const r = render(<MemoryRouter initialEntries={[ruta]}><InvoiceCreatePage /></MemoryRouter>);
  await esperar();
  return r;
};
const camposPropios = (container) => [...container.querySelectorAll('input:not([type=checkbox]), textarea')]
  .filter((el) => !el.className.includes('bg-muted/50'));

describe('Nueva factura (#106)', () => {
  afterEach(() => cleanup());

  // En divisa, el total en euros va en la misma lista que lo demás que falta
  // (antes avisaba solo de él, y lo demás salía después).
  it('en divisa: el total en euros, en la misma lista que lo demás que falta', async () => {
    toast.mockClear();
    await abrir();
    fireEvent.click(screen.getByRole('combobox', { name: 'Moneda' }));
    fireEvent.mouseDown(screen.getByRole('option', { name: /^USD/ }));
    fireEvent.click(screen.getByRole('button', { name: /Generar factura/ }));
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Faltan datos', variant: 'destructive' }));
    expect(toast.mock.calls.at(-1)[0].description).toMatch(/^Nombre · .* · Total en euros$/);
  });

  it('no queda ningún desplegable del navegador: todos son los del CRM', async () => {
    const { container } = await abrir();
    expect(container.querySelector('select')).toBeNull();
    for (const nombre of ['Proyecto', 'Empresa que emite', 'IVA / Régimen fiscal', 'Método de pago', 'Moneda', 'Añadir un curso del catálogo']) {
      expect(screen.getByRole('combobox', { name: nombre })).toBeInTheDocument();
    }
  });

  // Visto en la prueba a mano: salía «España — 21% IVA — 21% IVA».
  it('el régimen que ya dice su IVA en el nombre no lo repite', async () => {
    const { invoicesApi } = await import('@/modules/invoices/api/invoices.api');
    const antes = invoicesApi.listRegimenes.getMockImplementation();
    invoicesApi.listRegimenes.mockResolvedValue({ success: true, data: [
      { id: 1, nombre: 'España — 21% IVA', aplica_iva: true, iva_pct: '21.00' },
      { id: 2, nombre: 'Fuera de la UE', aplica_iva: false, iva_pct: '0.00' },
      { id: 3, nombre: 'UE B2C', aplica_iva: true, iva_pct: '21.00' },
    ] });
    try {
      await abrir();
      act(() => { screen.getByRole('combobox', { name: 'IVA / Régimen fiscal' }).click(); });
      const opciones = screen.getAllByRole('option').map((o) => o.textContent);
      expect(opciones).toContain('España — 21% IVA');
      expect(opciones).toContain('Fuera de la UE — sin IVA');
      expect(opciones).toContain('UE B2C — 21% IVA');
      expect(opciones.some((o) => /IVA — 21% IVA/.test(o))).toBe(false);
    } finally {
      invoicesApi.listRegimenes.mockImplementation(antes);
    }
  });

  it('los campos llevan la clase común y el Field compartido', async () => {
    const { container } = await abrir();
    expect(camposPropios(container)).toEqual([]);
    expect(screen.getAllByText('(obligatorio)').length).toBeGreaterThanOrEqual(2);
  });

  it('«Dirección» ocupa las dos columnas solo cuando las hay (en el móvil, una)', async () => {
    await abrir();
    const campo = screen.getByText('Dirección').closest('div');
    expect(campo.className).toMatch(/sm:col-span-2/);
    expect(campo.className).not.toMatch(/(^|\s)col-span-2/);
  });

  it('los conceptos se apilan en el móvil y cada casilla dice qué es', async () => {
    const { container } = await abrir();
    const fila = screen.getByRole('textbox', { name: 'Concepto 1' }).parentElement;
    // 7 columnas en el móvil: cantidad, precio y subtotal, 2 cada uno (con 1, el
    // subtotal no cabía a 390 px).
    expect(fila.className).toMatch(/grid-cols-7 sm:grid-cols-12/);
    expect([...fila.children].find((h) => h.textContent.includes('0.00')).className).toMatch(/col-span-2 sm:col-span-1/);
    expect(screen.getByRole('spinbutton', { name: 'Precio unitario del concepto 1' })).toBeInTheDocument();
    const cabecera = [...container.querySelectorAll('span')].find((s) => s.textContent === 'Precio unit.').parentElement;
    expect(cabecera.className).toMatch(/hidden sm:grid/);
  });

  it('el abono marca lo obligatorio y usa el desplegable del CRM', async () => {
    const { container } = await abrir('/facturas/nueva?tipo=rectificativa');
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Factura a rectificar' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Motivo del abono/).tagName).toBe('TEXTAREA');
  });

  it('cada etiqueta enlazada a su campo', async () => {
    const { container } = await abrir();
    const sueltas = [...container.querySelectorAll('label.mb-1\\.5.block.px-1')]
      .filter((l) => !l.htmlFor || !document.getElementById(l.htmlFor))
      .map((l) => l.textContent);
    expect(sueltas).toEqual([]);
  });
});

describe('Datos fiscales para la factura (#106)', () => {
  afterEach(() => cleanup());
  const abrirDialogo = async () => {
    const r = render(<FiscalDataDialog projectId={1} leadId={9} defaultItems={[{ descripcion: 'Máster', cantidad: 1, precio_unitario: 900 }]}
      onClose={vi.fn()} onCreated={vi.fn()} />);
    await esperar();
    return r;
  };

  it('sin desplegables del navegador: la empresa y el método son los del CRM', async () => {
    const { container } = await abrirDialogo();
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Empresa que emite' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Método de pago' })).toBeInTheDocument();
  });

  // Al pasar el desplegable a Field, el título del apartado y la etiqueta
  // decían lo mismo: «Empresa que emite» dos veces seguidas.
  it('«Empresa que emite» sale una vez: el apartado se llama «Emisor»', async () => {
    await abrirDialogo();
    expect(screen.getAllByText('Empresa que emite')).toHaveLength(1);
    expect(screen.getByText('Emisor')).toBeInTheDocument();
  });

  it('todos los campos con la clase común y su etiqueta; las filas se apilan en el móvil', async () => {
    const { container } = await abrirDialogo();
    expect(camposPropios(container)).toEqual([]);
    expect(screen.getByLabelText('Notas (opcional)')).toBeInTheDocument();
    // Antes: `grid-cols-2` a secas, dos columnas también en un móvil de 390 px.
    expect(container.querySelector('.grid-cols-2:not(.sm\\:grid-cols-2)')).toBeNull();
  });

  it('los conceptos se apilan en el móvil y cada casilla dice qué es', async () => {
    await abrirDialogo();
    const fila = screen.getByRole('textbox', { name: 'Concepto 1' }).parentElement;
    expect(fila.className).toMatch(/grid-cols-6 sm:grid-cols-12/);
  });

  it('cada etiqueta enlazada a su campo', async () => {
    const { container } = await abrirDialogo();
    const sueltas = [...container.querySelectorAll('label.mb-1\\.5.block.px-1')]
      .filter((l) => !l.htmlFor || !document.getElementById(l.htmlFor))
      .map((l) => l.textContent);
    expect(sueltas).toEqual([]);
  });

  it('con «Emitir» apagado, dice al lado qué falta (antes el aviso no se veía nunca)', async () => {
    await abrirDialogo();
    expect(screen.getByRole('button', { name: /Emitir factura/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Para emitirla, falta en «Cliente»: Nombre · NIF / DNI / CIF · Código postal · Dirección fiscal · Ciudad.');
  });
});
