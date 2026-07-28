import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

// Categorías declaradas en backend expense.validation.js + extensiones EPIC B (082).
// Las 3 finales son auto-generadas por el sistema:
// - comision_pasarela_pago: fee Stripe payout (B0)
// - comision_gestor:        comisión de ventas pagada (E)
// - nomina:                 nómina procesada (F)
export type ExpenseCategory =
  | 'salarios'
  | 'alquiler'
  | 'proveedores'
  | 'software'
  | 'publicidad'
  | 'impuestos'
  | 'servicios'
  | 'mantenimiento'
  | 'otros'
  | 'comision_pasarela_pago'
  | 'comision_gestor'
  | 'nomina';

export const MANUAL_CATEGORIES: ExpenseCategory[] = [
  'salarios', 'alquiler', 'proveedores', 'software', 'publicidad',
  'impuestos', 'servicios', 'mantenimiento', 'otros',
];
export const AUTO_CATEGORIES: ExpenseCategory[] = [
  'comision_pasarela_pago', 'comision_gestor', 'nomina',
];

export interface Expense {
  id: number;
  project_id?: number | null;
  fecha: string;
  categoria: ExpenseCategory | string;
  proveedor?: string | null;
  concepto: string;
  importe: number | string;
  notas?: string | null;
  proyecto_nombre?: string | null;
  registrado_por_nombre?: string | null;
  created_by_nombre?: string;
  created_at?: string;
  // Comprobante (PDF/JPG/PNG/WEBP) — opcional
  comprobante_url?: string | null;
  comprobante_key?: string | null;
  comprobante_mime?: string | null;
  comprobante_size_bytes?: number | null;
  // Trazabilidad de origen — si !== null, generado automáticamente
  source_payable_id?: number | null;
  source_stripe_payout_id?: string | null;
}

export interface ComprobanteUploadResult {
  comprobante_url: string;
  comprobante_key: string;
  comprobante_mime: string;
  comprobante_size_bytes: number;
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
  uploadComprobante: (file: File): Promise<ApiResponse<ComprobanteUploadResult>> => {
    const fd = new FormData();
    fd.append('file', file);
    return client.post('/accounting/expenses/upload-comprobante', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
