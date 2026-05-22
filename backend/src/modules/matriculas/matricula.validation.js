import { z } from 'zod';

export const createSchema = z.object({
  project_id: z.number().int().positive(),
  conversion_id: z.number().int().positive().optional(),
  lead_id: z.number().int().positive().optional(),
  dni: z.string().max(40).optional(),
  titulo: z.string().max(500).optional(),
  notas: z.string().max(2000).optional(),
  source: z.enum(['manual', 'webhook', 'form']).optional(),
  estado: z.enum(['solicitud_admision', 'datos_validados', 'pendiente', 'validada', 'rechazada']).optional(),
  dedupe_key: z.string().max(150).optional(),
  datos_admision: z.record(z.string(), z.any()).optional(),
});

export const updateSchema = z.object({
  dni: z.string().max(40).optional(),
  titulo: z.string().max(500).optional(),
  notas: z.string().max(2000).optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Al menos un campo' });

export const setEstadoSchema = z.object({
  estado: z.enum(['solicitud_admision', 'datos_validados', 'pendiente', 'validada', 'rechazada']),
  motivo_rechazo: z.string().max(500).optional(),
});
