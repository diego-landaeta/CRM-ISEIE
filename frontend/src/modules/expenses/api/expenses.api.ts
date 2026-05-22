import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

// Categorias declaradas en la migracion 005_expenses.sql.
export type ExpenseCategory =
  | 'salarios'
  | 'alquiler'
  | 'proveedores'
  | 'software'
  | 'publicidad'
  | 'impuestos'
  | 'servicios'
  | 'mantenimiento'
  | 'otros';

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
}

export type UpdateExpenseInput = Partial<CreateExpenseInput>;

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
};
