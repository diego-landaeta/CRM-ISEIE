import { z } from 'zod';

export const createSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  label: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  // Por defecto compartida: una plantilla que solo ve quien la escribe no
  // arregla el problema que veniamos a resolver.
  ambito: z.enum(['compartida', 'personal']).default('compartida'),
});

export const updateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(4000).optional(),
  orden: z.coerce.number().int().min(0).optional(),
});
