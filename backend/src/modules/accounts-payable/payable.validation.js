import { z } from 'zod';

const EXPENSE_CATEGORIES = ['salarios', 'alquiler', 'proveedores', 'software', 'publicidad', 'impuestos', 'servicios', 'mantenimiento', 'otros'];

export const createPayableSchema = z.object({
  project_id: z.number().int().positive().nullable().optional(),
  proveedor: z.string().min(1).max(255),
  concepto: z.string().min(1).max(255),
  categoria: z.enum(EXPENSE_CATEGORIES).default('proveedores'),
  importe_total: z.number().positive(),
  fecha_factura: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha de factura requerida (YYYY-MM-DD)'),
  fecha_compromiso_pago: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
});

export const updatePayableSchema = createPayableSchema.partial();

export const paymentSchema = z.object({
  importe: z.number().positive(),
  fecha_pago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha de pago requerida (YYYY-MM-DD)'),
  metodo: z.string().max(50).nullable().optional(),
  referencia: z.string().max(100).nullable().optional(),
  notas: z.string().nullable().optional(),
});
