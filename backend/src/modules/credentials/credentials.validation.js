import { z } from 'zod';

const SERVICES = ['meta', 'google_ads', 'gsc', 'stripe', 'claude', 'brevo'];

export const upsertCredentialSchema = z.object({
  project_id: z.number().int().positive().nullable().optional(),
  service: z.enum(SERVICES),
  value: z.string().min(4, 'Valor muy corto').max(10000),
  metadata: z.record(z.string(), z.any()).optional().nullable(),
});

export const listCredentialsSchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  service: z.enum(SERVICES).optional(),
});
