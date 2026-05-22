import { z } from 'zod';

const FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean', 'textarea'];
const ENTITIES = ['lead', 'client', 'product'];

export const createFieldSchema = z.object({
  project_id: z.number().int().positive(),
  entity: z.enum(ENTITIES).default('lead'),
  field_key: z.string().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/, 'field_key debe ser snake_case'),
  label: z.string().min(1).max(150),
  type: z.enum(FIELD_TYPES).default('text'),
  options: z.object({ choices: z.array(z.string()) }).optional().nullable(),
  required: z.boolean().default(false),
  orden: z.number().int().default(0),
  grupo: z.string().max(60).optional().nullable(),
});

export const updateFieldSchema = z.object({
  label: z.string().min(1).max(150).optional(),
  type: z.enum(FIELD_TYPES).optional(),
  options: z.object({ choices: z.array(z.string()) }).nullable().optional(),
  required: z.boolean().optional(),
  orden: z.number().int().optional(),
  grupo: z.string().max(60).nullable().optional(),
  active: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Al menos un campo' });

export const reorderFieldsSchema = z.object({
  project_id: z.number().int().positive(),
  order: z.array(z.object({ id: z.number().int().positive(), orden: z.number().int() })).min(1),
});
