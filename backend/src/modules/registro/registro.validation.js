import { z } from 'zod';
import { NOMBRES_FUENTE, TOPE } from './registro.model.js';

/** Una fecha del filtro: `2026-09-04`, y no cualquier cosa que Postgres acepte. */
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va como 2026-09-04');

/**
 * Lo que se puede pedir del registro (#111).
 *
 * `fuentes` llega como lista separada por comas —`tarea,error`— porque va en la
 * direccion. Se convierte aqui y se comprueba contra las que existen: un nombre
 * inventado se cae con un 400 en vez de devolver una lista vacia, que se lee
 * como «no paso nada» y es mentira.
 */
export const listarSchema = z.object({
  vista: z.enum(['general', 'todos']).default('general'),
  desde: fecha.optional(),
  hasta: fecha.optional(),
  usuarioId: z.coerce.number().int().positive().optional(),
  fuentes: z.string().optional().transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
    .refine((v) => !v || v.every((f) => NOMBRES_FUENTE.includes(f)),
      { message: `Fuentes válidas: ${NOMBRES_FUENTE.join(', ')}` }),
  busca: z.string().trim().max(200).optional(),
  limite: z.coerce.number().int().positive().max(TOPE).default(100),
}).refine((v) => !v.desde || !v.hasta || v.desde <= v.hasta, {
  message: 'La fecha «desde» no puede ser posterior a «hasta»',
  path: ['desde'],
});
