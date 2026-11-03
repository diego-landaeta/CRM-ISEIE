import { z } from 'zod';

export const responderSchema = z.object({
  texto: z.string({ required_error: 'Falta la respuesta' }).trim()
    .min(1, 'Falta la respuesta: escríbela en «Tu respuesta».')
    .max(20000, 'La respuesta es demasiado larga: como mucho 20 000 caracteres.'),
});

export const reasignarSchema = z.object({
  tutorId: z.coerce.number({ invalid_type_error: 'Elige el tutor' }).int().positive('Elige el tutor'),
});

export const tokenTutorSchema = z.object({
  projectId: z.coerce.number({ invalid_type_error: 'Elige el campus' }).int().positive('Elige el campus'),
  // null o vacío: quitar el token.
  token: z.string().trim().max(200, 'Ese token es demasiado largo').nullable().optional(),
});

export const listarSchema = z.object({
  estado: z.enum(['pendientes', 'abierta', 'respondida', 'cerrada']).optional(),
  sinTutor: z.enum(['1', 'true']).optional(),
  buscar: z.string().trim().max(100).optional(),
});

// ─── Fase 3 (#189) ───────────────────────────────────────────────────────────

export const escribirSchema = z.object({
  texto: z.string({ required_error: 'Falta el mensaje' }).trim()
    .min(1, 'Falta el mensaje: escríbelo en «Mensaje al alumno».')
    .max(20000, 'El mensaje es demasiado largo: como mucho 20 000 caracteres.'),
});

export const cargaSchema = z.object({
  nivel: z.enum(['baja', 'media', 'alta', 'completa'], {
    errorMap: () => ({ message: 'Falta el nivel: elige baja, media, alta o completa en «Nivel de carga».' }),
  }),
  texto: z.string().trim().max(2000, 'El texto, como mucho 2000 caracteres.').nullable().optional(),
});

// Una fecha que existe: «2026-13-45» pasaba el formato y la base daba un 500.
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD')
  .refine((v) => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; },
    'Esa fecha no existe: revísala (AAAA-MM-DD).');
export const metricasSchema = z.object({
  desde: fecha.optional(),
  hasta: fecha.optional(),
  tutorId: z.coerce.number().int().positive().optional(),
});
