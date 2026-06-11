import { z } from 'zod';

// Categorías del enum `expense_category`. Las 9 originales + 3 añadidas por
// EPIC B (migration 081/082): comision_pasarela_pago (B0), comision_gestor (F),
// nomina (F). Si el frontend manda una categoría no listada, devuelve 400.
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
  'comision_pasarela_pago',
  'comision_gestor',
  'nomina',
];

// Schema común para el blob de comprobante. Lo rellena el endpoint
// /upload-comprobante y el cliente lo manda junto al create/update.
const comprobanteShape = {
  comprobante_url: z.string().url().max(1000).nullable().optional(),
  comprobante_key: z.string().max(500).nullable().optional(),
  comprobante_mime: z.string().max(50).nullable().optional(),
  comprobante_size_bytes: z.number().int().nonnegative().nullable().optional(),
};

export const createExpenseSchema = z.object({
  project_id: z.number().int().positive().nullable().optional(),
  concepto: z.string().min(1, 'Concepto requerido').max(255),
  importe: z.number().positive('Importe debe ser > 0'),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha del egreso requerida (YYYY-MM-DD)'),
  categoria: z.enum(CATEGORIES).default('otros'),
  notas: z.string().max(2000).optional().nullable(),
  ...comprobanteShape,
});

export const updateExpenseSchema = z.object({
  project_id: z.number().int().positive().nullable().optional(),
  concepto: z.string().min(1).max(255).optional(),
  importe: z.number().positive().optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categoria: z.enum(CATEGORIES).optional(),
  notas: z.string().max(2000).nullable().optional(),
  ...comprobanteShape,
}).refine(d => Object.keys(d).length > 0, { message: 'Al menos un campo' });

export const listExpensesSchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  categoria: z.enum(CATEGORIES).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
