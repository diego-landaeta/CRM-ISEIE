import { z } from 'zod';

export const uploadDossierSchema = z.object({
  productId: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive(),
});

export const dossierIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
