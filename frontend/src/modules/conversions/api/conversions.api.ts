import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

export type MetodoPago = 'tarjeta' | 'tarjeta_stripe' | 'transferencia' | 'efectivo' | 'bizum' | 'paypal' | 'fraccionado' | 'otro';

export interface Payment {
  id: number;
  conversion_id?: number;
  importe: number | string;
  fecha: string;
  notas?: string | null;
  metodo?: string | null;
  cuota_numero?: number | null;
  pagado_por_stripe?: boolean;
  created_at?: string;
  // Factura de ESTE pago (una factura por pago). Null si aún no tiene.
  factura_id?: number | null;
  factura_codigo?: string | null;
  factura_estado?: string | null;
  factura_tipo?: string | null;
  cliente_nif?: string | null;
  cliente_direccion?: string | null;
  cliente_ciudad?: string | null;
  cliente_cp?: string | null;
  cliente_pais?: string | null;
  factura_items?: unknown;
}

export interface Conversion {
  id: number;
  lead_id?: number;
  project_id?: number;
  producto_contratado: string;
  importe_total: number | string;
  importe_pagado: number | string;
  metodo_pago?: MetodoPago | null;
  fecha_conversion: string;
  fecha_compromiso_pago?: string | null;
  notas_pago?: string | null;
  payments_count?: number;
  payments?: Payment[];
  installments?: Installment[];
  lead_nombre?: string;
  product_nombre?: string;
  created_at?: string;
  // Multi-item + descuento + IVA
  items?: ConversionItem[];
  subtotal_bruto?: number | string | null;
  descuento_tipo?: 'none' | 'pct' | 'monto';
  descuento_valor?: number | string;
  descuento_importe?: number | string;
  base_imponible?: number | string | null;
  iva_pct?: number | string;
  iva_importe?: number | string | null;
  iva_incluido?: boolean;
  iva_exento?: boolean;
}

// Cuota de un plan de pago fraccionado. Cuando se cobra, se enlaza a un pago
// (payment_id) y ese pago genera su factura (factura_*).
export interface Installment {
  id: number;
  numero: number;
  importe_previsto: number | string;
  fecha_vencimiento: string;
  fecha_cobro?: string | null;
  importe_cobrado?: number | string | null;
  metodo?: string | null;
  pagado_por_stripe?: boolean;
  concepto?: string | null;
  payment_id?: number | null;
  factura_id?: number | null;
  factura_codigo?: string | null;
  factura_estado?: string | null;
  factura_tipo?: string | null;
  cliente_nif?: string | null;
  cliente_direccion?: string | null;
  cliente_ciudad?: string | null;
  cliente_cp?: string | null;
  cliente_pais?: string | null;
}

export interface ConversionItem {
  id: number;
  product_id?: number | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: number | string;
  subtotal: number | string;
  orden?: number;
}

export interface CreateConversionInput {
  lead_id: number;
  project_id: number;
  producto_contratado: string;
  importe_total: number;
  importe_pagado: number;
  metodo_pago: MetodoPago;
  fecha_compromiso_pago?: string | null;
  fecha_conversion: string;
  notas_pago?: string | null;
}

export interface AddPaymentInput {
  importe: number;
  fecha: string;
  notas?: string | null;
  // Solo cuando el usuario confirma que son dos cobros iguales de verdad.
  permitir_duplicado?: boolean;
}

type ListParams = Record<string, string | number | undefined> | undefined;

export const conversionsApi = {
  list: (params: ListParams = {}): Promise<ApiResponse<Conversion[]>> => {
    const filtered = Object.fromEntries(
      Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ) as Record<string, string>;
    const q = new URLSearchParams(filtered).toString();
    return client.get(`/conversions${q ? '?' + q : ''}`);
  },
  getById: (id: number): Promise<ApiResponse<Conversion>> =>
    client.get(`/conversions/${id}`),
  byLead: (leadId: number): Promise<ApiResponse<Conversion[]>> =>
    client.get(`/conversions/by-lead/${leadId}`),
  create: (data: CreateConversionInput): Promise<ApiResponse<Conversion>> =>
    client.post('/conversions', data),
  update: (id: number, data: Partial<Conversion>): Promise<ApiResponse<Conversion>> =>
    client.patch(`/conversions/${id}`, data),
  remove: (id: number, data: { reason: string; motivo?: string | null }): Promise<ApiResponse<void>> =>
    client.delete(`/conversions/${id}`, { data } as any),
  addPayment: (id: number, data: AddPaymentInput): Promise<ApiResponse<Payment>> =>
    client.post(`/conversions/${id}/payments`, data),
  removePayment: (paymentId: number): Promise<ApiResponse<void>> =>
    client.delete(`/conversions/payments/${paymentId}`),
  generateInstallments: (
    id: number,
    data: {
      num_cuotas?: number;
      importe_total?: number;
      fecha_inicio?: string;
      installments?: Array<{ importe_previsto: number; fecha_vencimiento: string }>;
      concepto?: string;
    },
  ): Promise<ApiResponse<unknown>> =>
    client.post(`/conversions/${id}/installments/generate`, data),
  listInstallments: (id: number): Promise<ApiResponse<any[]>> =>
    client.get(`/conversions/${id}/installments`),
  payInstallment: (
    instId: number,
    data: { importe_cobrado: number; fecha_cobro?: string; metodo?: string | null; notas?: string | null },
  ): Promise<ApiResponse<any>> =>
    client.post(`/conversions/installments/${instId}/pay`, data),
  updateInstallment: (
    instId: number,
    data: { importe_previsto?: number; fecha_vencimiento?: string },
  ): Promise<ApiResponse<any>> =>
    client.patch(`/conversions/installments/${instId}`, data),
  deleteInstallment: (instId: number): Promise<ApiResponse<void>> =>
    client.delete(`/conversions/installments/${instId}`),
  editPaidInstallment: (
    instId: number,
    data: { fecha_cobro?: string; importe_cobrado?: number },
  ): Promise<ApiResponse<any>> =>
    client.patch(`/conversions/installments/${instId}/paid`, data),
  unpayInstallment: (instId: number): Promise<ApiResponse<any>> =>
    client.post(`/conversions/installments/${instId}/unpay`, {}),

  // Devoluciones (FASE DE PRUEBA)
  listRefunds: (conversionId: number): Promise<ApiResponse<Refund[]>> =>
    client.get(`/conversions/${conversionId}/refunds`),
  createRefund: (conversionId: number, data: { importe: number; fecha?: string; motivo?: string | null }): Promise<ApiResponse<Refund>> =>
    client.post(`/conversions/${conversionId}/refunds`, data),
  removeRefund: (refundId: number): Promise<ApiResponse<void>> =>
    client.delete(`/conversions/refunds/${refundId}`),
};

export interface Refund {
  id: number;
  conversion_id: number;
  importe: number | string;
  fecha: string;
  motivo: string | null;
  created_at: string;
  created_by_nombre?: string | null;
}
