import { z } from 'zod';

export const sincronizarSchema = z.object({
  projectId: z.coerce.number().int().positive(),
});

export const enlazarSchema = z.object({
  conversionId: z.coerce.number().int().positive(),
});

export const listarPaypalSchema = z.object({
  enlazado: z.enum(['si', 'no']).optional(),
  buscar: z.string().max(120).optional(),
  page: z.coerce.number().int().positive().max(10000).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const listarMovimientosSchema = z.object({
  estado: z.enum(['enlazado', 'a_revisar', 'sin_candidato', 'descartado']).optional(),
  page: z.coerce.number().int().positive().max(10000).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

/** Un id de la URL: número entero positivo. */
export const idSchema = z.coerce.number().int().positive().max(2147483647);

// Lo que se acepta como extracto: Norma 43 (.n43, .aeb, .txt, .q43) o CSV.
export const EXTENSIONES_EXTRACTO = /\.(n43|aeb|aeb43|q43|txt|csv|dat)$/i;
export const TOPE_EXTRACTO_BYTES = 5 * 1024 * 1024;
