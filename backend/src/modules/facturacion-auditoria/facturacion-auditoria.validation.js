import { z } from 'zod';

// «Marcar como solucionado» y «Auditar ahora» no llevan datos: un cuerpo vacío.
export const sinDatosSchema = z.object({}).passthrough();

// GET /simular?desde=AAAA-MM-DD — la pasada en seco con otra fecha de corte.
export const simularSchema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va como AAAA-MM-DD').optional(),
});

export const historialSchema = z.object({
  limite: z.coerce.number().int().min(1).max(100).optional(),
});
