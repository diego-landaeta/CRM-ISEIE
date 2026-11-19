import { z } from 'zod';

// Confirmación de datos del diploma (#768). La forma aquí; si el nombre y el
// documento valen lo dice el servicio con las mismas reglas que «Editar» en
// Diplomas (certifex.validation.js), para que el alumno no pueda dejar lo que
// una persona del CRM no podría.
const texto = (max) => z.string().max(max).optional().nullable();

export const respuestaSchema = z.object({
  accion: z.enum(['confirmar', 'corregir']),
  nombre: texto(300),
  documento: texto(60),
  comentario: texto(1000),
}).strict();

const matriculaId = z.coerce.number().int().positive();

export const pedirSchema = z.object({
  matriculaIds: z.array(matriculaId).min(1).max(50)
    .transform((ids) => [...new Set(ids)]),
}).strict();

export const estadosSchema = z.object({
  // «1,2,3» en la URL.
  matriculaIds: z.string().trim().min(1)
    .transform((s) => [...new Set(s.split(',').map((x) => Number(x.trim())))])
    .refine((ids) => ids.length <= 200 && ids.every((n) => Number.isInteger(n) && n > 0), 'Matrículas no válidas'),
});

export const matriculaParamSchema = z.object({ matriculaId });
