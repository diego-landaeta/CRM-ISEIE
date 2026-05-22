import { z } from 'zod';

export const createWebhookSchema = z.object({
  project_id: z.number().int().positive(),
  label: z.string().min(2).max(120),
  field_mapping: z.record(z.string(), z.string()).optional(),
  mode: z.enum(['test', 'active']).optional(),
});

export const updateWebhookSchema = z.object({
  label: z.string().min(2).max(120).optional(),
  mode: z.enum(['test', 'active']).optional(),
  field_mapping: z.record(z.string(), z.string()).optional(),
  active: z.boolean().optional(),
});
