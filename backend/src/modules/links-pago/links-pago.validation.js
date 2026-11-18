import { z } from 'zod';

/** Los estados de un link (CHECK de la migración 314). */
export const ESTADOS = ['creado', 'abierto', 'pagado', 'pagado_parcial', 'caducado', 'anulado'];

// Hasta el máximo de un INTEGER de Postgres: más allá la consulta fallaba con un 500.
const id = z.coerce.number().int().positive().max(2147483647);

/*
  El listado. El campus (`projectId`, `projectIds`, `issuerId`) lo lee
  `listaDelAmbito` directamente de la petición y lo recorta a los campus de
  quien pide; aquí solo se comprueba el formato. `createdBy` se recorta además
  al alcance de la persona: una gestora que pide los de otra recibe los suyos.
*/
export const listarSchema = z.object({
  projectId: id.optional(),
  issuerId: id.optional(),
  projectIds: z.string().regex(/^\d+(,\d+)*$/, 'projectIds: números separados por comas').optional(),
  estado: z.enum(ESTADOS).optional(),
  leadId: id.optional(),
  conversionId: id.optional(),
  createdBy: id.optional(),
  page: z.coerce.number().int().min(1).max(1000000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export const idSchema = z.object({ id });

export const configQuerySchema = z.object({ projectId: id });

export const configBodySchema = z.object({
  projectId: id,
  // Porcentaje sobre el precio del catálogo, con dos decimales como mucho.
  // Sin `z.coerce`: convertía null y "" en 0 y true en 1 sin avisar. Se acepta
  // un número o un texto que sea un número (con punto o coma), y nada más.
  descuento_max_pct: z.preprocess(
    (v) => (typeof v === 'string' && /^\s*\d+([.,]\d+)?\s*$/.test(v) ? Number(v.trim().replace(',', '.')) : v),
    z.number({ invalid_type_error: 'El descuento tiene que ser un número', required_error: 'Falta el descuento' })
      .finite()
      .min(0, 'El descuento no puede ser negativo')
      .max(100, 'El descuento no puede pasar del 100 %')
      // Con tolerancia: 2.3 * 100 da 229.99999999999997 en coma flotante.
      .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-9, 'Dos decimales como mucho'),
  ),
});
