import { z } from 'zod';

// «moodle» (migración 264 de ISEIE, 220 del 360): el Moodle de cada campus, para el MCP
// y las consultas de alumnos. El valor es un JSON {"url":"https://…","token":"…"}.
const SERVICES = ['meta', 'google_ads', 'gsc', 'stripe', 'claude', 'brevo', 'moodle'];

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
