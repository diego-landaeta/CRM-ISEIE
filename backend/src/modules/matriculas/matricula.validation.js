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

// Un campo vaciado llega como null desde la ficha: «Guardar campos» con el
// título o las notas en blanco daba «Datos invalidos» (#199).
export const updateSchema = z.object({
  dni: z.string().max(40).nullable().optional(),
  titulo: z.string().max(500).nullable().optional(),
  notas: z.string().max(2000).nullable().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Al menos un campo' });

// Validar manda motivo_rechazo: null; sin el nullable, validar desde la ficha
// también daba «Datos invalidos» (#199).
export const setEstadoSchema = z.object({
  estado: z.enum(['solicitud_admision', 'datos_validados', 'pendiente', 'validada', 'rechazada']),
  motivo_rechazo: z.string().max(500).nullable().optional(),
});
