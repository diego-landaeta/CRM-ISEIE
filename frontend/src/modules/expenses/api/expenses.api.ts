import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

// Categorias declaradas en la migracion 005_expenses.sql + extensiones EPIC B (082).
// Las 3 finales son auto-generadas por el sistema (no las eliges desde el dialog):
// - comision_pasarela_pago: fee Stripe payout (B0)
// - comision_gestor:        cuando se paga una comisión de ventas (E)
// - nomina:                 cuando se procesa una nómina (F)
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

// Categorías seleccionables manualmente desde el dialog (excluye las auto-gen).
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
  concepto: string;
  importe: number | string;
  fecha: string;
  categoria: ExpenseCategory;
  notas?: string | null;
  registrado_por?: number | null;
  registrado_por_nombre?: string | null;
  proyecto_nombre?: string | null;
  // Comprobante (PDF/JPG/PNG/WEBP) — opcional
  comprobante_url?: string | null;
  comprobante_key?: string | null;
  comprobante_mime?: string | null;
  comprobante_size_bytes?: number | null;
  // Trazabilidad de origen — si !== null, el egreso fue creado automáticamente
  // por el sistema y NO debería editarse desde el dialog normal.
  source_payable_id?: number | null;
  source_stripe_payout_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateExpenseInput {
  project_id?: number | null;
  concepto: string;
  importe: number;
  fecha: string;
  categoria: ExpenseCategory;
  notas?: string | null;
  comprobante_url?: string | null;
  comprobante_key?: string | null;
  comprobante_mime?: string | null;
  comprobante_size_bytes?: number | null;
}

export type UpdateExpenseInput = Partial<CreateExpenseInput>;

export interface ComprobanteUploadResult {
  comprobante_url: string;
  comprobante_key: string;
  comprobante_mime: string;
  comprobante_size_bytes: number;
}

type Params = Record<string, string | number | undefined> | undefined;

function qs(params: Params): string {
  const filtered = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Record<string, string>;
  const s = new URLSearchParams(filtered).toString();
  return s ? '?' + s : '';
}

export const expensesApi = {
  list: (params: Params = {}): Promise<ApiResponse<Expense[]>> =>
    client.get(`/expenses${qs(params)}`),
  get: (id: number): Promise<ApiResponse<Expense>> =>
    client.get(`/expenses/${id}`),
  create: (data: CreateExpenseInput): Promise<ApiResponse<Expense>> =>
    client.post('/expenses', data),
  update: (id: number, data: UpdateExpenseInput): Promise<ApiResponse<Expense>> =>
    client.patch(`/expenses/${id}`, data),
  delete: (id: number): Promise<ApiResponse<void>> =>
    client.delete(`/expenses/${id}`),
  // Sube el comprobante (PDF/JPG/PNG/WEBP) y devuelve los metadatos para anexar
  // al payload de create/update. Backend: POST /api/expenses/upload-comprobante.
  uploadComprobante: (file: File): Promise<ApiResponse<ComprobanteUploadResult>> => {
    const fd = new FormData();
    fd.append('file', file);
    return client.post('/expenses/upload-comprobante', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
