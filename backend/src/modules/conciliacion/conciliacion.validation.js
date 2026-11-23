import { z } from 'zod';

// «YYYY-MM» (un mes) o nada (todos los meses).
const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'El mes va como AAAA-MM').optional();

export const listarSchema = z.object({
  mes,
  dias: z.coerce.number().int().min(0).max(31).optional(),
});

export const enlazarSchema = z.object({
  invoiceId: z.coerce.number().int().positive(),
  paymentId: z.coerce.number().int().positive(),
});

// Lo que vio quien confirma: si ya no es eso, 409 y no se toca nada.
export const segurasSchema = z.object({
  mes,
  dias: z.coerce.number().int().min(0).max(31).optional(),
  cuantas: z.coerce.number().int().min(1),
  importe: z.coerce.number().min(0),
});
