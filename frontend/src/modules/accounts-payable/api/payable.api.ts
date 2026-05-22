import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

export type PayableStatus = 'pending' | 'partial' | 'paid' | 'cancelled';

export interface PayablePayment {
  id: number;
  payable_id: number;
  importe: number | string;
  fecha: string;
  notas?: string | null;
  created_at?: string;
}

export interface Payable {
  id: number;
  project_id?: number | null;
  proveedor: string;
  concepto: string;
  importe_total: number | string;
  importe_pagado?: number | string;
  fecha_compromiso_pago?: string | null;
  notas?: string | null;
  status?: PayableStatus;
  payments?: PayablePayment[];
  payments_count?: number;
  created_at?: string;
  created_by_nombre?: string;
}

export interface PayableStats {
  totalPending: number;
  totalPaid: number;
  totalOverdue: number;
  count: number;
}

type Params = Record<string, string | number | undefined> | undefined;

function qs(params: Params): string {
  const filtered = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Record<string, string>;
  const s = new URLSearchParams(filtered).toString();
  return s ? '?' + s : '';
}

export const payableApi = {
  list: (params: Params = {}): Promise<ApiResponse<Payable[]>> =>
    client.get(`/accounts-payable${qs(params)}`),
  stats: (params: Params = {}): Promise<ApiResponse<PayableStats>> =>
    client.get(`/accounts-payable/stats${qs(params)}`),
  get: (id: number): Promise<ApiResponse<Payable>> =>
    client.get(`/accounts-payable/${id}`),
  create: (data: Partial<Payable>): Promise<ApiResponse<Payable>> =>
    client.post('/accounts-payable', data),
  update: (id: number, data: Partial<Payable>): Promise<ApiResponse<Payable>> =>
    client.patch(`/accounts-payable/${id}`, data),
  remove: (id: number): Promise<ApiResponse<void>> =>
    client.delete(`/accounts-payable/${id}`),
  addPayment: (
    id: number,
    data: {
      importe: number;
      fecha?: string;
      fecha_pago?: string;
      metodo?: string;
      referencia?: string;
      notas?: string | null;
    },
  ): Promise<ApiResponse<PayablePayment>> =>
    client.post(`/accounts-payable/${id}/payments`, data),
};
