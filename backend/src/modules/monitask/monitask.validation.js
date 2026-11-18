import { z } from 'zod';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const diaValido = (v) => DIA.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const dia = z.string().refine(diaValido, 'Fecha no válida (AAAA-MM-DD)');

/** Lo más largo que se puede pedir de una vez: Monitask guarda uno o dos meses. */
export const MAX_DIAS = 93;
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export const guardarAppSchema = z.object({
  client_id: z.string().trim().min(1, 'Falta el Client ID').max(200),
  // Sin secreto: se queda el que había.
  client_secret: z.string().trim().min(8, 'El Client Secret es demasiado corto').max(500).optional().nullable(),
  margen_pct: z.coerce.number().min(0).max(100).optional().nullable(),
});

export const desconectarSchema = z.object({
  todo: z.enum(['0', '1', 'true', 'false']).optional(),
});

const rango = (obligatorio) => z.object({
  desde: obligatorio ? dia : dia.optional(),
  hasta: obligatorio ? dia : dia.optional(),
}).refine((r) => !r.desde || !r.hasta || r.desde <= r.hasta, 'La fecha «desde» va antes que «hasta»')
  .refine((r) => !r.desde || !r.hasta || diasEntre(r.desde, r.hasta) < MAX_DIAS, `Como mucho ${MAX_DIAS} días de una vez`);

export const sincronizarSchema = rango(false);

export const actividadSchema = z.object({
  desde: dia,
  hasta: dia,
  persona: z.coerce.number().int().positive().optional(),
  proyecto: z.string().trim().max(200).optional(),
}).refine((r) => r.desde <= r.hasta, 'La fecha «desde» va antes que «hasta»')
  .refine((r) => diasEntre(r.desde, r.hasta) <= 400, 'Como mucho un año de una vez');

export const diasSchema = z.object({ desde: dia, hasta: dia })
  .refine((r) => r.desde <= r.hasta, 'La fecha «desde» va antes que «hasta»')
  .refine((r) => diasEntre(r.desde, r.hasta) <= 400, 'Como mucho un año de una vez');

export const cotejoSchema = z.object({
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes no válido (AAAA-MM)'),
});

export const idSchema = z.object({ id: z.coerce.number().int().positive() });

export const emparejarSchema = z.object({
  colaborador_id: z.coerce.number().int().positive().optional().nullable(),
  user_id: z.coerce.number().int().positive().optional().nullable(),
  ninguno: z.boolean().optional(),
}).refine((r) => !(r.ninguno && (r.colaborador_id || r.user_id)), '«No es nadie del CRM» no va con una ficha o un usuario');

export const callbackSchema = z.object({
  code: z.string().max(4000).optional(),
  state: z.string().max(200).optional(),
  error: z.string().max(200).optional(),
}).passthrough();
