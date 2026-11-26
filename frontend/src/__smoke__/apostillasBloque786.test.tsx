// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  El bloque «Apostilla de La Haya» de la ficha de la venta y del cliente
  (CRM-ISEIE#786, gemela de CRM#1130): el paso, si está pagada y cuánto lleva en el paso; en amarillo si
  está atascada. Sin apostillas o sin `apostillas.view`, no sale nada.
*/

const get = vi.fn();
let permisos: Record<string, boolean> = { 'apostillas.view': true };
vi.mock('@/shared/api/client', () => ({
  default: { get: (...a: unknown[]) => get(...a) },
  API_BASE_URL: '/api',
  getAccessToken: () => null,
}));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k: string) => Boolean(permisos[k]) }) }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { default: ApostillasBloque } = await import('../modules/apostillas/components/ApostillasBloque');

const fila = {
  id: 7, project_id: 10, campus: 'ISEIE', lead_id: 21, cliente: 'Bárbara', cliente_email: null, conversion_id: 900,
  conversion_item_id: 1, stripe_payment_id: null, origen: 'venta', estado: 'en_tramite', estado_desde: '2026-11-10T10:00:00Z',
  responsable_id: null, responsable: null, gestora_id: 5, gestora: 'Dayana', formacion: 'Máster en Derecho Marítimo',
  direccion_envio: null, numero_seguimiento: null, notas: null, venta_producto: 'Apostilla de La Haya', cobro_email: null,
  importe: 300, cobrado: 300, pagada: true, fecha: '2026-11-23', dias_en_estado: 9, dias_aviso: 7, created_at: '2026-11-23T10:00:00Z',
  gestionable: true, ve_documentos: true,
};

beforeEach(() => { permisos = { 'apostillas.view': true }; get.mockReset(); });
afterEach(() => cleanup());

const pintar = (props: { leadId?: number; conversionId?: number }) =>
  render(<MemoryRouter><ApostillasBloque {...props} /></MemoryRouter>);

describe('ApostillasBloque', () => {
  it('en la venta: el paso, pagada y los días en el paso', async () => {
    get.mockResolvedValue({ success: true, data: [fila] });
    pintar({ conversionId: 900 });
    expect(await screen.findByText('En trámite')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/apostillas/de-venta/900');
    expect(screen.getByText(/Pagada · 300/)).toBeInTheDocument();
    expect(screen.getByText(/Lleva 9 días en este paso/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Paso 3 de 6: En trámite/)).toBeInTheDocument();
  });

  it('en la ficha del cliente pide las suyas', async () => {
    get.mockResolvedValue({ success: true, data: [fila] });
    pintar({ leadId: 21 });
    await screen.findByText('En trámite');
    expect(get).toHaveBeenCalledWith('/apostillas/de-cliente/21');
  });

  it('sin apostillas no sale nada', async () => {
    get.mockResolvedValue({ success: true, data: [] });
    const { container } = pintar({ conversionId: 900 });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('sin permiso de ver, ni se pide', () => {
    permisos = {};
    const { container } = pintar({ conversionId: 900 });
    expect(get).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
