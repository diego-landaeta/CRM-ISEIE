// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { textoDatosFiscales, necesitaPersona } from '../lib/datosFiscalesCola';

/*
  CRM-ISEIE#452 (gemela de CRM#764) · probado en /testeo el 18/11: la emisión
  automática se paró por «posible duplicada» y la fila de la cola decía «Datos
  del alumno: sale sola». Al pulsar «Generar factura» no se confirmaba la
  duplicada. Ahora la fila dice el motivo y, si ya se sabe que se parece a otra,
  se pregunta antes y la emisión viaja con `confirmar_duplicada`.
*/

const get = vi.fn();
const post = vi.fn();
vi.mock('@/shared/api/client', () => ({ default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true }) }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { default: FacturacionAlDiaCard } = await import('./FacturacionAlDiaCard');

const otra = { id: 35, numero: '2026/0035', fecha: '2026-11-18', importe: 100, cliente: '[PRUEBA] Otra' };
const parada = {
  estado: 'respondido' as const, caduca_at: '2026-11-25T00:00:00Z', sale_sola: false,
  motivo_codigo: 'POSIBLE_DUPLICADA', motivo: 'posible duplicada: confírmala al generarla',
  detalle: 'Ya existe la factura 2026/0035…',
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/invoices/siguiente-numero')) return { success: true, data: { codigo: '2026/0036', siguiente: 36, serie: 'A' } };
    return {
      success: true,
      data: {
        al_dia_hasta: null, updated_at: null, pagos_sin_factura: 1, importe_sin_factura: 100,
        cola: [{
          payment_id: 688, conversion_id: 557, fecha: '2026-11-18', importe: 100, cliente: '[PRUEBA] Mario',
          producto: null, gestora: null, origen: 'manual', es_el_siguiente: true,
          motivo: 'posible duplicada', posible_duplicada: otra, datos_fiscales: parada,
        }],
      },
    };
  });
  post.mockResolvedValue({ success: true, data: { codigo: '2026/0036' } });
});

describe('CRM#764 · la etiqueta de la cola dice si sale sola y, si no, por qué', () => {
  it('parada por posible duplicada: NO dice «sale sola»', () => {
    expect(textoDatosFiscales(parada)).toBe('Datos del alumno: no sale sola · posible duplicada: confírmala al generarla');
    expect(necesitaPersona(parada)).toBe(true);
  });

  it('pausa de la auditoría y otros motivos, también', () => {
    expect(textoDatosFiscales({ ...parada, motivo_codigo: 'FACTURACION_PAUSADA', motivo: 'facturación pausada por la auditoría' }))
      .toBe('Datos del alumno: no sale sola · facturación pausada por la auditoría');
    expect(textoDatosFiscales({ ...parada, estado: 'ficha', motivo_codigo: 'OTRO', motivo: 'no se pudo emitir' }))
      .toBe('Con los datos de la ficha: no sale sola · no se pudo emitir');
  });

  it('esperar su turno sí sale sola; sin motivo, sale sola', () => {
    expect(textoDatosFiscales({ ...parada, sale_sola: true, motivo_codigo: 'HAY_ANTERIORES', motivo: 'espera su turno' }))
      .toBe('Datos del alumno: sale sola cuando le toque');
    expect(textoDatosFiscales({ ...parada, sale_sola: true, motivo_codigo: null, motivo: null })).toBe('Datos del alumno: sale sola');
    expect(necesitaPersona({ ...parada, sale_sola: true, motivo_codigo: null, motivo: null })).toBe(false);
  });
});

describe('CRM#764 · «Generar factura» de una posible duplicada', () => {
  it('la fila dice el motivo y la emisión confirmada lleva confirmar_duplicada', async () => {
    render(<FacturacionAlDiaCard projectId={9} />);
    expect(await screen.findByText(/no sale sola · posible duplicada/)).toBeTruthy();
    expect(screen.queryByText('Datos del alumno: sale sola')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Generar factura' }));
    // Primero la pregunta de la duplicada, con la otra factura.
    fireEvent.click(await screen.findByRole('button', { name: 'Emitir igualmente' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/invoices/cola/generar',
      expect.objectContaining({ projectId: 9, paymentId: 688, confirmar_duplicada: true }));
  });

  it('si se cancela la pregunta, no se emite nada', async () => {
    render(<FacturacionAlDiaCard projectId={9} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generar factura' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(post).not.toHaveBeenCalled();
  });
});
