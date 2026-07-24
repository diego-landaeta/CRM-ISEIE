import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

export type ExpenseCategory =
  | 'sueldos' | 'marketing' | 'impuestos' | 'servicios' | 'compras' | 'otros';

export interface Expense {
  id: number;
  project_id?: number | null;
  fecha: string;
  categoria: ExpenseCategory | string;
  proveedor?: string | null;
  concepto: string;
  importe: number | string;
  notas?: string | null;
  created_by_nombre?: string;
  created_at?: string;
}

export interface ReceivableItem {
  id: number;
  cliente_nombre?: string;
  producto_nombre?: string;
  importe_pendiente: number | string;
  fecha_compromiso_pago?: string | null;
  vencido?: boolean;
  conversion_id?: number;
}

export interface AccountingDashboardData {
  totals?: {
    income?: number;
    expenses?: number;
    payable?: number;
    receivable?: number;
    netResult?: number;
  };
  byMonth?: Array<{ month: string; income: number; expenses: number }>;
  byCategory?: Array<{ categoria: string; total: number }>;
  cuentas_por_cobrar?: ReceivableItem[];
  cuentas_por_pagar?: Array<Record<string, unknown>>;
}

type Params = Record<string, string | number | undefined> | undefined;

function qs(params: Params): string {
  const filtered = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Record<string, string>;
  const s = new URLSearchParams(filtered).toString();
  return s ? '?' + s : '';
}

export const accountingApi = {
  dashboard: (params: Params = {}): Promise<ApiResponse<AccountingDashboardData>> =>
    client.get(`/accounting/dashboard${qs(params)}`),
  // Cuentas por cobrar con filtros gestora/proyecto/periodo.
  receivable: (params: Params = {}): Promise<ApiResponse<any>> =>
    client.get(`/accounting/receivable${qs(params)}`),
  listExpenses: (params: Params = {}): Promise<ApiResponse<Expense[]>> =>
    client.get(`/accounting/expenses${qs(params)}`),
  createExpense: (data: Partial<Expense>): Promise<ApiResponse<Expense>> =>
    client.post('/accounting/expenses', data),
  updateExpense: (id: number, data: Partial<Expense>): Promise<ApiResponse<Expense>> =>
    client.patch(`/accounting/expenses/${id}`, data),
  deleteExpense: (id: number): Promise<ApiResponse<void>> =>
    client.delete(`/accounting/expenses/${id}`),
};
