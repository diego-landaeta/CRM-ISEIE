import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';
import type { CommissionRow } from '../lib/period';

type Params = Record<string, string | number | null | undefined> | undefined;

export interface CommissionStats {
  total: number;
  pagado: number;
  pendiente: number;
  cantidad: number;
}

export interface CommissionRule {
  id: number;
  project_id: number;
  user_id: number;
  product_id: number | null;
  pct: number;
  base_calc: 'cobrado' | 'vendido';
  active: boolean;
  user_nombre?: string;
  product_nombre?: string;
  project_nombre?: string;
}

const qs = (params: Params): string => {
  const filtered = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  ) as Record<string, string>;
  const s = new URLSearchParams(filtered).toString();
  return s ? `?${s}` : '';
};

export const commissionsApi = {
  // Reglas (admin/superadmin)
  listRules: (params?: Params): Promise<ApiResponse<CommissionRule[]>> =>
    client.get(`/commissions/rules${qs(params)}`),
  createRule: (data: Partial<CommissionRule>): Promise<ApiResponse<CommissionRule>> =>
    client.post('/commissions/rules', data),
  updateRule: (id: number, data: Partial<CommissionRule>): Promise<ApiResponse<CommissionRule>> =>
    client.patch(`/commissions/rules/${id}`, data),
  deleteRule: (id: number): Promise<ApiResponse<void>> =>
    client.delete(`/commissions/rules/${id}`),

  // Vista propia gestor
  listMine: (params?: Params): Promise<ApiResponse<CommissionRow[]>> =>
    client.get(`/commissions/me${qs(params)}`),
  statsMine: (params?: Params): Promise<ApiResponse<CommissionStats>> =>
    client.get(`/commissions/me/stats${qs(params)}`),

  // Vista admin
  list: (params?: Params): Promise<ApiResponse<CommissionRow[]>> =>
    client.get(`/commissions${qs(params)}`),
  stats: (params?: Params): Promise<ApiResponse<CommissionStats>> =>
    client.get(`/commissions/stats${qs(params)}`),

  // Acciones
  pay: (id: number, data: { fecha_pago: string }): Promise<ApiResponse<CommissionRow>> =>
    client.patch(`/commissions/${id}/pay`, data),
  recalculate: (conversionId: number): Promise<ApiResponse<CommissionRow[]>> =>
    client.post(`/commissions/recalculate/${conversionId}`),
};
