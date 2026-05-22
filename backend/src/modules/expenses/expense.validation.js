import { z } from 'zod';

// Categorias declaradas en la migracion 005_expenses.sql (ENUM expense_category).
const CATEGORIES = [
  'salarios',
  'alquiler',
  'proveedores',
  'software',
  'publicidad',
  'impuestos',
  'servicios',
  'mantenimiento',
  'otros',
];

export const createExpenseSchema = z.object({
  project_id: z.number().int().positive().nullable().optional(),
  concepto: z.string().min(1, 'Concepto requerido').max(255),
  importe: z.number().positive('Importe debe ser > 0'),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha del egreso requerida (YYYY-MM-DD)'),
  categoria: z.enum(CATEGORIES).default('otros'),
  notas: z.string().max(2000).optional().nullable(),
});

export const updateExpenseSchema = z.object({
  project_id: z.number().int().positive().nullable().optional(),
  concepto: z.string().min(1).max(255).optional(),
  importe: z.number().positive().optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categoria: z.enum(CATEGORIES).optional(),
  notas: z.string().max(2000).nullable().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Al menos un campo' });

export const listExpensesSchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  categoria: z.enum(CATEGORIES).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
