import { z } from 'zod';

export const assignSchema = z.object({
  project_id: z.coerce.number().int().positive(),
});

export const connectSchema = z.object({
  business_id: z.string().regex(/^\d+$/, 'business_id debe ser numerico'),
  access_token: z.string().min(20, 'access_token invalido'),
  nombre: z.string().max(255).optional(),
});