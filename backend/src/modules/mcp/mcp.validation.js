import { z } from 'zod';

export const crearTokenSchema = z.object({
  nombre: z.string().trim().min(1, 'Ponle un nombre al token (p. ej. «Claude del portátil»)').max(100),
});

export const idSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const accesoSchema = z.object({
  usa_mcp: z.boolean(),
});
