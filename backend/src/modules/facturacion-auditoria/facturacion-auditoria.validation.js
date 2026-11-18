import { z } from 'zod';

// «Marcar como solucionado» y «Auditar ahora» no llevan datos: un cuerpo vacío.
export const sinDatosSchema = z.object({}).passthrough();

export const historialSchema = z.object({
  limite: z.coerce.number().int().min(1).max(100).optional(),
});
