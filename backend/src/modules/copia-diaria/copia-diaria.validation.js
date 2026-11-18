import { z } from 'zod';

// El enlace de descarga de la copia: el fichero, cuándo caduca y la firma.
// Lo que no tenga esta forma no llega a mirar el disco.
export const descargaSchema = z.object({
  fichero: z.string().regex(/^[A-Za-z0-9_.-]{1,120}-\d{4}-\d{2}-\d{2}\.zip$/),
  exp: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
