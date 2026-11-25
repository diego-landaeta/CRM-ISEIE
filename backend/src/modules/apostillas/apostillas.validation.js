import { z } from 'zod';
import { CLAVES_ESTADO, CLAVES_DOCUMENTO } from './apostillas.estados.js';

/*
  Los valores salen de las CHECK de la migración 344 (en el 360, 333): si aquí se
  aceptara uno que la tabla rechaza, saldría un 500 de Postgres en vez de un
  «ese campo no vale».
*/

const MAX_INT = 2147483647;
const id = z.coerce.number().int().positive().max(MAX_INT);
const idOpcional = id.optional().nullable();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato AAAA-MM-DD');

/** Texto opcional: el formulario manda cadena vacía cuando no se rellena. */
const texto = (max) => z.string().max(max).optional().nullable()
  .transform((v) => (v && v.trim() ? v.trim() : null));

export const listarSchema = z.object({
  estado: z.enum(CLAVES_ESTADO).optional(),
  // «Sin asociar»: las que no tienen todavía a la persona.
  sinAsociar: z.enum(['1', 'true']).optional().transform((v) => Boolean(v)),
  atascadas: z.enum(['1', 'true']).optional().transform((v) => Boolean(v)),
  // Solo las que puede gestionar quien pide (las de sus clientes, para una gestora).
  mias: z.enum(['1', 'true']).optional().transform((v) => Boolean(v)),
  q: z.string().trim().max(120).optional(),
  from: fecha.optional(),
  to: fecha.optional(),
  page: z.coerce.number().int().positive().max(100000).optional().default(1),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
});

export const cifrasSchema = z.object({
  from: fecha.optional(),
  to: fecha.optional(),
});

export const editarSchema = z.object({
  estado: z.enum(CLAVES_ESTADO).optional(),
  responsableId: idOpcional,
  formacion: texto(500),
  direccionEnvio: texto(1000),
  numeroSeguimiento: texto(120),
  // La nota del cambio (va al historial). Con «Cancelada», obligatoria.
  nota: texto(2000),
}).refine((d) => Object.keys(d).some((k) => d[k] !== undefined), 'No hay nada que cambiar')
  .refine((d) => d.estado !== 'cancelada' || Boolean(d.nota), {
    message: 'Para cancelarla, escribe el motivo en la nota', path: ['nota'],
  });

export const crearSchema = z.object({
  projectId: id,
  leadId: idOpcional,
  conversionId: idOpcional,
  formacion: texto(500),
  nota: texto(2000),
});

export const enlazarSchema = z.object({
  leadId: id,
  conversionId: idOpcional,
});

export const documentoSchema = z.object({
  tipo: z.enum(CLAVES_DOCUMENTO).optional().default('otro'),
});

export const ajustesSchema = z.object({
  projectId: id,
  diasAviso: z.coerce.number().int().min(1, 'Como poco, 1 día').max(90, 'Como mucho, 90 días'),
});
