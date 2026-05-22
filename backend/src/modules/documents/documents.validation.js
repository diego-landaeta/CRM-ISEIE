import { z } from 'zod';

const docTypeSchema = z.enum(['invoice', 'certificate'], {
  errorMap: () => ({ message: 'type debe ser "invoice" o "certificate"' }),
});

// projectId puede llegar como string en query y como number en body — coercionamos.
const projectIdSchema = z.coerce.number().int().positive('projectId invalido');

// Generate: el `data` interior es libre (varia entre invoice y certificate); aqui
// solo validamos los campos de control + tipo.
export const generateSchema = z.object({
  projectId: projectIdSchema,
  type: docTypeSchema,
  data: z.record(z.string(), z.unknown()).default({}),
  numero_override: z.union([z.coerce.number().int().min(1), z.literal(''), z.null()]).optional(),
});

export const previewSchema = z.object({
  type: docTypeSchema,
  data: z.record(z.string(), z.unknown()).default({}),
});

export const setNumberSchema = z.object({
  projectId: projectIdSchema,
  type: docTypeSchema,
  value: z.coerce.number().int().min(1, 'value debe ser >= 1'),
});

export const peekNumberQuerySchema = z.object({
  projectId: projectIdSchema,
  type: docTypeSchema,
});

export const projectQuerySchema = z.object({
  projectId: projectIdSchema,
  type: docTypeSchema.optional(),
});
