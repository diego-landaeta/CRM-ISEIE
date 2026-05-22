import { z } from 'zod';

export const ruleSchema = z.object({
  project_id: z.number().int().positive(),
  user_id: z.number().int().positive(),
  product_id: z.number().int().positive().nullable().optional(),
  pct: z.number().min(0).max(100),
  base_calc: z.enum(['cobrado', 'vendido']).default('cobrado'),
  condicion: z.any().optional().nullable(),
});

export const ruleUpdateSchema = z.object({
  pct: z.number().min(0).max(100).optional(),
  base_calc: z.enum(['cobrado', 'vendido']).optional(),
  condicion: z.any().nullable().optional(),
  active: z.boolean().optional(),
});

export const paySchema = z.object({
  fecha_pago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha de pago requerida (YYYY-MM-DD)'),
  notas: z.string().optional(),
});
